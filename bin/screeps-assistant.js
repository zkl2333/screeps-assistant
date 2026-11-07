#!/usr/bin/env node
'use strict';

const {resolveTarget} = require('../src/api/client');
const logs = require('../src/api/logs');
const {COMMAND_BY_NAME, flagName} = require('../src/commands');
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
const {terrainAscii} = require('../src/map/analysis');

function options(args) {
  return {target: args.target || 'main', shard: args.shard, account: args.account};
}

/**
 * 查询命令的参数：flag 按 camelCase 键取值（CLI 写 kebab-case），positional 参数没给 flag 时按顺序取位置参数，
 * 再叠加通用参数。
 */
function commandOptions(command, args) {
  const result = options(args);
  let next = 0;
  for (const [key, param] of Object.entries(command.params || {})) {
    const value = args[flagName(key)];
    if (value !== undefined) result[key] = value;
    else if (param.positional && args._[next] !== undefined) result[key] = args._[next];
    if (param.positional) next += 1;
  }
  return result;
}

/** 必填参数在联网前校验；房间名和 Segment ID 各有一句带用法的提示。 */
function checkRequired(command, opts) {
  for (const [key, param] of Object.entries(command.params || {})) {
    if (!param.required || (opts[key] !== undefined && opts[key] !== '')) continue;
    if (param.type === 'room') throw new Error(`${command.name} 命令需要房间名：${command.name} W1N1 或 --${flagName(key)} W1N1`);
    if (key === 'id') throw new Error(`${command.name} 命令需要 --id，多个 Segment 用逗号分隔`);
    throw new Error(`${command.name} 命令需要 --${flagName(key)}`);
  }
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
  if (args.command === 'console') {
    const expression = await readConsoleExpression(args);
    return runCliConsole(args, expression);
  }

  const command = COMMAND_BY_NAME[args.command];
  if (!command) {
    resolveTarget(options(args));
    throw new Error(`暂不支持命令：${args.command}`);
  }
  const opts = commandOptions(command, args);
  checkRequired(command, opts);

  // 以下两处只是 CLI 的纯文本输出形式，查询本身与 MCP 共用命令表。
  if (args.command === 'logs') {
    if (args.text && ['pick', 'filter', 'fields', 'compact'].some(key => args[key] !== undefined)) {
      throw new Error('--text 不能和 --pick / --filter / --fields / --compact 一起用');
    }
    // Ctrl+C 只提前结束监听，已收集的日志照常输出。
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    let entries;
    try {
      entries = await command.run(opts, {signal: controller.signal});
    } finally {
      process.off('SIGINT', interrupt);
    }
    if (args.text) {
      for (const entry of entries) console.log(logs.formatLogLine(entry));
      return;
    }
    return printResult(entries, args);
  }
  if (args.command === 'map' && args.ascii) {
    const scan = await command.run({...opts, summaryOnly: false});
    for (const item of scan.results) {
      if (!item.ok) continue;
      console.log(`=== ${item.value.room} ===`);
      console.log(terrainAscii(item.value.terrainCells || []));
    }
    return;
  }
  return printResult(await command.run(opts), args);
}

main().catch(error => {
  const label = error?.kind === 'expression' && error.tick !== undefined ? `表达式执行出错（tick ${error.tick}）：` : '';
  console.error(`查询失败：${label}${error.message}${httpDetail(error)}`);
  process.exitCode = 1;
});
