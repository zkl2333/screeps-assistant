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

function parseStatsInterval(value) {
  if (value === undefined || value === null || value === '') return ROOM_STATS_INTERVALS[0];
  const interval = Number(value);
  if (!ROOM_STATS_INTERVALS.includes(interval)) throw new Error(`interval 只支持 ${ROOM_STATS_INTERVALS.join('、')}（每格分钟数），收到：${value}`);
  return interval;
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

/**
 * 整理 room-overview 回包。endTime 以 interval 分钟为单位：endTime × interval 分钟就是这一格结束的 Unix 时间；
 * 最后一格通常还没结束，标 inProgress。total 按序列求和（官方 totals 只列非零项）。
 */
function formatRoomStats(response, {interval, stat, now = Date.now()} = {}) {
  const stats = response?.stats || {};
  if (stat !== undefined && !stats[stat]) {
    const available = Object.keys(stats);
    throw new Error(available.length ? `未知统计项：${stat}。可选：${available.join(', ')}` : `服务器没有返回该房间的统计数据，读不到 ${stat}`);
  }
  const result = {};
  for (const name of stat === undefined ? Object.keys(stats) : [stat]) {
    const points = Array.isArray(stats[name]) ? stats[name] : [];
    result[name] = {
      total: points.reduce((sum, point) => sum + (Number(point.value) || 0), 0),
      series: points.map(point => {
        const end = point.endTime * interval * 60_000;
        return end > now ? {end: formatLocalTime(end), value: point.value, inProgress: true} : {end: formatLocalTime(end), value: point.value};
      }),
    };
  }
  return {owner: response?.owner?.username ?? null, interval, stats: result};
}

/** 官方房间统计（room-overview）：采集、建造维修、孵化、升级、产出与损失的 creep、超能处理。 */
async function getRoomStats(options = {}) {
  if (!options.room) throw new Error('房间统计需要 room');
  const interval = parseStatsInterval(options.interval);
  const {api, target, shard} = await client.context(options);
  const response = await api.gameRoomOverview(options.room, interval, shard);
  return {target, shard, room: options.room, ...formatRoomStats(response, {interval, stat: options.stat})};
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
