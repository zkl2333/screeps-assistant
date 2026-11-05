'use strict';

const client = require('./client');
const {accountSummary, objectSummary, readSummary} = client;

function decodeMemoryValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function getAccount(options = {}) {
  const {target, shard, account} = await client.context(options);
  return {target, shard, account: accountSummary(account)};
}

async function listShards(options = {}) {
  const {api} = await client.context(options);
  return await api.gameShardsInfo();
}

async function listRooms(options = {}) {
  const {api, account, target, shard} = await client.context(options);
  const rooms = await api.userRooms(account._id, shard);
  return {target, shard, rooms: rooms?.shards?.[shard] || []};
}

async function getRoom(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const {api, account, target, shard} = await client.context(options);
  const data = await api.gameRoomObjects(options.room, shard);
  return {target, shard, room: options.room, summary: objectSummary(data.objects || [], account._id)};
}

/** 官方原样对象；带 user 的对象按回包里的 users 表补上 username，便于按玩家过滤。 */
function withUsernames(objects = [], users = {}) {
  return objects.map(item => {
    const username = item.user == null ? undefined : users[item.user]?.username;
    return username === undefined ? item : {...item, username};
  });
}

/** 房间全部对象：不需要视野，也不占 console 额度。 */
async function getRoomObjects(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const {api, shard} = await client.context(options);
  const data = await api.gameRoomObjects(options.room, shard);
  return withUsernames(data.objects || [], data.users || {});
}

const ROOM_STATS_INTERVALS = Object.freeze([8, 180, 1440]);
const NO_CLOCK_MESSAGE = '读不到当前 tick 或分片平均 tick 时长，无法按 tick 查询';

const isBlank = value => value === undefined || value === null || value === '';

function parseStatsInterval(value) {
  if (isBlank(value)) return ROOM_STATS_INTERVALS[0];
  const interval = Number(value);
  if (!ROOM_STATS_INTERVALS.includes(interval)) throw new Error(`interval 只支持 ${ROOM_STATS_INTERVALS.join('、')}（每格分钟数），收到：${value}`);
  return interval;
}

/** tick 必须是非负整数；CLI 传来的是字符串，空串也算给了，不能悄悄当成没给。 */
function parseTick(value) {
  if (value === undefined || value === null) return undefined;
  const tick = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(tick) || tick < 0) throw new Error(`tick 必须是非负整数，收到：${value}`);
  return tick;
}

/** 本地时间带时区偏移，如 2026-11-05T10:16+08:00；不同时区的机器读到的都是同一时刻。 */
function formatLocalTime(ms) {
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 墙钟时刻（Unix 毫秒）对应的 tick 估算：以读到 gameTime 的那一刻为锚，按分片平均 tick 时长外推。 */
function estimateTick(clock, ms) {
  return clock.gameTime - (clock.at - ms) / clock.tickMs;
}

const coversTick = (cell, tick) => cell.ticks[0] <= tick && tick <= cell.ticks[1];

/** 一格的输出；有 clock 时带上估算的 tick 范围 ticks: [from, to]。 */
function statsCell(point, {interval, now, clock}) {
  const end = point.endTime * interval * 60_000;
  const inProgress = end > now;
  const cell = {};
  if (clock) {
    cell.ticks = [
      Math.round(estimateTick(clock, end - interval * 60_000)),
      inProgress ? clock.gameTime : Math.round(estimateTick(clock, end)) - 1,
    ];
  }
  cell.end = formatLocalTime(end);
  cell.value = point.value;
  if (inProgress) cell.inProgress = true;
  return cell;
}

/**
 * 整理 room-overview 回包。endTime 以 interval 分钟为单位：endTime × interval 分钟就是这一格结束的 Unix 时间；
 * 最后一格通常还没结束，标 inProgress。total 按序列求和（官方 totals 只列非零项）。
 * 有 clock 时每格附上估算的 ticks：已结束的格子 to 取下一格 from 的前一个 tick，相邻格因此首尾相接；
 * 进行中的格子 to 就是当前 tick。给了 tick 时每个统计项只留覆盖它的格子，total 也只算这些格子。
 */
function formatRoomStats(response, {interval, stat, now = Date.now(), clock, tick} = {}) {
  const stats = response?.stats || {};
  if (stat !== undefined && !stats[stat]) {
    const available = Object.keys(stats);
    throw new Error(available.length ? `未知统计项：${stat}。可选：${available.join(', ')}` : `服务器没有返回该房间的统计数据，读不到 ${stat}`);
  }
  if (tick !== undefined && !clock) throw new Error(NO_CLOCK_MESSAGE);
  const result = {};
  for (const name of stat === undefined ? Object.keys(stats) : [stat]) {
    const points = Array.isArray(stats[name]) ? stats[name] : [];
    let series = points.map(point => statsCell(point, {interval, now, clock}));
    if (tick !== undefined) series = series.filter(cell => coversTick(cell, tick));
    result[name] = {total: series.reduce((sum, cell) => sum + (Number(cell.value) || 0), 0), series};
  }
  const head = {owner: response?.owner?.username ?? null, interval};
  if (clock) Object.assign(head, {gameTime: clock.gameTime, tickMs: Math.round(clock.tickMs)});
  if (tick !== undefined) head.tick = tick;
  return {...head, stats: result};
}

/** 同步抛错也按失败算：screeps-api 的 gameTime 在缺 shard 时直接 throw，不返回 rejected promise。 */
const attempt = async call => call();

/**
 * 当前 tick 和分片平均 tick 时长（毫秒），给统计格子换算 tick 用。任何一项读不到就返回 null：统计照常输出，只是没有 tick。
 * at 取两个请求都返回之后的时刻，与读到 gameTime 的那一刻最多差一次往返。
 */
async function readClock(api, shard) {
  const [time, shards] = await Promise.allSettled([attempt(() => api.gameTime(shard)), attempt(() => api.gameShardsInfo())]);
  const at = Date.now();
  if (time.status !== 'fulfilled' || shards.status !== 'fulfilled') return null;
  const gameTime = time.value?.time;
  const tickMs = shards.value?.shards?.find(item => item.name === shard)?.tick;
  if (!Number.isFinite(gameTime) || !Number.isFinite(tickMs) || tickMs <= 0) return null;
  return {gameTime, tickMs, at};
}

/** 按 tick 取统计：auto 时从细到粗找第一档能覆盖它的，否则只查 intervals 里那一档。 */
async function readStatsAtTick(api, {room, shard, tick, stat, clock, intervals, auto}) {
  let nearest = null; // 最后一档有数据却覆盖不到 tick 的范围，报错用
  for (const interval of intervals) {
    const response = await api.gameRoomOverview(room, interval, shard);
    // 没数据的一档直接跳过：带 stat 时 formatRoomStats 会为此报错，而更粗的一档可能有数据。
    if (!Object.keys(response?.stats || {}).length) continue;
    const options = {interval, stat, now: Date.now(), clock};
    const cells = Object.values(formatRoomStats(response, options).stats).flatMap(item => item.series);
    if (!cells.length) continue;
    if (cells.some(cell => coversTick(cell, tick))) return formatRoomStats(response, {...options, tick});
    nearest = {interval, from: Math.min(...cells.map(cell => cell.ticks[0])), to: Math.max(...cells.map(cell => cell.ticks[1]))};
  }
  if (!nearest) throw new Error('服务器没有返回该房间的统计数据');
  if (auto) throw new Error(`tick ${tick} 早于官方房间统计能覆盖的范围（interval ${nearest.interval} 最早覆盖到约 tick ${nearest.from}）`);
  const larger = ROOM_STATS_INTERVALS.filter(value => value > nearest.interval);
  const hint = larger.length ? `，可以换更大的 --interval（${larger.join('、')}）` : '';
  throw new Error(`tick ${tick} 不在 interval ${nearest.interval} 覆盖的范围内（约 tick ${nearest.from}～${nearest.to}）${hint}`);
}

/**
 * 官方房间统计（room-overview）：采集、建造维修、孵化、升级、产出与损失的 creep、超能处理。
 * 读得到时钟就给每格估算 tick 范围；给了 tick 则只留覆盖它的那一格，没指定 interval 时自动选最细的一档。
 */
async function getRoomStats(options = {}) {
  if (!options.room) throw new Error('房间统计需要 room');
  const interval = parseStatsInterval(options.interval);
  const tick = parseTick(options.tick);
  const {api, target, shard} = await client.context(options);
  const clock = await readClock(api, shard);
  let result;
  if (tick === undefined) {
    const response = await api.gameRoomOverview(options.room, interval, shard);
    result = formatRoomStats(response, {interval, stat: options.stat, clock});
  } else {
    if (!clock) throw new Error(NO_CLOCK_MESSAGE);
    if (tick > clock.gameTime) throw new Error(`tick ${tick} 还没到（当前 tick ${clock.gameTime}）`);
    const auto = isBlank(options.interval);
    result = await readStatsAtTick(api, {room: options.room, shard, tick, stat: options.stat, clock, intervals: auto ? ROOM_STATS_INTERVALS : [interval], auto});
  }
  return {target, shard, room: options.room, ...result};
}

async function getMemory(options = {}) {
  if (options.path === undefined || options.path === '') throw new Error('memory 查询需要非空 path，避免无意读取整个 Memory');
  const {api, target, shard} = await client.context(options);
  const result = await api.userMemoryGet(options.path, shard);
  return {target, shard, path: options.path, value: decodeMemoryValue(result?.data)};
}

async function getSegment(options = {}) {
  if (options.id === undefined || options.id === '') throw new Error('segment 查询需要 id');
  const {api, target, shard} = await client.context(options);
  return {target, shard, segments: await api.userMemorySegmentGet(options.id, shard)};
}

function getStatus(options = {}) {
  const {target, config, shard} = client.resolveTarget(options);
  try {
    client.resolveServerConfig(target, options.account);
    return {ok: true, target, shard, app: config.app, account: options.account || 'default'};
  } catch {
    return {ok: false, target, shard, app: config.app, account: options.account || 'default', hint: '检查 screeps-assistant 根目录的 .screeps.yml 及目标账号配置'};
  }
}

module.exports = {
  decodeMemoryValue,
  estimateTick,
  formatLocalTime,
  formatRoomStats,
  getAccount,
  getMemory,
  getRoom,
  getRoomObjects,
  getRoomStats,
  getSegment,
  getStatus,
  listRooms,
  listShards,
  readSummary,
  withUsernames,
};
