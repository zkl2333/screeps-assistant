'use strict';

const {context} = require('./client');
const {decodeHtmlEntities} = require('./console-protocol');

const DEFAULT_DURATION = 30; // 秒
const MAX_DURATION = 600; // 秒
const DEFAULT_LIMIT = 200; // 行
const MAX_LIMIT = 5000; // 行
/** 判定“像报错”的文本：JS 异常类名、Exception、Uncaught，以及中文的报错/错误/异常。常量单独放，方便以后调。 */
const ERROR_PATTERN = /\w*Error\b|Exception|Uncaught|报错|错误|异常/;

/** 同步抛错也按失败算：screeps-api 的 gameTime 在缺 shard 时直接 throw，不返回 rejected promise。 */
const attempt = async call => call();

/**
 * bot 的日志是带 HTML 的字符串（<font> 颜色、<a> 房间链接）。先去标签再解码实体，顺序不能反，
 * 否则字面量 &lt;b&gt; 会被当成标签。保留文本里原有的空格（bot 用空格给标签对齐），只去尾部空白。
 */
function stripHtml(html) {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, '')).trimEnd();
}

/** 报错条目：脚本抛出的未捕获异常（error 为 true），或文本像报错。 */
function isErrorEntry(entry) {
  return entry.error === true || ERROR_PATTERN.test(entry.text);
}

/** CLI 传来的是字符串：只接受纯数字串（或整数），范围 1..max；undefined 取默认值。 */
function parseBoundedInteger(value, fallback, max, describe) {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(describe(value));
  return parsed;
}

function parseDuration(value) {
  return parseBoundedInteger(value, DEFAULT_DURATION, MAX_DURATION, received => `--duration 必须是 1～${MAX_DURATION} 的整数（秒），收到：${received}`);
}

function parseLimit(value) {
  return parseBoundedInteger(value, DEFAULT_LIMIT, MAX_LIMIT, received => `--limit 必须是 1～${MAX_LIMIT} 的整数，收到：${received}`);
}

/**
 * 事件里没有 tick，只能按到达时间估算：start、end 是监听前后各读一次 gameTime 得到的锚点 {at, tick}（at 为 Unix 毫秒），
 * 两端点之间按到达时间线性插值（端点外线性外推）。用实测斜率而不是分片平均 tick 时长，不依赖 gameShardsInfo。
 * 两端各有 ±0.5 tick 的取整误差，整体误差约 ±1～2 tick。锚点缺失或不一致时返回 undefined。
 */
function estimateTick(at, start, end) {
  if (!start || !end) return undefined;
  if (!(end.at > start.at) || end.tick < start.tick) return undefined;
  const tick = Math.round(start.tick + (at - start.at) * (end.tick - start.tick) / (end.at - start.at));
  return Number.isFinite(tick) ? tick : undefined;
}

/** --text 用的一行：`~tick shard [错误] 文本`；tick 只有目标分片的行才有。 */
function formatLogLine(entry) {
  return `${entry.tick === undefined ? '' : `~${entry.tick} `}${entry.shard} ${entry.error ? '[错误] ' : ''}${entry.text}`;
}

/** 读一次当前 tick 作为锚点，时刻取请求往返的中点。读不到（抛错、同步抛错、time 不是有限数）时 anchor 为 undefined，不影响监听。 */
async function readAnchor(api, shard, now) {
  const before = now();
  let tick;
  try {
    const res = await attempt(() => api.gameTime(shard));
    if (Number.isFinite(res?.time)) tick = res.time;
  } catch {
    // 读不到只影响 tick 估算
  }
  const after = now();
  return {before, anchor: tick === undefined ? undefined : {at: (before + after) / 2, tick}};
}

/** 一条 console 事件里属于 bot 日志的行：log 里的每个字符串，加上未捕获异常文本（标记为报错）。results 是表达式回包，不是日志，忽略。 */
function logLines(data) {
  const lines = [];
  const log = data?.messages?.log;
  if (Array.isArray(log)) {
    for (const line of log) {
      if (typeof line !== 'string') continue;
      const text = stripHtml(line);
      if (text) lines.push({text});
    }
  }
  const error = data?.error;
  if (error !== undefined && error !== null) {
    const text = stripHtml(String(error));
    if (text) lines.push({text, error: true});
  }
  return lines;
}

/**
 * 把一条事件转成条目并按条件过滤。监听中“达到 --limit 就提前结束”的计数和最后的汇总都用它，口径一致：先过滤、再计数。
 * 返回：全部分片的日志行数、目标分片的日志行数（都在 --errors / --grep 过滤之前），以及过滤后的条目。
 * data.shard 缺失（私服）视为目标分片；其它分片的条目只在 allShards 时保留。grep 已转小写。
 */
function parseEvent(data, {shard, allShards, errors, grep}) {
  const lines = logLines(data);
  const isTarget = data?.shard === undefined || data.shard === shard;
  const entries = [];
  if (isTarget || allShards) {
    for (const line of lines) {
      const entry = {shard: isTarget ? shard : data.shard, text: line.text};
      if (line.error) entry.error = true;
      if (errors && !isErrorEntry(entry)) continue;
      if (grep !== undefined && !entry.text.toLowerCase().includes(grep)) continue;
      entries.push(entry);
    }
  }
  return {lines: lines.length, targetLines: isTarget ? lines.length : 0, entries};
}

/**
 * 订阅 console 事件流听 bot 打印的日志，听 duration 秒（或收满 limit 行、或 signal 被 abort）后返回条目数组。
 * 只订阅，不发送任何表达式，不占 console 发送额度；没有历史，只能往后听。
 * 条目：{tick?, shard, text, error?}；tick 是按到达时间估算的，只有目标分片的条目才有。
 */
async function collectLogs(options = {}, deps = {}) {
  // 联网之前先校验参数：非法参数一次连接都不该建立。
  const duration = parseDuration(options.duration);
  const limit = parseLimit(options.limit);
  const grep = options.grep === undefined || options.grep === null ? undefined : String(options.grep);
  if (grep === '') throw new Error('--grep 不能为空');

  const resolveContext = deps.context || context;
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const log = deps.log || (message => console.error(message));
  const signal = deps.signal;

  const {api, shard} = await resolveContext(options);
  const socket = api.socket;
  // screeps-api 默认把 socket error 用 console.error 整段打印；换成静默监听，连接失败仍经 connect 抛出。
  socket.on?.('error', () => {});
  socket.off?.('error', console.error);
  await socket.connect();

  const filter = {shard, allShards: Boolean(options.allShards), errors: Boolean(options.errors), grep: grep?.toLowerCase()};
  const records = []; // 按到达顺序：到达时刻 + 这条事件里已过滤的条目
  let collected = 0;
  let allLines = 0;
  let targetLines = 0;

  // 结束信号：duration 到、收满 limit、signal abort，以先到者为准；结束后到达的事件不再记录。
  let ended = false;
  let reason;
  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });
  const finish = why => {
    if (ended) return;
    ended = true;
    reason = why;
    resolveDone();
  };

  // 回调里只做记录：转条目 + 过滤（用来数已收集条数），tick 要等两端锚点都读到才能算。
  const listener = event => {
    if (ended) return;
    const at = now();
    const parsed = parseEvent(event?.data, filter);
    allLines += parsed.lines;
    targetLines += parsed.targetLines;
    if (!parsed.entries.length) return;
    records.push({at, entries: parsed.entries});
    collected += parsed.entries.length;
    if (collected >= limit) finish('limit');
  };

  let timer;
  let timerSet = false;
  const onAbort = () => finish('abort');
  const stopWaiting = () => {
    if (timerSet) clearTimer(timer);
    timerSet = false;
    signal?.removeEventListener('abort', onAbort);
  };

  let subscribed = false;
  let start;
  let end;
  try {
    await socket.subscribe('console', listener);
    subscribed = true;
    timer = setTimer(() => finish('duration'), duration * 1000);
    timerSet = true;
    if (signal?.aborted) finish('abort');
    else signal?.addEventListener('abort', onAbort, {once: true});
    start = await readAnchor(api, shard, now);
    await done;
    stopWaiting();
    end = await readAnchor(api, shard, now);
  } finally {
    // 无论成败都要清理；unsubscribe / disconnect 失败不覆盖主结果。订阅都没成功就没有 unsubscribe 可做。
    ended = true;
    stopWaiting();
    if (subscribed) {
      try {
        await socket.unsubscribe?.('console', listener);
      } catch {
        // 断开连接才是关键清理
      }
    }
    try {
      socket.disconnect?.();
    } catch {
      // 同上
    }
  }

  const arrivals = records.flatMap(({at, entries}) => entries.map(entry => ({at, entry})));
  const truncated = arrivals.length > limit;
  const result = arrivals.slice(0, limit).map(({at, entry}) => {
    // 锚点读的是目标分片的 tick，其它分片的条目没有 tick。
    const tick = entry.shard === shard ? estimateTick(at, start.anchor, end.anchor) : undefined;
    return tick === undefined ? entry : {tick, ...entry};
  });

  const seconds = Math.round((end.before - start.before) / 100) / 10;
  let summary = `听了 ${seconds} 秒：收到 ${allLines} 行（目标分片 ${targetLines} 行），输出 ${result.length} 行`;
  if (reason === 'limit' || truncated) summary += '；已达 --limit，提前结束';
  if (!start.anchor || !end.anchor) summary += '；读不到当前 tick，条目没有估算 tick';
  if (reason === 'abort') summary += '；被中断';
  log(summary);
  return result;
}

module.exports = {
  DEFAULT_DURATION,
  DEFAULT_LIMIT,
  ERROR_PATTERN,
  MAX_DURATION,
  MAX_LIMIT,
  collectLogs,
  estimateTick,
  formatLogLine,
  isErrorEntry,
  parseDuration,
  parseLimit,
  stripHtml,
};
