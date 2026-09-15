'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {context} = require('../api/client');
const {featureMap, formatRoomName, getNeighborRooms, summarizeResults, summarizeRoom} = require('./analysis');

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

/** 解析并发数：必须是 >= 1 的整数。 */
function parseConcurrency(value, fallback = DEFAULT_CONCURRENCY) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`concurrency 必须是 >= 1 的整数，收到：${value}`);
  return n;
}

/**
 * 解析地形缓存 TTL（毫秒）。
 * 省略 / 空 → 永久缓存；给出则必须是 >= 1 的整数。
 */
function parseCacheTtl(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`cache-ttl 必须是 >= 1 的毫秒整数，收到：${value}`);
  return n;
}

/** 简单并发池：最多 limit 个任务同时进行，单个失败不影响其他房间。 */
async function mapLimit(items, limit, fn) {
  const concurrency = parseConcurrency(limit);
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
  await Promise.all(Array.from({length: Math.min(concurrency, items.length || 1)}, worker));
  return result;
}

function cacheFile(server, shard, room) {
  const safe = `${server}-${shard || 'auto'}-${room}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

/** 读取地形缓存；ttl 为 null 时永不过期，否则按 mtime 判断。 */
function readTerrainCache(file, ttl = null) {
  try {
    if (ttl != null) {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > ttl) return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeTerrainCache(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
  fs.renameSync(temp, file);
}

/** 只缓存地形；status / objects 始终实时拉取。 */
async function loadTerrain(api, server, shard, room, {noCache = false, cacheTtl = null} = {}) {
  const file = cacheFile(server, shard, room);
  if (!noCache) {
    const cached = readTerrainCache(file, cacheTtl);
    if (cached != null) return {terrain: cached, cached: true};
  }
  const response = await api.gameRoomTerrainUnencoded(room, shard);
  const terrain = response.terrain;
  if (!noCache) writeTerrainCache(file, terrain);
  return {terrain, cached: false};
}

/** 查询并汇总单个房间；地形永久缓存（可用 cacheTtl / noCache 调整），状态与对象每次实时查询。 */
async function scanRoom(api, server, shard, room, version, {noCache = false, cacheTtl = null} = {}) {
  const [status, terrainResult, objects] = await Promise.all([
    api.gameRoomStatus(room, shard),
    loadTerrain(api, server, shard, room, {noCache, cacheTtl}),
    api.gameRoomObjects(room, shard),
  ]);
  const result = summarizeRoom({room, status, terrain: terrainResult.terrain, objects: objects.objects, version});
  return {...result, terrainCached: terrainResult.cached};
}

/** 批量扫描房间，返回逐房间结果和范围汇总。 */
async function scanRooms(options = {}) {
  const {target, config, shard, api} = await context(options);
  const version = await api.version();
  let worldSize = null;
  if (options.all) worldSize = await api.gameWorldSize(shard);
  const roomsToQuery = [...new Set(collectRooms({...options, worldSize}))];
  if (!roomsToQuery.length) throw new Error('map 命令需要 --room、--rooms、--around 或 --all 指定扫描范围');
  const concurrency = parseConcurrency(options.concurrency);
  const cacheTtl = parseCacheTtl(options.cacheTtl);
  const results = await mapLimit(roomsToQuery, concurrency, room =>
    scanRoom(api, config.server, shard, room, version, {noCache: Boolean(options.noCache), cacheTtl}));
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

module.exports = {
  CACHE_DIR,
  DEFAULT_CONCURRENCY,
  collectRooms,
  loadTerrain,
  mapLimit,
  parseCacheTtl,
  parseConcurrency,
  readTerrainCache,
  readWorld,
  scanRoom,
  scanRooms,
  writeTerrainCache,
};
