import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createRequire} from 'node:module';
import * as z from 'zod/v4';
import {context, resolveShards} from '../api/client.js';
import {openConsoleSession, ConsoleClosedError, ConsoleRateLimitError, ConsoleTimeoutError} from '../api/console.js';
import consoleProtocol from '../api/console-protocol.js';
import toolbox from '../api/toolbox.js';

// 命令表是 CommonJS；MCP 入口是 ESM，用 createRequire 直接引同一份定义。
const require = createRequire(import.meta.url);
const {COMMAND_TABLE} = require('../commands.js');
const {decodeMemoryValue} = require('../api/queries.js');
const {applyOutputOptions} = require('../cli/output.js');

const MAX_RESULT_CHARS = 25000;
/** logs 是阻塞式监听：MCP 单次调用不能占太久，上限比 CLI 的 600 秒低得多。 */
const LOGS_MCP_MAX_SECONDS = 60;
const SESSION_IDLE_MS = 180_000;
const ROOM_PATTERN = /^[EW]\d+[NS]\d+(,[EW]\d+[NS]\d+)*$/;
/** 与 CLI 共用的输出选项：先取子路径，再过滤、裁字段、截断条数，用来把大结果压到上限以内。 */
const OUTPUT_KEYS = ['pick', 'filter', 'fields', 'limit'];

const targetSchema = z.string().default('main').describe('目标服务器：main、ptr、season、pserver，或 .screeps.yml 里定义的其他服务器');
const shardSchema = z.string().optional().describe('分片名，例如 shardX；支持逗号多选如 shard2,shard3,shardX 或 all；省略时使用该服务器默认分片');
const accountSchema = z.string().optional().describe('本地 .screeps.yml 中的账号别名');

/** 常驻 console 会话池：按 (target, shard, account) 复用 WebSocket，空闲自动回收，同一会话串行排队。 */
const consolePool = new Map();

function poolKey(opts) {
  return `${opts.target || 'main'}:${opts.shard || ''}:${opts.account || ''}`;
}

async function evictSession(key) {
  const entry = consolePool.get(key);
  if (!entry) return;
  consolePool.delete(key);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  try {
    await entry.session?.close?.();
  } catch {
    // 清理旧连接忽略异常
  }
}

function scheduleIdleClose(key, entry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (entry.inFlight === 0) void evictSession(key);
  }, SESSION_IDLE_MS);
  entry.idleTimer.unref?.();
}

async function withConsoleSession(opts, fn) {
  const key = poolKey(opts);
  let entry = consolePool.get(key);
  if (!entry) {
    entry = {session: null, queue: Promise.resolve(), inFlight: 0, idleTimer: null};
    consolePool.set(key, entry);
  }
  const runTask = async () => {
    entry.inFlight += 1;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try {
      if (!entry.session) {
        entry.session = await openConsoleSession(opts);
      }
      return await fn(entry.session);
    } catch (error) {
      // 遇到连接级异常时丢弃缓存会话，确保下次调用重新建连。
      const keepSession = error instanceof ConsoleTimeoutError
        || error instanceof ConsoleRateLimitError
        || error?.kind === 'expression'
        || error?.kind === 'rejected'
        || error?.kind === 'protocol';
      if (!keepSession || error instanceof ConsoleClosedError) {
        await evictSession(key);
      }
      throw error;
    } finally {
      entry.inFlight -= 1;
      if (consolePool.get(key) === entry && entry.inFlight === 0) {
        scheduleIdleClose(key, entry);
      }
    }
  };
  const next = entry.queue.then(runTask, runTask);
  entry.queue = next.catch(() => {});
  return next;
}

async function closeAllSessions() {
  await Promise.all([...consolePool.keys()].map(evictSession));
}

process.once('SIGINT', () => {
  closeAllSessions().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  closeAllSessions().finally(() => process.exit(0));
});

function options(input) {
  return {target: input.target, shard: input.shard, account: input.account};
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function errorResult(error) {
  const result = {
    ok: false,
    error: {type: error?.kind || error?.name || 'error', message: error?.message || String(error)},
  };
  if (error instanceof ConsoleTimeoutError) {
    result.error.hint = '执行结果未知；先查询游戏状态，再决定是否重发。';
  } else if (error instanceof ConsoleRateLimitError) {
    result.error.hint = 'Console 触发限流；等待额度恢复后再试。';
    result.error.rateLimit = error.rateLimit;
  } else if (error?.code === 'ENOENT') {
    result.error.hint = '检查 screeps-assistant 根目录的 .screeps.yml。';
  }
  return {isError: true, content: [{type: 'text', text: jsonText(result)}]};
}

async function call(fn, outputOptions = {}) {
  try {
    const value = applyOutputOptions(await fn(), outputOptions);
    const text = jsonText({ok: true, value});
    if (text.length > MAX_RESULT_CHARS) {
      return {isError: true, content: [{type: 'text', text: jsonText({
        ok: false,
        error: {type: 'result-too-large', message: `结果超过 ${MAX_RESULT_CHARS} 字符，未返回数据`, hint: '用 pick 取子路径、filter 过滤条目、fields 只留需要的字段、limit 截断条数；Memory 缩小路径，Segment 收窄 ID。'},
      })}]};
    }
    return {content: [{type: 'text', text}]};
  } catch (error) {
    return errorResult(error);
  }
}

/** 命令表里的一项参数 → zod 字段。上限取 min(max, mcpMax)，logs 的 duration 因此在 MCP 里最多 60 秒。 */
function paramSchema(key, param) {
  let schema;
  if (param.type === 'room') {
    schema = z.string().regex(ROOM_PATTERN, '房间名格式应为 E1N1 或 W1S2（支持逗号分隔多房）');
  } else if (param.type === 'boolean') {
    schema = z.boolean();
  } else if (param.type === 'integer') {
    schema = z.number().int();
    if (param.min !== undefined) schema = schema.min(param.min);
    const max = param.mcpMax !== undefined && param.max !== undefined ? Math.min(param.max, param.mcpMax) : param.max ?? param.mcpMax;
    if (max !== undefined) schema = schema.max(max);
  } else {
    schema = z.string();
  }
  if (param.mcpRequired) schema = schema.describe(param.description);
  else schema = schema.optional().describe(param.description);
  return [key, schema];
}

/** 参数名就是命令表里的 camelCase 键，可选参数一律可省略。 */
function toolInputSchema(command) {
  const shape = {};
  for (const [key, param] of Object.entries(command.params || {})) {
    const [name, schema] = paramSchema(key, param);
    shape[name] = schema;
  }
  shape.target = targetSchema;
  shape.shard = shardSchema;
  shape.account = accountSchema;
  shape.pick = z.string().optional().describe('先取结果的子路径，支持逗号多路径，例如 stats 或 summary.controller,summary.spawns');
  shape.filter = z.string().optional().describe('过滤数组或对象集合：=、!=（支持 | 多值 OR）、^= 前缀、*= 包含、< <= > >= 数值比较，逗号分隔（且）');
  shape.fields = z.string().optional().describe('只保留这些字段（支持数组、对象集合和普通对象），点号路径用逗号分隔，例如 type,x,y');
  if (!shape.limit) {
    shape.limit = z.number().int().min(1).optional().describe('截断数组或对象集合前 N 项');
  }
  return z.object(shape).strict();
}

/** 参数表 → 处理函数的 options，与 CLI 走同一套键；没给的参数不传。 */
function toolOptions(input, command) {
  const result = options(input);
  const commandHasLimit = Boolean(command?.params?.limit);
  for (const [key, value] of Object.entries(input)) {
    if (key === 'target' || key === 'shard' || key === 'account') continue;
    if (key === 'pick' || key === 'filter' || key === 'fields') continue;
    if (key === 'limit' && !commandHasLimit) continue;
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** 只把用户真正给出的输出选项交给 applyOutputOptions，避免 undefined 覆盖默认行为。 */
function outputOptions(input, command) {
  const result = {};
  const commandHasLimit = Boolean(command?.params?.limit);
  for (const key of OUTPUT_KEYS) {
    if (key === 'limit' && commandHasLimit) continue;
    if (input[key] !== undefined) result[key] = input[key];
  }
  return result;
}

/** 只读查询都是幂等的；logs 会阻塞一段时间，但仍然只读。 */
function annotationsFor(command) {
  return {readOnlyHint: true, destructiveHint: false, idempotentHint: true};
}

function createServer() {
  const server = new McpServer({name: 'screeps-assistant', version: '1.0.0'});

  for (const command of COMMAND_TABLE) {
    server.registerTool(`screeps_${command.name}`, {
      description: command.description,
      inputSchema: toolInputSchema(command),
      annotations: annotationsFor(command),
    }, input => call(() => command.run(toolOptions(input, command), {durationMax: LOGS_MCP_MAX_SECONDS, timeoutMax: LOGS_MCP_MAX_SECONDS}), outputOptions(input, command)));
  }

  server.registerTool('screeps_console', {
    description: '执行完整的 Screeps Console JavaScript 表达式并返回结果（复用常驻连接、支持 args 注入与超长自动分片/中转、支持多分片）。表达式可能修改游戏状态；服务端不做只读判断。默认不重试，超时代表结果未知。',
    inputSchema: z.object({
      target: targetSchema,
      shard: shardSchema,
      account: accountSchema,
      allShards: z.boolean().optional().describe('在目标服务器全部分片上依次执行并汇总'),
      expression: z.string().min(1).describe('游戏内 Console JavaScript 表达式'),
      args: z.record(z.string(), z.unknown()).optional().describe('注入表达式作用域的变量键值对（对应 CLI --arg）'),
      transport: z.enum(['auto', 'chunk', 'memory']).default('auto').describe('超长脚本传输方式：auto 优先分片防 memory 限流'),
      timeoutMs: z.number().int().min(1000).max(60000).default(25000).describe('单次等待回包时间，毫秒'),
      pick: z.string().optional().describe('对返回结果取子路径'),
      filter: z.string().optional().describe('对返回结果做条件过滤'),
      fields: z.string().optional().describe('对返回结果裁剪字段'),
      limit: z.number().int().min(1).optional().describe('截断返回集合前 N 项'),
    }).strict(),
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
  }, input => call(async () => {
    const expr = consoleProtocol.bindExpressionArgs(input.expression, input.args);
    const multi = Boolean(input.allShards) || input.shard === 'all' || (typeof input.shard === 'string' && input.shard.includes(','));
    if (multi) {
      const {shards} = resolveShards({target: input.target, shard: input.shard, allShards: Boolean(input.allShards)});
      const out = {};
      for (const shard of shards) {
        try {
          const result = await withConsoleSession({target: input.target, shard, account: input.account}, session =>
            toolbox.runLargeConsole(session, expr, {transport: input.transport, timeoutMs: input.timeoutMs, retries: 0}));
          out[shard] = {
            shard: result.shard,
            id: result.id,
            tick: result.tick,
            attempts: result.attempts,
            transport: result.transport,
            chunks: result.chunks,
            value: consoleProtocol.unwrapValue(result.value),
          };
        } catch (error) {
          out[shard] = {error: error?.message || String(error)};
        }
      }
      return out;
    }
    return withConsoleSession(options(input), async session => {
      const result = await toolbox.runLargeConsole(session, expr, {transport: input.transport, timeoutMs: input.timeoutMs, retries: 0});
      return {
        shard: result.shard,
        id: result.id,
        tick: result.tick,
        attempts: result.attempts,
        transport: result.transport,
        chunks: result.chunks,
        value: consoleProtocol.unwrapValue(result.value),
      };
    });
  }, outputOptions(input)));

  server.registerTool('screeps_tools', {
    description: '管理游戏内 global.__sa 临时工具空间：status 查看状态与待消费收件箱摘要，inject 注入通用只读工具或自定义脚本，clear 清理临时状态。',
    inputSchema: z.object({
      target: targetSchema,
      shard: shardSchema,
      account: accountSchema,
      action: z.enum(['status', 'inject', 'clear']).describe('操作类型'),
      code: z.string().min(1).optional().describe('action=inject 时可选自定义 JS 代码；省略则注入默认通用工具包'),
      transport: z.enum(['auto', 'memory', 'chunk']).default('auto').describe('注入传输方式'),
      timeoutMs: z.number().int().min(1000).max(60000).default(25000).describe('等待回包时间，毫秒'),
    }).strict(),
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
  }, input => call(async () => withConsoleSession(options(input), async session => {
    if (input.action === 'inject') {
      return toolbox.injectToolbox(session, {code: input.code, transport: input.transport, timeoutMs: input.timeoutMs});
    }
    if (input.action === 'clear') {
      const res = await toolbox.clearToolbox(session, {timeoutMs: input.timeoutMs});
      return consoleProtocol.unwrapValue(res.value);
    }
    const res = await toolbox.statusToolbox(session, {timeoutMs: input.timeoutMs});
    return consoleProtocol.unwrapValue(res.value);
  })));

  server.registerTool('screeps_inbox', {
    description: '临时收件箱通道：list 读取当前待消费收件箱，push 通过 Memory 顶层前缀键写入消息（不占 console 额度），flush 在游戏内一次性读取并清空。',
    inputSchema: z.object({
      target: targetSchema,
      shard: shardSchema,
      account: accountSchema,
      action: z.enum(['list', 'push', 'flush']).describe('操作类型'),
      payload: z.unknown().optional().describe('action=push 时的消息载荷'),
      id: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().describe('action=push 时的可选消息 ID'),
      handlerExpr: z.string().min(1).optional().describe('action=flush 时的可选处理函数表达式，例如 items => items.length'),
      timeoutMs: z.number().int().min(1000).max(60000).default(25000).describe('action=flush 等待回包时间，毫秒'),
    }).strict(),
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
  }, input => call(async () => {
    if (input.action === 'list') {
      const {api, shard} = await context(options(input));
      const res = await api.userMemoryGet('', shard);
      const root = decodeMemoryValue(res?.data) || {};
      const inbox = {};
      for (const [k, v] of Object.entries(root)) {
        if (k.startsWith(toolbox.DEFAULT_MEMORY_INBOX_PREFIX)) {
          inbox[k.slice(toolbox.DEFAULT_MEMORY_INBOX_PREFIX.length)] = v;
        }
      }
      return inbox;
    }
    if (input.action === 'push') {
      if (input.payload === undefined) throw new Error('action=push 需要提供 payload');
      const {api, shard} = await context(options(input));
      return toolbox.pushInbox(api, shard, input.payload, {id: input.id});
    }
    return withConsoleSession(options(input), async session => {
      const res = await toolbox.flushInbox(session, {handlerExpr: input.handlerExpr, timeoutMs: input.timeoutMs});
      return consoleProtocol.unwrapValue(res.value);
    });
  }));

  return server;
}

await serveStdio(createServer);
console.error('screeps-assistant MCP server running on stdio');
