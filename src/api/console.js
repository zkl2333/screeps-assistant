'use strict';

const {context} = require('./client');
const {
  assertExpressionSize,
  createRequestId,
  parseResponse,
  unwrapValue,
  wrapExpression,
} = require('./console-protocol');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const CONSOLE_RATE_PATH = '/api/user/console';

class ConsoleError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = this.constructor.name;
    this.kind = kind;
  }
}

class ConsoleRejectedError extends ConsoleError {
  constructor(message, response) {
    super('rejected', message);
    this.response = response;
  }
}

class ConsoleRateLimitError extends ConsoleError {
  constructor(message, rateLimit = {}) {
    super('rate-limit', message);
    this.rateLimit = rateLimit;
  }
}

class ConsoleProtocolError extends ConsoleError {
  constructor(message) {
    super('protocol', message);
  }
}

class ConsoleExpressionError extends ConsoleError {
  constructor(error, {tick, attempts, compact = true} = {}) {
    const text = String(error);
    super('expression', compact ? formatExpressionError(text) : text);
    this.fullError = text;
    this.tick = tick;
    this.attempts = attempts;
  }
}

class ConsoleClosedError extends ConsoleError {
  constructor(message = 'console 会话已关闭，当前请求已取消') {
    super('closed', message);
  }
}

class ConsoleTimeoutError extends ConsoleError {
  constructor(message, {serverErrors = [], attempts = 1} = {}) {
    super('timeout', message);
    this.serverErrors = serverErrors;
    this.attempts = attempts;
  }
}

class AttemptTimeoutError extends Error {}

function formatResetTime(reset) {
  const date = new Date(Number(reset) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('zh-CN', {hour12: false});
}

function rateLimitFromResponse(response, fallback = {}) {
  const headers = response?.headers || {};
  const reset = Number(headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'] ?? fallback.reset);
  return {
    limit: Number(headers['x-ratelimit-limit'] ?? fallback.limit),
    remaining: Number(headers['x-ratelimit-remaining'] ?? fallback.remaining),
    reset: Number.isFinite(reset) ? reset : undefined,
  };
}

function formatExpressionError(error) {
  const lines = String(error).replace(/\r/g, '').split('\n').map(line => line.replace(/\s+$/, '')).filter(Boolean);
  const at = lines.find(line => line.trimStart().startsWith('at '));
  return at ? `${lines[0]}\n${at}` : lines[0] || String(error);
}

function rateLimitFromApi(api) {
  try {
    const limit = api?.rateLimits?.find?.('POST', CONSOLE_RATE_PATH);
    if (!limit || !Number.isFinite(limit.limit)) return null;
    return {limit: limit.limit, remaining: limit.remaining, reset: limit.reset};
  } catch {
    return null;
  }
}

function describeRateLimit(limit) {
  const reset = Number.isFinite(limit?.reset) ? formatResetTime(limit.reset) : null;
  const quota = Number.isFinite(limit?.remaining) && Number.isFinite(limit?.limit)
    ? `，额度剩余 ${limit.remaining}/${limit.limit}`
    : '';
  return `console 额度受限${quota}${reset ? `，${reset} 重置` : ''}`;
}

function createPendingRequest({id, raw, now, attempts}) {
  let settled = false;
  let resolveResponse;
  let rejectResponse;
  const response = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  return {
    id,
    raw,
    serverErrors: [],
    lastServerError: null,
    response,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveResponse(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectResponse(error);
    },
    recordServerError(text) {
      const error = {at: now(), text: String(text)};
      this.serverErrors.push(error);
      this.lastServerError = error;
    },
    get attempts() {
      return attempts();
    },
    get settled() {
      return settled;
    },
  };
}

/** 打开可复用的 console 会话；连接和 console 订阅只建立一次。 */
async function openConsoleSession(options = {}, deps = {}) {
  const resolvedContext = deps.context || context;
  const send = deps.send || ((api, expression, shard) => api.userConsole(expression, shard));
  const now = deps.now || (() => Date.now());
  const log = deps.log || (message => console.error(message));
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const {api, shard} = await resolvedContext(options);

  // screeps-api 默认把 socket error 用 console.error 整段打印；换成静默监听，错误仍经 connect/请求路径上报。
  api.socket.on?.('error', () => {});
  api.socket.off?.('error', console.error);
  await api.socket.connect();
  let pending = null;
  let closed = false;
  let listener;

  function dispatch(event) {
    const data = event?.data;
    if (!data) return;
    if (data.shard !== undefined && data.shard !== shard) return;
    const current = pending;
    if (!current) return;

    if (data.error !== undefined && data.error !== null) {
      current.recordServerError(data.error);
      if (current.raw) {
        current.reject(new ConsoleExpressionError(`表达式执行出错：${data.error}`, {
          attempts: current.attempts,
          compact: false,
        }));
      }
      return;
    }

    const results = data.messages?.results || [];
    for (const result of results) {
      if (current.raw) {
        current.resolve({raw: results});
        return;
      }
      let parsed;
      try {
        parsed = parseResponse(result, current.id);
      } catch (error) {
        current.reject(new ConsoleProtocolError(`console 回包解析失败：${error?.message || error}；回包前 300 字符：${String(result).slice(0, 300)}`));
        return;
      }
      if (!parsed) continue;
      if (parsed.kind === 'e') {
        current.reject(new ConsoleExpressionError(parsed.error, {
          tick: parsed.tick,
          attempts: current.attempts,
        }));
      } else {
        current.resolve(parsed);
      }
      return;
    }
  }

  try {
    await api.socket.subscribe('console', listener = dispatch);
  } catch (error) {
    api.socket.disconnect?.();
    throw error;
  }

  async function waitForBackoff(pendingRequest, delay) {
    let timer;
    const backoff = new Promise(resolve => {
      timer = setTimer(resolve, delay);
    });
    try {
      await Promise.race([backoff, pendingRequest.response]);
      if (pendingRequest.settled) return await pendingRequest.response;
      return null;
    } finally {
      clearTimer(timer);
    }
  }

  async function waitForAttempt(pendingRequest, expression, timeoutMs) {
    let timeoutTimer;
    const timeout = new Promise((_, reject) => {
      timeoutTimer = setTimer(() => reject(new AttemptTimeoutError()), timeoutMs);
    });
    const sending = Promise.resolve()
      .then(() => {
        if (closed) throw new ConsoleClosedError();
        return send(api, expression, shard);
      })
      .then(result => {
        if (result && result.error !== undefined && result.error !== null) {
          throw new ConsoleRejectedError(`console 请求被服务器拒绝：${result.error}`, result);
        }
        if (!result || result.ok === undefined || result.ok === null || result.ok === false) {
          throw new ConsoleRejectedError('console 请求被服务器拒绝：服务器未返回 ok', result);
        }
        return {result};
      });
    // 等待回包或超时时 POST 可能仍未完成；提前挂 catch，避免晚到的网络错误变成未处理拒绝。
    const guardedSending = sending.catch(error => ({error}));

    try {
      const first = await Promise.race([guardedSending, pendingRequest.response, timeout]);
      if (first?.error !== undefined) {
        if (pendingRequest.settled) return await pendingRequest.response;
        throw first.error;
      }
      if (pendingRequest.settled) return await pendingRequest.response;
      return await Promise.race([pendingRequest.response, timeout]);
    } finally {
      clearTimer(timeoutTimer);
    }
  }

  async function run(code, opts = {}) {
    if (closed) throw new ConsoleClosedError('console 会话已关闭');
    if (pending) throw new Error('console 会话已有未完成请求，不能并发 run');
    if (typeof code !== 'string') throw new TypeError('表达式必须是字符串');
    const raw = Boolean(opts.raw);
    let retries = opts.retries === undefined ? (raw ? 0 : DEFAULT_RETRIES) : opts.retries;
    if (!Number.isInteger(retries) || retries < 0) throw new Error('retries 必须是非负整数');
    if (raw && retries > 0) throw new Error('raw 模式不支持重试，请使用包装模式或设置 --retry 0');
    const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs 必须是正数');

    let id = null;
    let expression = code;
    if (!raw) {
      id = createRequestId();
      expression = wrapExpression(code, id);
      assertExpressionSize(expression, {wrapped: true});
    } else {
      assertExpressionSize(expression);
    }

    let attempts = 0;
    const current = createPendingRequest({id, raw, now, attempts: () => attempts});
    pending = current;

    while (true) {
      if (closed) throw new ConsoleClosedError();
      attempts += 1;
      try {
        const response = await waitForAttempt(current, expression, timeoutMs);
        pending = null;
        return formatSuccess(response, shard, attempts);
      } catch (error) {
        if (current.settled) {
          pending = null;
          return formatSuccess(await current.response, shard, attempts);
        }
        if (closed || error instanceof ConsoleClosedError) {
          pending = null;
          throw error instanceof ConsoleClosedError ? error : new ConsoleClosedError();
        }
        if (error instanceof ConsoleExpressionError || error instanceof ConsoleProtocolError || error instanceof ConsoleRejectedError || error instanceof ConsoleRateLimitError) {
          pending = null;
          throw error;
        }
        const status = Number(error?.response?.status ?? error?.status);
        if (status === 429) {
          const fallback = rateLimitFromApi(api) || {};
          const response = error.response || error;
          const limit = rateLimitFromResponse(response, fallback);
          pending = null;
          throw new ConsoleRateLimitError(describeRateLimit(limit), limit);
        }
        // 其他发送失败按普通失败尝试处理；等待期间晚到的回包仍可成功。
      }

      if (closed) throw new ConsoleClosedError();
      if (attempts > retries) {
        const errors = current.serverErrors;
        pending = null;
        let message = `console 执行超时：等待 ${timeoutMs}ms 后未收到回包，已按同一请求 ID 发送 ${attempts} 次。服务端可能在该 tick 因 CPU 上限没有执行命令，也可能已执行但回包丢失。`;
        if (errors.length) {
          const text = errors.map(item => `${new Date(item.at).toLocaleTimeString('zh-CN', {hour12: false})} ${item.text}`).join('；');
          message += `期间服务器报错：${text}。这通常表示该 tick 的 console 命令没有执行。`;
        }
        throw new ConsoleTimeoutError(message, {serverErrors: errors, attempts});
      }

      const delay = Math.min(8000 * (2 ** (attempts - 1)), 15000);
      log(`console 第 ${attempts} 次未收到回包，${Math.round(delay / 1000)}s 后按同一请求 ID 重试…`);
      try {
        const response = await waitForBackoff(current, delay);
        if (response) {
          pending = null;
          return formatSuccess(response, shard, attempts);
        }
      } catch (error) {
        pending = null;
        throw error;
      }
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    const current = pending;
    pending = null;
    current?.reject(new ConsoleClosedError());
    try {
      await api.socket.unsubscribe?.('console', listener);
    } catch {
      // 断开连接是关键清理；unsubscribe 失败不覆盖请求结果。
    } finally {
      api.socket.disconnect?.();
    }
  }

  return {shard, api, run, close};
}

function formatSuccess(response, shard, attempts) {
  if (response && response.raw !== undefined) return {shard, attempts, kind: 'raw', value: response.raw};
  const {id, tick, kind, value} = response;
  return {shard, id, tick, attempts, kind, value};
}

/** 连拍模式复用同一个会话，并按固定节拍逐帧执行。 */
async function runConsoleRepeat(session, expression, options = {}, deps = {}) {
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = deps.now || (() => Date.now());
  const emit = deps.emit || (value => console.log(JSON.stringify(value)));
  const shouldStop = deps.shouldStop || (() => false);
  const {intervalMs, times, timeoutMs, retries = 0, raw = false} = options;
  const t0 = now();
  const stats = {processed: 0, successful: 0, failed: 0, total: times, interrupted: false};

  for (let index = 0; index < times; index += 1) {
    if (shouldStop()) {
      stats.interrupted = true;
      break;
    }
    const wait = t0 + index * intervalMs - now();
    if (wait > 0) await sleep(wait);
    if (shouldStop()) {
      stats.interrupted = true;
      break;
    }

    const frame = index + 1;
    stats.processed += 1;
    try {
      const result = await session.run(expression, {timeoutMs, retries, raw});
      stats.successful += 1;
      emit({frame, tick: result.tick, value: raw ? result.value : unwrapValue(result.value)});
    } catch (error) {
      stats.failed += 1;
      emit({frame, error: error.message, kind: error.kind || 'unknown'});
      if (error.kind === 'rejected' || error.kind === 'rate-limit') {
        error.stats = {...stats};
        throw error;
      }
    }
  }
  return stats;
}

function consoleSummary(stats, api, log = message => console.error(message)) {
  const limit = rateLimitFromApi(api);
  const reset = Number.isFinite(limit?.reset) && limit.reset > 0 ? formatResetTime(limit.reset) : null;
  const quota = limit ? `；console 额度剩余 ${limit.remaining}/${limit.limit}${reset ? `，${reset} 重置` : ''}` : '';
  log(`完成 ${stats.successful}/${stats.total} 帧${quota}`);
}

/** 一次性执行便捷函数；外部脚本沿用。 */
async function runConsole(options, expression, opts = {}) {
  if (typeof opts === 'number') opts = {timeoutMs: opts};
  const session = await openConsoleSession(options);
  try {
    return await session.run(expression, opts);
  } finally {
    await session.close();
  }
}

module.exports = {
  ConsoleClosedError,
  ConsoleError,
  ConsoleExpressionError,
  ConsoleProtocolError,
  ConsoleRateLimitError,
  ConsoleRejectedError,
  ConsoleTimeoutError,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  consoleSummary,
  openConsoleSession,
  rateLimitFromApi,
  runConsole,
  runConsoleRepeat,
};
