'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const client = require('./client');
const {ROOM_ASCII_LEGEND, roomAscii} = require('../map/analysis');
const {HISTORY_CHUNK, chunkBase, replayChanges, replayState} = require('./replay');
const {objectSummary, readSummary} = client;

const SEGMENT_LIMIT_BYTES = 100 * 1024;
const BOOST_RESOURCES = new Set([
  'UH', 'UO', 'KH', 'KO', 'LH', 'LO', 'ZH', 'ZO', 'GH', 'GO',
  'UH2O', 'UHO2', 'KH2O', 'KHO2', 'LH2O', 'LHO2', 'ZH2O', 'ZHO2', 'GH2O', 'GHO2',
  'XUH2O', 'XUHO2', 'XKH2O', 'XKHO2', 'XLH2O', 'XLHO2', 'XZH2O', 'XZHO2', 'XGH2O', 'XGHO2',
]);

function decodeMemoryValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 对字符串型 JSON（仅对象或数组）尝试自动解包；普通文本原样保留。 */
function decodeJsonContainer(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** 递归解码 segment 响应里的 JSON 字符串字段（保留非 JSON 字符串原样）。 */
function decodeSegmentValue(value) {
  if (typeof value === 'string') return decodeJsonContainer(value);
  if (Array.isArray(value)) return value.map(decodeSegmentValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeSegmentValue(v);
    return out;
  }
  return value;
}

function isMultiShardOptions(options = {}) {
  return Boolean(options.allShards) || options.shard === 'all' || (typeof options.shard === 'string' && options.shard.includes(','));
}

/** 单分片直接返回原结果；多分片（--all-shards / --shard s1,s2 / --shard all）并发汇总。 */
async function runAcrossShards(options = {}, singleFn) {
  if (!isMultiShardOptions(options)) return singleFn(options);
  const {target, shards} = client.resolveShards(options);
  if (shards.length === 1) return singleFn({...options, shard: shards[0], allShards: false});
  const entries = await Promise.all(shards.map(async shard => {
    try {
      const value = await singleFn({...options, shard, allShards: false});
      return [shard, value];
    } catch (error) {
      return [shard, {error: error?.message || String(error)}];
    }
  }));
  return {target, shards: Object.fromEntries(entries)};
}

function splitCsv(value) {
  if (!value) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/** 账号原样字段，附上 GCL 阶梯解析。 */
async function getAccount(options = {}) {
  const {account} = await client.context({...options, freshAccount: true});
  return {...account, gclProgress: client.gclProgress(account?.gcl)};
}

async function listShards(options = {}) {
  const {api, account} = await client.context({...options, freshAccount: Boolean(options.cpu)});
  const info = await api.gameShardsInfo();
  if (options.cpu) {
    return {
      totalCpu: account?.cpu ?? null,
      cpuShard: account?.cpuShard || {},
      shards: (info?.shards || []).map(s => ({
        name: s.name,
        tick: s.tick,
        cpuLimit: s.cpuLimit,
        allocatedCpu: account?.cpuShard?.[s.name] ?? null,
      })),
    };
  }
  return info;
}

async function getSummary(options = {}) {
  return runAcrossShards(options, opts => readSummary(opts));
}

async function listRooms(options = {}) {
  return runAcrossShards(options, async opts => {
    const {api, account, target, shard} = await client.context(opts);
    const rooms = await api.userRooms(account._id, shard);
    return {target, shard, rooms: rooms?.shards?.[shard] || []};
  });
}

async function getSingleRoom(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const {api, account, target, shard} = await client.context(options);
  const [data, time, terrainData] = await Promise.all([
    api.gameRoomObjects(options.room, shard),
    attempt(() => api.gameTime(shard)),
    options.ascii ? api.gameRoomTerrain(options.room, 1, shard) : Promise.resolve(null),
  ]);
  const gameTime = time?.time;
  if (options.ascii) {
    return {
      target,
      shard,
      room: options.room,
      gameTime,
      ascii: roomAscii(terrainData?.terrain || [], data.objects || [], account._id),
      legend: ROOM_ASCII_LEGEND,
    };
  }
  return {
    target,
    shard,
    room: options.room,
    gameTime,
    summary: objectSummary(data.objects || [], account._id, {users: data.users, gameTime}),
  };
}

async function getRoom(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const roomNames = splitCsv(options.room);
  if (roomNames.length <= 1) return getSingleRoom({...options, room: roomNames[0] || ''});
  const {api, account, target, shard} = await client.context(options);
  const time = await attempt(() => api.gameTime(shard)).catch(() => null);
  const gameTime = time?.time;
  const entries = await Promise.all(roomNames.map(async room => {
    const data = await api.gameRoomObjects(room, shard);
    return [room, {room, gameTime, summary: objectSummary(data.objects || [], account._id, {users: data.users, gameTime})}];
  }));
  return {target, shard, gameTime, rooms: Object.fromEntries(entries)};
}

/** 官方原样对象；带 user 的对象按回包里的 users 表补上 username，便于按玩家过滤。 */
function withUsernames(objects = [], users = {}) {
  return objects.map(item => {
    const username = item.user == null ? undefined : users[item.user]?.username;
    return username === undefined ? item : {...item, username};
  });
}

/** 房间全部对象：不需要视野，也不占 console 额度；支持逗号多房间。 */
async function getRoomObjects(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const roomNames = splitCsv(options.room);
  const {api, shard} = await client.context(options);
  if (roomNames.length <= 1) {
    const data = await api.gameRoomObjects(roomNames[0], shard);
    return withUsernames(data.objects || [], data.users || {});
  }
  const entries = await Promise.all(roomNames.map(async room => {
    const data = await api.gameRoomObjects(room, shard);
    return [room, withUsernames(data.objects || [], data.users || {})];
  }));
  return Object.fromEntries(entries);
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

/** tick 必须是非负整数；CLI 传来的是字符串，空串也算给了，不能悄悄当成没给。name 是报错里的参数名。 */
function parseTick(value, name = 'tick') {
  if (value === undefined || value === null) return undefined;
  const tick = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(tick) || tick < 0) throw new Error(`${name} 必须是非负整数，收到：${value}`);
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

/** --tick 到 --to 最多相隔多少 tick（最多 11 块）。 */
const HISTORY_MAX_SPAN = 1000;
/**
 * 回放保留期的粗略分界（tick 数），只用来给 404 分类。
 * 正式服 2026-11-05 实测：约 30 万 tick 前的块还在，约 30.5 万 tick 前的块已 404；官方实际按写入时间过期，所以这只是粗略分界。
 */
const HISTORY_RETENTION_TICKS = 300_000;
/** 回放里这两个 user id 不是玩家，也不是合法 ObjectId，不能拿去 userFindById。 */
const SPECIAL_USERS = Object.freeze({'2': 'Invader', '3': 'Source Keeper'});

/**
 * 取一块房间回放。取不到时官方返回 404，响应里分不出原因：这一块还没写完、已过保留期、房间那时不活跃，
 * 保留期内的活跃房间也偶尔整块缺失；再读一次当前 tick 猜最可能的一种，读不到就给通用说明。其它错误原样抛出。
 * tick 是这一块里用户要的那个 tick。
 */
async function fetchHistoryChunk(api, {room, shard, base, tick}) {
  try {
    return await api.history(room, base, shard);
  } catch (error) {
    if (error?.status !== 404 && error?.response?.status !== 404) throw error;
    let current;
    try {
      current = (await attempt(() => api.gameTime(shard)))?.time;
    } catch {
      current = undefined;
    }
    const span = `${base}～${base + HISTORY_CHUNK - 1}`;
    if (!Number.isFinite(current)) throw new Error(`服务器没有 ${room} 的回放块 ${span}（可能还没写完、已过保留期，或房间那时不活跃）`);
    if (tick > current) throw new Error(`tick ${tick} 还没到（当前 tick ${current}）`);
    if (base >= chunkBase(current)) {
      throw new Error(`tick ${tick} 所在的回放块（${span}）还没写完；官方每 ${HISTORY_CHUNK} tick 写一块，现在最新能查到 tick ${chunkBase(current) - 1}`);
    }
    if (current - base > HISTORY_RETENTION_TICKS) {
      throw new Error(`服务器没有 ${room} 的回放块 ${span}：已经过了官方的保留期（实测约 30 万 tick，约 19 天）`);
    }
    throw new Error(`服务器没有 ${room} 的回放块 ${span}：房间那时不活跃，或官方缺了这一块（实测保留期内的活跃房间也偶尔整块 404，换相邻的 tick 试试）`);
  }
}

/**
 * user id 数组（去重去空）→ {id: {username}}，正好是 withUsernames 要的 users 形状。
 * 特殊 id 直接用，其余按 id 查；查不到或失败的 id 不出现，对应对象就没有 username 字段。只取 username，不带 userFindById 回包里的其它字段。
 */
async function resolveUsernames(api, ids) {
  const users = {};
  const lookup = [];
  for (const id of new Set(ids.filter(id => !isBlank(id)))) {
    if (Object.hasOwn(SPECIAL_USERS, id)) users[id] = {username: SPECIAL_USERS[id]};
    else lookup.push(id);
  }
  const found = await Promise.allSettled(lookup.map(id => attempt(() => api.userFindById(id))));
  found.forEach((result, index) => {
    const username = result.status === 'fulfilled' ? result.value?.user?.username : undefined;
    if (typeof username === 'string') users[lookup[index]] = {username};
  });
  return users;
}

/**
 * 官方房间回放（room-history）：任意房间都能查，不需要视野。只给 tick 时还原那一刻的房间现场（和 room --objects 同形状的对象数组）；
 * 再给 to 时返回 (tick, to] 内每个对象的变化记录。带 user 的结果补上 username。
 * bestEffort 为 true 时，自动将未写完的最新块截断到最新完整块并跳过缺失 404 块（提示输出到 stderr）。
 */
async function getRoomHistory(options = {}) {
  if (!options.room) throw new Error('history 查询需要 room');
  const tick = parseTick(options.tick, '--tick');
  if (tick === undefined) throw new Error('history 需要 --tick <tick>（房间回放）；房间统计请用 overview <房间>');
  const to = parseTick(options.to, '--to');
  if (options.changed !== undefined && to === undefined) {
    throw new Error('--changed 需要配合 --to 使用');
  }
  if (to !== undefined) {
    if (to <= tick) throw new Error(`--to 必须大于 --tick（收到 --tick ${tick} --to ${to}）`);
    if (to - tick > HISTORY_MAX_SPAN) throw new Error(`--tick 到 --to 最多相隔 ${HISTORY_MAX_SPAN} tick（收到 ${to - tick}）；缩小范围，或分段查询`);
  }
  const {api, shard} = await client.context(options);
  const bestEffort = Boolean(options.bestEffort);
  let effectiveTo = to;

  if (bestEffort && effectiveTo !== undefined) {
    const current = await attempt(() => api.gameTime(shard)).then(r => r?.time).catch(() => undefined);
    if (Number.isFinite(current)) {
      const latestComplete = chunkBase(current) - 1;
      if (effectiveTo > latestComplete) {
        if (latestComplete <= tick) {
          throw new Error(`tick ${tick} 之后尚无已写完的回放块（当前 tick ${current}，最新可查到 tick ${latestComplete}）`);
        }
        console.error(`提示：--to ${effectiveTo} 尚未落盘，已自动截断到最新完整回放 tick ${latestComplete}`);
        effectiveTo = latestComplete;
      }
    }
  }

  const chunks = [];
  const missingChunks = [];
  for (let base = chunkBase(tick); base <= chunkBase(effectiveTo ?? tick); base += HISTORY_CHUNK) {
    if (!bestEffort || effectiveTo === undefined) {
      chunks.push(await fetchHistoryChunk(api, {room: options.room, shard, base, tick: Math.max(tick, base)}));
      continue;
    }
    try {
      chunks.push(await api.history(options.room, base, shard));
    } catch (error) {
      if (error?.status !== 404 && error?.response?.status !== 404) throw error;
      missingChunks.push(`${base}～${base + HISTORY_CHUNK - 1}`);
    }
  }

  if (bestEffort && !chunks.length) {
    throw new Error(`服务器没有 ${options.room} 在 ${tick}～${effectiveTo} 内的任何可用回放块（全部 404）`);
  }
  if (missingChunks.length) {
    console.error(`提示：已跳过 ${missingChunks.length} 个缺失回放块：${missingChunks.join('、')}`);
  }

  const result = effectiveTo === undefined
    ? Object.values(replayState(chunks[0], tick))
    : replayChanges(chunks, tick, effectiveTo, {changed: options.changed, bestEffort});
  return withUsernames(result, await resolveUsernames(api, result.map(item => item.user)));
}

const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024;

function jsonBytes(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
}

/** 统计 Memory 值及其子键的 JSON 字节占用排行（0 游戏内 CPU）。 */
function memoryStats(value, {limit = 15} = {}) {
  const totalBytes = jsonBytes(value);
  const usagePct = Math.round((totalBytes / MEMORY_LIMIT_BYTES) * 10000) / 100;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {totalBytes, limitBytes: MEMORY_LIMIT_BYTES, usagePct, keys: []};
  }
  const keys = Object.entries(value).map(([key, sub]) => {
    const bytes = jsonBytes(sub);
    const pct = totalBytes > 0 ? Math.round((bytes / totalBytes) * 10000) / 100 : 0;
    const item = {key, bytes, pct};
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      item.topChildren = Object.entries(sub)
        .map(([ck, cv]) => ({key: ck, bytes: jsonBytes(cv)}))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5);
    }
    return item;
  }).sort((a, b) => b.bytes - a.bytes).slice(0, limit);
  return {totalBytes, limitBytes: MEMORY_LIMIT_BYTES, usagePct, keys};
}

/** 从回放变化记录与房间统计中提取关键事故事件并按 tick 排序。 */
function buildIncidentTimeline({room, shard, fromTick, toTick, records = [], overviewStats = []}) {
  const events = [];
  for (const r of records) {
    if (r.op === 'removed') {
      events.push({tick: r.tick, kind: 'removed', id: r.id, type: r.type, structureType: r.structureType, name: r.name, user: r.user, username: r.username, x: r.x, y: r.y});
      continue;
    }
    if (r.op === 'added' && (r.type === 'tombstone' || r.type === 'ruin')) {
      events.push({tick: r.tick, kind: r.type, id: r.id, type: r.type, name: r.name, user: r.user, username: r.username, x: r.x, y: r.y});
      continue;
    }
    if (r.op === 'changed' && r.changes) {
      const interesting = {};
      for (const k of ['hits', 'store', 'safeMode', 'level']) {
        if (r.changes[k] !== undefined) interesting[k] = r.changes[k];
      }
      if (Object.keys(interesting).length) {
        events.push({tick: r.tick, kind: 'changed', id: r.id, type: r.type, structureType: r.structureType, name: r.name, user: r.user, username: r.username, x: r.x, y: r.y, changes: interesting});
      }
    }
  }
  for (const cell of overviewStats) {
    if ((cell.creepsLost || 0) > 0 && (cell.tickEnd == null || cell.tickEnd >= fromTick) && (cell.tickStart == null || cell.tickStart <= toTick)) {
      events.push({tick: cell.tickStart ?? fromTick, kind: 'overview_loss', creepsLost: cell.creepsLost, tickStart: cell.tickStart, tickEnd: cell.tickEnd});
    }
  }
  events.sort((a, b) => a.tick - b.tick);
  return {room, shard, fromTick, toTick, eventCount: events.length, timeline: events};
}

/** 战后时间线：自动串联 history 关键变化与 overview 损失格（默认容错跳过缺失块并截断未落盘块）。 */
async function getIncident(options = {}) {
  if (!options.room) throw new Error('incident 查询需要 room');
  const tick = parseTick(options.tick, '--tick');
  if (tick === undefined) throw new Error('incident 需要 --tick <起始tick>');
  const to = options.to === undefined ? tick + 100 : parseTick(options.to, '--to');
  if (to <= tick) throw new Error(`--to 必须大于 --tick（收到 --tick ${tick} --to ${to}）`);
  if (to - tick > HISTORY_MAX_SPAN) throw new Error(`--tick 到 --to 最多相隔 ${HISTORY_MAX_SPAN} tick（收到 ${to - tick}）`);

  const {api, shard} = await client.context(options);
  let effectiveTo = to;
  const current = await attempt(() => api.gameTime(shard)).then(r => r?.time).catch(() => undefined);
  if (Number.isFinite(current)) {
    const latestComplete = chunkBase(current) - 1;
    if (effectiveTo > latestComplete && latestComplete > tick) {
      effectiveTo = latestComplete;
    }
  }
  const chunks = [];
  for (let base = chunkBase(tick); base <= chunkBase(effectiveTo); base += HISTORY_CHUNK) {
    try {
      chunks.push(await api.history(options.room, base, shard));
    } catch (error) {
      if (error?.status !== 404 && error?.response?.status !== 404) throw error;
    }
  }
  if (!chunks.length) {
    await fetchHistoryChunk(api, {room: options.room, shard, base: chunkBase(tick), tick});
  }
  const records = replayChanges(chunks, tick, effectiveTo, {bestEffort: true});
  const withUsers = withUsernames(records, await resolveUsernames(api, records.map(item => item.user)));
  const overview = await attempt(() => getRoomStats({...options, interval: 8})).catch(() => null);
  const overviewStats = overview?.stats?.creepsLost || [];
  return buildIncidentTimeline({room: options.room, shard, fromTick: tick, toTick: effectiveTo, records: withUsers, overviewStats});
}

/** 按路径读 Memory，返回解码后的值；省略路径读整个 Memory；传 stats 时返回占用排行；支持多分片。 */
async function getMemory(options = {}) {
  return runAcrossShards(options, async opts => {
    const {api, shard} = await client.context(opts);
    const result = await api.userMemoryGet(opts.path || '', shard);
    const decoded = decodeMemoryValue(result?.data);
    if (opts.stats) {
      return {path: opts.path || '', ...memoryStats(decoded)};
    }
    return decoded;
  });
}

function segmentByteStats(rawSegments) {
  const bytesOf = v => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : jsonBytes(v));
  const items = {};
  if (rawSegments && typeof rawSegments === 'object' && !Array.isArray(rawSegments)) {
    if (typeof rawSegments.data === 'string') {
      const bytes = bytesOf(rawSegments.data);
      items.data = {bytes, limitBytes: SEGMENT_LIMIT_BYTES, usagePct: Math.round((bytes / SEGMENT_LIMIT_BYTES) * 10000) / 100};
    } else {
      for (const [k, v] of Object.entries(rawSegments)) {
        if (k === 'ok') continue;
        const bytes = bytesOf(v);
        items[k] = {bytes, limitBytes: SEGMENT_LIMIT_BYTES, usagePct: Math.round((bytes / SEGMENT_LIMIT_BYTES) * 10000) / 100};
      }
    }
  }
  return items;
}

/** 读 Memory Segment；默认自动解码 JSON 字符串（保留 --raw 原样输出），支持 --stats 字节统计与多分片。 */
async function getSegment(options = {}) {
  if (options.id === undefined || options.id === '') throw new Error('segment 查询需要 id');
  return runAcrossShards(options, async opts => {
    const {api, target, shard} = await client.context(opts);
    const rawSegments = await api.userMemorySegmentGet(opts.id, shard);
    const segments = opts.raw ? rawSegments : decodeSegmentValue(rawSegments);
    const out = {target, shard, segments};
    if (opts.stats) out.stats = segmentByteStats(rawSegments);
    return out;
  });
}

/** 汇总单房或分片己方所有房间的资源库存（storage/terminal/lab/factory），纯 HTTP 0 console 额度。 */
function summarizeRoomStock(objects = [], userId, {resourceFilter, boostsOnly} = {}) {
  const owned = objects.filter(item => item.user === userId);
  const controller = objects.find(item => item.type === 'controller');
  const resources = {};
  const addStore = store => {
    if (!store || typeof store !== 'object') return;
    for (const [res, amt] of Object.entries(store)) {
      const num = Number(amt) || 0;
      if (num <= 0) continue;
      if (boostsOnly && !BOOST_RESOURCES.has(res)) continue;
      if (resourceFilter && !resourceFilter.has(res)) continue;
      resources[res] = (resources[res] || 0) + num;
    }
  };
  let storageEnergy = 0;
  let terminalEnergy = 0;
  let storageUsed = 0;
  let terminalUsed = 0;
  const labs = [];
  let factory = null;
  for (const obj of owned) {
    if (obj.type === 'storage') {
      storageEnergy = obj.store?.energy || 0;
      storageUsed = Object.values(obj.store || {}).reduce((s, v) => s + (Number(v) || 0), 0);
      addStore(obj.store);
    } else if (obj.type === 'terminal') {
      terminalEnergy = obj.store?.energy || 0;
      terminalUsed = Object.values(obj.store || {}).reduce((s, v) => s + (Number(v) || 0), 0);
      addStore(obj.store);
    } else if (obj.type === 'lab') {
      addStore(obj.store);
      const mineralType = Object.keys(obj.store || {}).find(k => k !== 'energy' && Number(obj.store[k]) > 0) || obj.mineralType || null;
      if (mineralType) labs.push({id: obj._id, mineralType, amount: obj.store?.[mineralType] ?? obj.mineralAmount ?? 0});
    } else if (obj.type === 'factory') {
      addStore(obj.store);
      factory = {level: obj.level ?? 0, items: Object.keys(obj.store || {}).filter(k => Number(obj.store[k]) > 0).length};
    }
  }
  return {
    rcl: controller?.level ?? null,
    storageEnergy,
    storageUsed,
    terminalEnergy,
    terminalUsed,
    labs,
    factory,
    resources,
  };
}

/** 帝国/分片资源盘点：0 console 额度，支持指定房间、按资源/Boost 筛选以及多分片汇总。 */
async function getStock(options = {}) {
  const resourceList = splitCsv(options.resource);
  const resourceFilter = resourceList.length ? new Set(resourceList) : null;
  const boostsOnly = Boolean(options.boosts);

  const singleShard = async opts => {
    const {api, account, target, shard} = await client.context(opts);
    let roomNames = splitCsv(opts.room);
    if (!roomNames.length) {
      const userRooms = await api.userRooms(account._id, shard);
      roomNames = userRooms?.shards?.[shard] || [];
    }
    const rooms = {};
    const totals = {};
    const concurrency = 4;
    for (let i = 0; i < roomNames.length; i += concurrency) {
      const batch = roomNames.slice(i, i + concurrency);
      const fetched = await Promise.all(batch.map(async room => {
        const data = await api.gameRoomObjects(room, shard);
        return [room, summarizeRoomStock(data.objects || [], account._id, {resourceFilter, boostsOnly})];
      }));
      for (const [room, summary] of fetched) {
        rooms[room] = summary;
        for (const [res, amt] of Object.entries(summary.resources)) {
          totals[res] = (totals[res] || 0) + amt;
        }
      }
    }
    const sortedTotals = Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
    return {target, shard, roomCount: roomNames.length, totals: sortedTotals, rooms};
  };

  if (!isMultiShardOptions(options)) return singleShard(options);
  const multi = await runAcrossShards(options, singleShard);
  const grandTotals = {};
  for (const shardRes of Object.values(multi.shards || {})) {
    for (const [res, amt] of Object.entries(shardRes?.totals || {})) {
      grandTotals[res] = (grandTotals[res] || 0) + amt;
    }
  }
  return {
    target: multi.target,
    totals: Object.fromEntries(Object.entries(grandTotals).sort((a, b) => b[1] - a[1])),
    shards: multi.shards,
  };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 比对线上模块集合与本地文件或构建目录（只读）。 */
function verifyCodeModules(remoteModules = {}, localPath) {
  let stat;
  try {
    stat = fs.statSync(localPath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`本地路径不存在：${localPath}`);
    throw error;
  }

  const files = [];
  if (stat.isFile()) {
    files.push({file: path.basename(localPath), fullPath: localPath});
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(localPath, {withFileTypes: true})) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      files.push({file: entry.name, fullPath: path.join(localPath, entry.name)});
    }
    if (!files.length) throw new Error(`本地目录为空：${localPath}`);
  } else {
    throw new Error(`--verify 只支持文件或目录：${localPath}`);
  }

  const resolveModuleName = file => {
    if (Object.hasOwn(remoteModules, file)) return file;
    if (file.endsWith('.js')) return file.slice(0, -3);
    return file;
  };

  const matched = [];
  const mismatched = [];
  const missingRemote = [];
  const checkedRemote = new Set();

  for (const {file, fullPath} of files) {
    const moduleName = resolveModuleName(file);
    const localContent = fs.readFileSync(fullPath, 'utf8');
    const localBytes = Buffer.byteLength(localContent, 'utf8');
    const localHash = sha256Hex(localContent);
    if (!Object.hasOwn(remoteModules, moduleName)) {
      missingRemote.push({module: moduleName, file, localBytes, localHash});
      continue;
    }
    checkedRemote.add(moduleName);
    const remoteContent = typeof remoteModules[moduleName] === 'string'
      ? remoteModules[moduleName]
      : JSON.stringify(remoteModules[moduleName]);
    const remoteBytes = Buffer.byteLength(remoteContent, 'utf8');
    const remoteHash = sha256Hex(remoteContent);
    if (localHash === remoteHash) {
      matched.push({module: moduleName, file, bytes: localBytes, sha256: localHash});
    } else {
      mismatched.push({module: moduleName, file, localBytes, remoteBytes, localHash, remoteHash});
    }
  }

  const extraRemote = Object.keys(remoteModules).filter(name => !checkedRemote.has(name));
  return {
    ok: mismatched.length === 0 && missingRemote.length === 0,
    matched,
    mismatched,
    missingRemote,
    extraRemote,
  };
}

/** 线上代码模块列表；传 verify 时与本地文件或构建目录逐模块比对大小和 SHA-256。 */
async function getCode(options = {}) {
  const {api, config} = await client.context(options);
  const code = await api.userCodeGet(options.branch || config.codeBranch);
  const modules = code.modules || {};
  if (options.verify !== undefined) {
    return {
      branch: code.branch,
      verifyPath: options.verify,
      ...verifyCodeModules(modules, options.verify),
    };
  }
  return {branch: code.branch, modules: Object.keys(modules)};
}

/** 汇总某资源在当前分片的市场盘口与近期成交统计。 */
function summarizeMarketOrders(orders = [], stats = [], {resource, limit = 5} = {}) {
  const maxRows = Math.max(1, Number(limit) || 5);
  const active = orders.filter(o => (o?.remainingAmount ?? o?.amount ?? 0) > 0);
  const buys = active
    .filter(o => o.type === 'buy')
    .sort((a, b) => b.price - a.price)
    .map(o => ({id: o._id, roomName: o.roomName, price: o.price, remaining: o.remainingAmount ?? o.amount}));
  const sells = active
    .filter(o => o.type === 'sell')
    .sort((a, b) => a.price - b.price)
    .map(o => ({id: o._id, roomName: o.roomName, price: o.price, remaining: o.remainingAmount ?? o.amount}));
  const bestBuy = buys.length ? buys[0].price : null;
  const bestSell = sells.length ? sells[0].price : null;
  const spread = bestBuy !== null && bestSell !== null ? Math.round((bestSell - bestBuy) * 1000) / 1000 : null;
  const buyVolume = buys.reduce((s, o) => s + o.remaining, 0);
  const sellVolume = sells.reduce((s, o) => s + o.remaining, 0);
  const recentStats = stats.slice(-7).map(s => ({
    date: s.date,
    avgPrice: s.avgPrice,
    volume: s.volume,
    stddevPrice: s.stddevPrice,
  }));
  return {
    resource,
    bestBuy,
    bestSell,
    spread,
    buyOrders: buys.length,
    sellOrders: sells.length,
    buyVolume,
    sellVolume,
    topBuys: buys.slice(0, maxRows),
    topSells: sells.slice(0, maxRows),
    recentStats,
  };
}

/** 己方市场挂单；传 resource 查单品或多品（逗号分隔）盘口摘要；传 index 查全服有挂单的资源列表；支持多分片。 */
async function getMarketOrders(options = {}) {
  return runAcrossShards(options, async opts => {
    const {api, shard} = await client.context(opts);
    if (opts.index) {
      const res = await api.gameMarketOrdersIndex(shard);
      const resources = (res?.list || [])
        .map(item => ({resource: item._id, count: item.count}))
        .sort((a, b) => b.count - a.count);
      return {shard, resources};
    }
    if (opts.resource) {
      const resources = splitCsv(opts.resource);
      const fetchOne = async resource => {
        const [ordersRes, statsRes] = await Promise.all([
          api.gameMarketOrders(resource, shard),
          attempt(() => api.gameMarketStats(resource, shard)).catch(() => null),
        ]);
        return summarizeMarketOrders(ordersRes?.list || [], statsRes?.stats || [], {
          resource,
          limit: opts.limit,
        });
      };
      if (resources.length <= 1) {
        return {shard, ...(await fetchOne(resources[0]))};
      }
      const quotes = {};
      for (const resource of resources) {
        quotes[resource] = await fetchOne(resource);
      }
      return {shard, quotes};
    }
    return {shard, orders: await api.gameMarketMyOrders(shard)};
  });
}

/** 格式化 PVP 冲突房间数据，按最近交火时间降序排列。 */
function formatPvpData(pvpResponse = {}, {shard, allShards = false} = {}) {
  const shardMap = pvpResponse.shards || pvpResponse || {};
  const rooms = [];
  for (const [shardName, info] of Object.entries(shardMap)) {
    if (!allShards && shard && shardName !== shard) continue;
    const shardTime = info?.time;
    for (const r of info?.rooms || []) {
      rooms.push({
        shard: shardName,
        room: r._id,
        lastPvpTime: r.lastPvpTime,
        ticksAgo: shardTime != null && r.lastPvpTime != null ? shardTime - r.lastPvpTime : null,
      });
    }
  }
  rooms.sort((a, b) => (b.lastPvpTime || 0) - (a.lastPvpTime || 0));
  return {shard: allShards ? 'all' : shard, count: rooms.length, rooms};
}

async function getPvp(options = {}) {
  const interval = options.interval === undefined ? 100 : parseTick(options.interval, '--interval');
  const {api, shard} = await client.context(options);
  const res = await api.experimentalPvp(interval);
  return {interval, ...formatPvpData(res, {shard, allShards: Boolean(options.allShards)})};
}

/** 格式化核弹发射与落地倒计时数据，按落地时间升序排列。 */
function formatNukesData(nukesResponse = {}, {shard, allShards = false, gameTimeByShard = {}} = {}) {
  const shardMap = nukesResponse.shards || nukesResponse || {};
  const nukes = [];
  for (const [shardName, list] of Object.entries(shardMap)) {
    if (!allShards && shard && shardName !== shard) continue;
    const nowTick = gameTimeByShard[shardName];
    for (const n of Array.isArray(list) ? list : []) {
      nukes.push({
        shard: shardName,
        id: n._id,
        room: n.room,
        launchRoomName: n.launchRoomName,
        x: n.x,
        y: n.y,
        landTime: n.landTime,
        ticksRemaining: nowTick != null && n.landTime != null ? n.landTime - nowTick : null,
      });
    }
  }
  nukes.sort((a, b) => (a.landTime || 0) - (b.landTime || 0));
  return {shard: allShards ? 'all' : shard, count: nukes.length, nukes};
}

/** 汇总 Credit 资金流水。 */
function summarizeMoneyHistory(list = []) {
  let netChange = 0;
  const byType = {};
  for (const item of list) {
    const change = Number(item?.change) || 0;
    netChange += change;
    const type = item?.type || 'unknown';
    const entry = byType[type] || (byType[type] = {count: 0, change: 0});
    entry.count += 1;
    entry.change = Math.round((entry.change + change) * 1000) / 1000;
  }
  return {
    count: list.length,
    netChange: Math.round(netChange * 1000) / 1000,
    byType,
  };
}

/** Credit 资金流水（市场成交、手续费等），支持 --page 分页。 */
async function getMoneyHistory(options = {}) {
  const page = options.page === undefined ? 0 : parseTick(options.page, '--page');
  const {api} = await client.context(options);
  const res = await api.userMoneyHistory(page);
  const list = res?.list || [];
  return {
    page: res?.page ?? page,
    hasMore: Boolean(res?.hasMore),
    summary: summarizeMoneyHistory(list),
    list,
  };
}

/** 按用户名查询其他玩家公开资料（GCL、Power、Badge 等）。 */
async function findPlayer(options = {}) {
  if (!options.username || isBlank(options.username)) throw new Error('player 查询需要 username');
  const {api} = await client.context(options);
  const res = await api.userFind(options.username.trim());
  const user = res?.user;
  if (!user) throw new Error(`未找到玩家：${options.username}`);
  return {
    id: user._id,
    username: user.username,
    gcl: user.gcl,
    gclProgress: client.gclProgress(user.gcl),
    power: user.power,
    cpu: user.cpu,
    badge: user.badge,
  };
}

async function getNukes(options = {}) {
  const {api, shard} = await client.context(options);
  const [res, time] = await Promise.all([
    api.experimentalNukes(),
    attempt(() => api.gameTime(shard)).catch(() => null),
  ]);
  const gameTimeByShard = time?.time != null ? {[shard]: time.time} : {};
  return formatNukesData(res, {shard, allShards: Boolean(options.allShards), gameTimeByShard});
}

/** 未读数与消息索引。 */
async function getMessages(options = {}) {
  const {api} = await client.context(options);
  return {unread: await api.userMessagesUnreadCount(), messages: await api.userMessagesIndex()};
}

/** ObjectId 形态的用户 id：24 位十六进制。 */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * 把用户名或 id 解析成对话接口要的 respondent id。索引回包自带 users 表（id → 用户名），
 * 所以用户名不用额外查询；直接给 id 也认。用户名不区分大小写，但必须完全一致。
 */
function resolveRespondent(index, respondent) {
  const users = index?.users || {};
  const wanted = String(respondent).toLowerCase();
  for (const [id, user] of Object.entries(users)) {
    if (String(user?.username).toLowerCase() === wanted) return {id, username: user.username};
  }
  if (OBJECT_ID.test(respondent)) return {id: respondent, username: users[respondent]?.username};
  const known = Object.values(users).map(user => user?.username).filter(Boolean);
  throw new Error(`找不到该用户名：${respondent}${known.length ? `。已有对话：${known.join('、')}` : ''}`);
}

/**
 * 读一段对话的完整往来（官方 messages/list）。纯 GET，不会把消息标记已读；
 * 只保留呈现需要的字段——原回包每方都带整块 badge 数据，整段线程很容易超过 MCP 的结果上限。
 */
async function getMessageThread(options = {}) {
  if (!options.respondent) throw new Error('读对话需要对方用户名或 id');
  const {api} = await client.context(options);
  const index = await api.userMessagesIndex();
  const {id, username} = resolveRespondent(index, options.respondent);
  const data = await api.userMessagesList(id);
  const messages = (data?.messages || []).map(item => ({
    date: item.date,
    type: item.type,
    text: item.text,
    unread: Boolean(item.unread),
  }));
  return {respondent: {id, username: username ?? null}, count: messages.length, messages};
}

async function getStatus(options = {}) {
  const {target, config, shard} = client.resolveTarget(options);
  let serverCfg;
  try {
    serverCfg = client.resolveServerConfig(target, options.account);
  } catch {
    return {ok: false, target, shard, app: config.app, account: options.account || 'default', hint: '检查 screeps-assistant 根目录的 .screeps.yml 及目标账号配置'};
  }
  const base = {ok: true, target, shard, app: config.app, account: options.account || 'default'};
  if (!options.ping) return base;

  // --ping：联网诊断连通性、/api/version、鉴权与 tick 是否推进（不暴露任何凭据）。
  const started = Date.now();
  const diagnostics = {
    url: serverCfg.server?.url || null,
    authMode: serverCfg.server?.token ? 'token' : (serverCfg.server?.email ? 'email/password' : 'none'),
  };
  try {
    const api = await client.openClient(target, options.account);
    const [versionRes, meRes, t1Res] = await Promise.allSettled([
      attempt(() => api.version()),
      attempt(() => api.authMe()),
      attempt(() => api.gameTime(shard)),
    ]);
    diagnostics.version = versionRes.status === 'fulfilled'
      ? {protocol: versionRes.value?.protocol ?? null, useNativeAuth: versionRes.value?.useNativeAuth ?? null}
      : {error: versionRes.reason?.message || String(versionRes.reason)};
    diagnostics.auth = meRes.status === 'fulfilled'
      ? {ok: true, username: meRes.value?.username ?? null, id: meRes.value?._id ?? null}
      : {ok: false, error: meRes.reason?.message || String(meRes.reason)};
    const tick1 = t1Res.status === 'fulfilled' ? t1Res.value?.time : null;
    let tick2 = null;
    if (Number.isFinite(tick1)) {
      const waitMs = options.pingWaitMs ?? 1500;
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      const t2Res = await attempt(() => api.gameTime(shard)).catch(() => null);
      tick2 = Number.isFinite(t2Res?.time) ? t2Res.time : null;
    }
    diagnostics.gameTime = {
      first: Number.isFinite(tick1) ? tick1 : null,
      second: tick2,
      advancing: Number.isFinite(tick1) && Number.isFinite(tick2) ? tick2 > tick1 : null,
    };
    diagnostics.latencyMs = Date.now() - started;
    return {...base, ok: Boolean(diagnostics.auth.ok), diagnostics};
  } catch (error) {
    diagnostics.latencyMs = Date.now() - started;
    diagnostics.error = error?.message || String(error);
    return {...base, ok: false, diagnostics};
  }
}

module.exports = {
  BOOST_RESOURCES,
  HISTORY_MAX_SPAN,
  HISTORY_RETENTION_TICKS,
  SEGMENT_LIMIT_BYTES,
  buildIncidentTimeline,
  decodeMemoryValue,
  decodeSegmentValue,
  estimateTick,
  fetchHistoryChunk,
  findPlayer,
  formatLocalTime,
  formatNukesData,
  formatPvpData,
  formatRoomStats,
  getAccount,
  getCode,
  getIncident,
  getMarketOrders,
  getMemory,
  getMessageThread,
  getMessages,
  getMoneyHistory,
  getNukes,
  getPvp,
  getRoom,
  getRoomHistory,
  getRoomObjects,
  getRoomStats,
  getSegment,
  getStatus,
  getStock,
  getSummary,
  listRooms,
  listShards,
  memoryStats,
  readSummary,
  resolveUsernames,
  runAcrossShards,
  summarizeMarketOrders,
  summarizeMoneyHistory,
  summarizeRoomStock,
  verifyCodeModules,
  withUsernames,
};
