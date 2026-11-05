#!/usr/bin/env node
'use strict';

const {context, gclProgress, resolveTarget} = require('../src/api/client');
const queries = require('../src/api/queries');
const {
  consoleSummary,
  openConsoleSession,
  runConsoleRepeat,
} = require('../src/api/console');
const {
  assertExpressionSize,
  unwrapValue,
  wrapExpression,
} = require('../src/api/console-protocol');
const {commandArgs, helpText, parseInteger, readConsoleExpression} = require('../src/cli/args');
const {consoleEnvelope, printResult} = require('../src/cli/output');
const {readWorld, scanRooms} = require('../src/map/query');
const {terrainAscii} = require('../src/map/analysis');

function options(args) {
  return {target: args.target || 'main', shard: args.shard, account: args.account};
}

/** 房间名可写成位置参数或 --room。 */
function roomArg(args, command) {
  const room = args.room || args._[0];
  if (!room) throw new Error(`${command} 命令需要房间名：${command} E43N28 或 --room E43N28`);
  return room;
}

function resetTimeFromHeaders(headers) {
  const reset = Number(headers?.['x-ratelimit-reset'] ?? headers?.['X-RateLimit-Reset']);
  if (!Number.isFinite(reset)) return null;
  const date = new Date(reset * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('zh-CN', {hour12: false});
}

function httpDetail(error) {
  const response = error?.response;
  const status = Number(response?.status ?? error?.status);
  if (!status) return '';
  const method = (error?.req?.method || error?.config?.method || response?.config?.method || 'GET').toUpperCase();
  const path = error?.req?.path || error?.config?.url || response?.config?.url || '(unknown path)';
  let body = response?.data ?? error?.data;
  if (typeof body !== 'string') {
    try {
      body = JSON.stringify(body);
    } catch {
      body = String(body);
    }
  }
  let detail = `（HTTP ${status} ${method} ${path}，响应：${String(body).slice(0, 300)}）`;
  if (status === 429) {
    const headers = response?.headers || error?.headers;
    const reset = resetTimeFromHeaders(headers);
    if (reset) detail += `额度 ${reset} 重置；`;
  }
  return detail;
}

function printConsoleResult(result, args) {
  if (result.kind === 'raw') {
    for (const item of result.value) console.log(String(item));
    return;
  }
  const value = unwrapValue(result.value);
  if (args.envelope) {
    printResult(consoleEnvelope(result, value), args);
    return;
  }
  if (typeof value === 'string') {
    console.log(value);
    return;
  }
  printResult(value, args);
}

function validateConsoleOptions(args) {
  const timeoutMs = parseInteger(args.timeout, '--timeout', {min: 1, fallback: 15000});
  const repeat = args.repeat === undefined ? undefined : parseInteger(args.repeat, '--repeat', {min: 2});
  const times = parseInteger(args.times, '--times', {min: 1, max: 60, fallback: repeat === undefined ? undefined : 10});
  const retries = parseInteger(args.retry, '--retry', {min: 0, fallback: repeat === undefined ? undefined : 0});
  const raw = Boolean(args.raw);
  if (raw && repeat !== undefined) throw new Error('--raw 不能和 --repeat 同用；raw 模式没有请求 ID，无法安全连拍');
  if (raw && retries > 0) throw new Error('--raw 不支持重试；请去掉 --retry，或显式使用 --retry 0');
  return {timeoutMs, repeat, times, retries, raw};
}

function assertConsoleExpressionSize(expression, raw) {
  if (raw) {
    assertExpressionSize(expression);
    return;
  }
  assertExpressionSize(wrapExpression(expression, 'aaaaaaaa'), {wrapped: true});
}

function interruptibleSleep(getInterrupted) {
  return async ms => {
    let remaining = ms;
    while (remaining > 0) {
      if (getInterrupted()) return;
      const wait = Math.min(remaining, 100);
      const started = Date.now();
      await new Promise(resolve => setTimeout(resolve, wait));
      remaining -= Date.now() - started;
    }
  };
}

async function runCliConsole(args, expression) {
  const config = validateConsoleOptions(args);
  assertConsoleExpressionSize(expression, config.raw);
  const opts = options(args);
  if (config.repeat !== undefined) {
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      console.error('收到 Ctrl+C：等待当前 console 帧结束后停止…');
    };
    const session = await openConsoleSession(opts);
    process.once('SIGINT', onInterrupt);
    let stats;
    let fatal;
    try {
      stats = await runConsoleRepeat(session, expression, {
        intervalMs: config.repeat * 1000,
        times: config.times,
        timeoutMs: config.timeoutMs,
        retries: config.retries,
        raw: config.raw,
      }, {shouldStop: () => interrupted, sleep: interruptibleSleep(() => interrupted)});
    } catch (error) {
      stats = error?.stats;
      fatal = error;
    } finally {
      process.off('SIGINT', onInterrupt);
      consoleSummary(stats || {successful: 0, total: config.times}, session.api);
      await session.close();
    }
    if (fatal) throw fatal;
    return;
  }

  const session = await openConsoleSession(opts);
  try {
    const result = await session.run(expression, {
      timeoutMs: config.timeoutMs,
      retries: config.raw ? 0 : config.retries,
      raw: config.raw,
    });
    printConsoleResult(result, args);
  } finally {
    await session.close();
  }
}

async function main() {
  const args = commandArgs(process.argv.slice(2));
  if (args.command === 'help') {
    console.log(helpText());
    return;
  }
  const opts = options(args);
  if (args.command === 'summary') return printResult(await queries.readSummary(opts), args);
  if (args.command === 'account') {
    const {account} = await context(opts);
    // 附上 GCL 阶梯解析，原始字段保持不变。
    return printResult({...account, gclProgress: gclProgress(account.gcl)}, args);
  }
  if (args.command === 'rooms') return printResult(await queries.listRooms(opts), args);
  if (args.command === 'room') {
    const room = roomArg(args, 'room');
    if (args.objects) return printResult(await queries.getRoomObjects({...opts, room}), args);
    return printResult(await queries.getRoom({...opts, room}), args);
  }
  if (args.command === 'memory') {
    const memoryPath = args.path !== undefined ? args.path : (args._[0] || '');
    const {api, shard} = await context(opts);
    const res = await api.userMemoryGet(memoryPath, shard);
    return printResult(queries.decodeMemoryValue(res?.data), args);
  }
  if (args.command === 'segment') {
    if (args.id === undefined) throw new Error('segment 命令需要 --id，多个 Segment 用逗号分隔');
    return printResult(await queries.getSegment({...opts, id: args.id}), args);
  }
  if (args.command === 'console') {
    const expression = await readConsoleExpression(args);
    return runCliConsole(args, expression);
  }
  if (args.command === 'code') {
    const {api, config} = await context(opts);
    const code = await api.userCodeGet(args.branch || config.codeBranch);
    return printResult({branch: code.branch, modules: Object.keys(code.modules || {})}, args);
  }
  if (args.command === 'market') {
    const {api, shard} = await context(opts);
    return printResult({shard, orders: await api.gameMarketMyOrders(shard)}, args);
  }
  if (args.command === 'messages') {
    const {api} = await context(opts);
    return printResult({unread: await api.userMessagesUnreadCount(), messages: await api.userMessagesIndex()}, args);
  }
  if (args.command === 'overview') {
    const room = roomArg(args, 'overview');
    return printResult(await queries.getRoomStats({...opts, room, interval: args.interval, stat: args.stat, tick: args.tick}), args);
  }
  if (args.command === 'history') {
    throw new Error('history 现在指房间回放（按 tick 还原房间现场），还没实现；房间统计请用 overview <房间>');
  }
  if (args.command === 'shards') return printResult(await queries.listShards(opts), args);
  if (args.command === 'world') return printResult(await readWorld(opts), args);
  if (args.command === 'map') {
    const scan = await scanRooms({
      ...opts,
      room: args.room,
      rooms: args.rooms,
      around: args.around,
      radius: args.radius,
      all: Boolean(args.all),
      concurrency: args.concurrency,
      cacheTtl: args['cache-ttl'],
      noCache: Boolean(args['no-cache']),
    });
    if (args.ascii) {
      for (const item of scan.results) {
        if (!item.ok) continue;
        console.log(`=== ${item.value.room} ===`);
        console.log(terrainAscii(item.value.terrainCells || []));
      }
      return;
    }
    if (args['summary-only']) return printResult({target: scan.target, shard: scan.shard, summary: scan.summary}, args);
    return printResult(scan, args);
  }
  resolveTarget(opts);
  throw new Error(`暂不支持命令：${args.command}`);
}

main().catch(error => {
  const label = error?.kind === 'expression' && error.tick !== undefined ? `表达式执行出错（tick ${error.tick}）：` : '';
  console.error(`查询失败：${label}${error.message}${httpDetail(error)}`);
  process.exitCode = 1;
});
