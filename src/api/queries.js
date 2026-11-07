'use strict';

const client = require('./client');
const {HISTORY_CHUNK, chunkBase, replayChanges, replayState} = require('./replay');
const {objectSummary, readSummary} = client;

function decodeMemoryValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 账号原样字段，附上 GCL 阶梯解析。 */
async function getAccount(options = {}) {
  const {account} = await client.context(options);
  return {...account, gclProgress: client.gclProgress(account?.gcl)};
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
 */
async function getRoomHistory(options = {}) {
  if (!options.room) throw new Error('history 查询需要 room');
  const tick = parseTick(options.tick, '--tick');
  if (tick === undefined) throw new Error('history 需要 --tick <tick>（房间回放）；房间统计请用 overview <房间>');
  const to = parseTick(options.to, '--to');
  if (to !== undefined) {
    if (to <= tick) throw new Error(`--to 必须大于 --tick（收到 --tick ${tick} --to ${to}）`);
    if (to - tick > HISTORY_MAX_SPAN) throw new Error(`--tick 到 --to 最多相隔 ${HISTORY_MAX_SPAN} tick（收到 ${to - tick}）；缩小范围，或分段查询`);
  }
  const {api, shard} = await client.context(options);
  const chunks = [];
  for (let base = chunkBase(tick); base <= chunkBase(to ?? tick); base += HISTORY_CHUNK) {
    chunks.push(await fetchHistoryChunk(api, {room: options.room, shard, base, tick: Math.max(tick, base)}));
  }
  const result = to === undefined ? Object.values(replayState(chunks[0], tick)) : replayChanges(chunks, tick, to);
  return withUsernames(result, await resolveUsernames(api, result.map(item => item.user)));
}

/** 按路径读 Memory，返回解码后的值；省略路径读整个 Memory。 */
async function getMemory(options = {}) {
  const {api, shard} = await client.context(options);
  const result = await api.userMemoryGet(options.path || '', shard);
  return decodeMemoryValue(result?.data);
}

async function getSegment(options = {}) {
  if (options.id === undefined || options.id === '') throw new Error('segment 查询需要 id');
  const {api, target, shard} = await client.context(options);
  return {target, shard, segments: await api.userMemorySegmentGet(options.id, shard)};
}

/** 线上代码模块列表；省略 branch 时用目标配置的代码分支。 */
async function getCode(options = {}) {
  const {api, config} = await client.context(options);
  const code = await api.userCodeGet(options.branch || config.codeBranch);
  return {branch: code.branch, modules: Object.keys(code.modules || {})};
}

/** 己方市场挂单。 */
async function getMarketOrders(options = {}) {
  const {api, shard} = await client.context(options);
  return {shard, orders: await api.gameMarketMyOrders(shard)};
}

/** 未读数与消息索引。 */
async function getMessages(options = {}) {
  const {api} = await client.context(options);
  return {unread: await api.userMessagesUnreadCount(), messages: await api.userMessagesIndex()};
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
  HISTORY_MAX_SPAN,
  HISTORY_RETENTION_TICKS,
  decodeMemoryValue,
  estimateTick,
  fetchHistoryChunk,
  formatLocalTime,
  formatRoomStats,
  getAccount,
  getCode,
  getMarketOrders,
  getMemory,
  getMessages,
  getRoom,
  getRoomHistory,
  getRoomObjects,
  getRoomStats,
  getSegment,
  getStatus,
  listRooms,
  listShards,
  readSummary,
  resolveUsernames,
  withUsernames,
};
