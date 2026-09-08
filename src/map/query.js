'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {context} = require('../api/client');
const {featureMap, formatRoomName, getNeighborRooms, summarizeResults, summarizeRoom} = require('./analysis');

const DEFAULT_CACHE_TTL = 60_000;
const DEFAULT_CONCURRENCY = 4;
const CACHE_DIR = path.resolve(__dirname, '..', '..', '.cache', 'map');

/** 根据命令行参数确定要扫描的房间列表；--all 需要先读到世界尺寸。 */
function collectRooms({room, rooms, around, radius = 1, all = false, worldSize} = {}) {
  if (rooms) return String(rooms).split(',').map(name => name.trim()).filter(Boolean);
  if (around) return getNeighborRooms(around, Number(radius));
  if (room) return [room];
  if (all) {
    if (!worldSize?.width || !worldSize?.height) throw new Error('扫描整个世界需要先读取目标分片的世界尺寸');
    const result = [];
    const maxX = Math.floor(worldSize.width / 2);
    const maxY = Math.floor(worldSize.height / 2);
    for (let y = -maxY; y < maxY; y++) for (let x = -maxX; x < maxX; x++) result.push(formatRoomName(x, y));
    return result;
  }
  return [];
}

/** 简单并发池：最多 limit 个任务同时进行，单个失败不影响其他房间。 */
async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        result[index] = {ok: true, value: await fn(items[index])};
      } catch (error) {
        result[index] = {ok: false, room: items[index], error: error.message};
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return result;
}

function cacheFile(server, shard, room) {
  const safe = `${server}-${shard || 'auto'}-${room}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readCache(file, ttl) {
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttl) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
  fs.renameSync(temp, file);
}

/** 查询并汇总单个房间；地形不变，默认缓存 60 秒。 */
async function scanRoom(api, server, shard, room, version, {noCache = false, cacheTtl = DEFAULT_CACHE_TTL} = {}) {
  const file = cacheFile(server, shard, room);
  if (!noCache) {
    const cached = readCache(file, cacheTtl);
    if (cached) return {...cached, cached: true};
  }
  const [status, terrain, objects] = await Promise.all([
    api.gameRoomStatus(room, shard),
    api.gameRoomTerrainUnencoded(room, shard),
    api.gameRoomObjects(room, shard),
  ]);
  const result = summarizeRoom({room, status, terrain: terrain.terrain, objects: objects.objects, version});
  if (!noCache) writeCache(file, result);
  return result;
}

/** 批量扫描房间，返回逐房间结果和范围汇总。 */
async function scanRooms(options = {}) {
  const {target, config, shard, api} = await context(options);
  const version = await api.version();
  let worldSize = null;
  if (options.all) worldSize = await api.gameWorldSize(shard);
  const roomsToQuery = [...new Set(collectRooms({...options, worldSize}))];
  if (!roomsToQuery.length) throw new Error('map 命令需要 --room、--rooms、--around 或 --all 指定扫描范围');
  const results = await mapLimit(roomsToQuery, Number(options.concurrency || DEFAULT_CONCURRENCY), room =>
    scanRoom(api, config.server, shard, room, version, {noCache: Boolean(options.noCache), cacheTtl: Number(options.cacheTtl || DEFAULT_CACHE_TTL)}));
  return {target, server: config.server, shard, summary: summarizeResults(results), results};
}

/** 读取目标环境概况：赛季能力、分片、世界尺寸和游戏时间。 */
async function readWorld(options = {}) {
  const {target, config, shard, api} = await context(options);
  const [version, shards, worldSize, time] = await Promise.all([
    api.version(),
    api.gameShardsInfo(),
    api.gameWorldSize(shard).catch(() => null),
    api.gameTime(shard).catch(() => null),
  ]);
  return {
    target,
    server: config.server,
    app: config.app,
    shard,
    capabilities: featureMap(version),
    shards: shards?.shards || [],
    worldSize,
    gameTime: time?.time ?? null,
  };
}

module.exports = {CACHE_DIR, DEFAULT_CACHE_TTL, DEFAULT_CONCURRENCY, collectRooms, mapLimit, readWorld, scanRoom, scanRooms};
