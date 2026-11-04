import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import queries from '../api/queries.js';
import {runConsole, ConsoleRateLimitError, ConsoleTimeoutError} from '../api/console.js';
import consoleProtocol from '../api/console-protocol.js';

const MAX_RESULT_CHARS = 25000;

const targetSchema = z.string().default('main').describe('目标服务器：main、season 或 pserver');
const shardSchema = z.string().optional().describe('分片名，例如 shardX；省略时使用该服务器默认分片');
const accountSchema = z.string().optional().describe('本地 .screeps.yml 中的账号别名');
const roomSchema = z.string().regex(/^[EW]\d+[NS]\d+$/, '房间名格式应为 E49N32 或 W1S2').describe('Screeps 房间名');

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

async function call(fn) {
  try {
    const value = await fn();
    const text = jsonText({ok: true, value});
    if (text.length > MAX_RESULT_CHARS) {
      return {isError: true, content: [{type: 'text', text: jsonText({
        ok: false,
        error: {type: 'result-too-large', message: `结果超过 ${MAX_RESULT_CHARS} 字符，未返回数据`, hint: '缩小 Memory 路径或查询范围；Segment 请使用更精确的查询方式。'},
      })}]};
    }
    return {content: [{type: 'text', text}]};
  } catch (error) {
    return errorResult(error);
  }
}

function createServer() {
  const server = new McpServer({name: 'screeps-assistant', version: '1.0.0'});

  server.registerTool('screeps_get_status', {
    description: '检查 Screeps 目标和本地凭证配置，不返回凭证内容。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.getStatus(options(input))));

  server.registerTool('screeps_get_account', {
    description: '读取当前 Screeps 账号概况。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.getAccount(options(input))));

  server.registerTool('screeps_list_shards', {
    description: '列出目标服务器的 shard 信息。',
    inputSchema: z.object({target: targetSchema, account: accountSchema}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.listShards(options(input))));

  server.registerTool('screeps_list_rooms', {
    description: '列出当前账号在指定 shard 的房间。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.listRooms(options(input))));

  server.registerTool('screeps_get_room', {
    description: '读取房间现场摘要，包括控制器、建筑、己方和敌方 creep。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema, room: roomSchema}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.getRoom({...options(input), room: input.room})));

  server.registerTool('screeps_get_memory', {
    description: '按路径读取 Screeps Memory；必须指定非空路径，避免意外读取整个 Memory。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema, path: z.string().min(1).describe('Memory 路径，例如 rooms.E49N32')}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.getMemory({...options(input), path: input.path})));

  server.registerTool('screeps_get_segment', {
    description: '读取指定的 Screeps Memory Segment。',
    inputSchema: z.object({target: targetSchema, shard: shardSchema, account: accountSchema, id: z.string().min(1).describe('Segment ID，例如 0 或 0,1')}).strict(),
    annotations: {readOnlyHint: true, destructiveHint: false},
  }, input => call(() => queries.getSegment({...options(input), id: input.id})));

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
