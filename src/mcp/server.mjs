import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createRequire} from 'node:module';
import * as z from 'zod/v4';
import {runConsole, ConsoleRateLimitError, ConsoleTimeoutError} from '../api/console.js';
import consoleProtocol from '../api/console-protocol.js';

// 命令表是 CommonJS；MCP 入口是 ESM，用 createRequire 直接引同一份定义。
const require = createRequire(import.meta.url);
const {COMMAND_TABLE} = require('../commands.js');
const {applyOutputOptions} = require('../cli/output.js');

const MAX_RESULT_CHARS = 25000;
/** logs 是阻塞式监听：MCP 单次调用不能占太久，上限比 CLI 的 600 秒低得多。 */
const LOGS_MCP_MAX_SECONDS = 60;
const ROOM_PATTERN = /^[EW]\d+[NS]\d+$/;
/** 与 CLI 共用的输出选项：先取子路径，再过滤、裁字段，用来把大结果压到上限以内。 */
const OUTPUT_KEYS = ['pick', 'filter', 'fields'];

const targetSchema = z.string().default('main').describe('目标服务器：main、ptr、season、pserver，或 .screeps.yml 里定义的其他服务器');
const shardSchema = z.string().optional().describe('分片名，例如 shardX；省略时使用该服务器默认分片');
const accountSchema = z.string().optional().describe('本地 .screeps.yml 中的账号别名');

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
        error: {type: 'result-too-large', message: `结果超过 ${MAX_RESULT_CHARS} 字符，未返回数据`, hint: '用 pick 取子路径、filter 过滤条目、fields 只留需要的字段；Memory 缩小路径，Segment 收窄 ID。'},
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
    schema = z.string().regex(ROOM_PATTERN, '房间名格式应为 E1N1 或 W1S2');
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
  shape.pick = z.string().optional().describe('先取结果的子路径，例如 stats');
  shape.filter = z.string().optional().describe('按 路径=值 或 路径!=值 过滤数组或对象集合，多条件用逗号分隔（且）');
  shape.fields = z.string().optional().describe('只保留这些字段，点号路径用逗号分隔，例如 type,x,y');
  return z.object(shape).strict();
}

/** 参数表 → 处理函数的 options，与 CLI 走同一套键；没给的参数不传。 */
function toolOptions(input) {
  const result = options(input);
  for (const [key, value] of Object.entries(input)) {
    if (key === 'target' || key === 'shard' || key === 'account' || OUTPUT_KEYS.includes(key)) continue;
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** 只把用户真正给出的输出选项交给 applyOutputOptions，避免 undefined 覆盖默认行为。 */
function outputOptions(input) {
  const result = {};
  for (const key of OUTPUT_KEYS) {
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
    }, input => call(() => command.run(toolOptions(input), {durationMax: LOGS_MCP_MAX_SECONDS}), outputOptions(input)));
  }

  server.registerTool('screeps_console', {
    description: '执行完整的 Screeps Console JavaScript 表达式并返回结果。表达式可能修改游戏状态；服务端不做只读判断。默认不重试，超时代表结果未知。',
    inputSchema: z.object({
      target: targetSchema,
      shard: shardSchema,
      account: accountSchema,
      expression: z.string().min(1).describe('游戏内 Console JavaScript 表达式'),
      timeoutMs: z.number().int().min(1000).max(60000).default(15000).describe('单次等待回包时间，毫秒'),
    }).strict(),
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
  }, input => call(async () => {
    const result = await runConsole(options(input), input.expression, {timeoutMs: input.timeoutMs, retries: 0});
    return {
      shard: result.shard,
      id: result.id,
      tick: result.tick,
      attempts: result.attempts,
      value: consoleProtocol.unwrapValue(result.value),
    };
  }));

  return server;
}

await serveStdio(createServer);
console.error('screeps-assistant MCP server running on stdio');
