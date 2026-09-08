'use strict';

const ROOM_RE = /^([WE])(\d+)([NS])(\d+)$/;

/** 把 E5S5 形式的房间名解析为整数坐标，W/N 方向为负。 */
function parseRoomName(name) {
  const match = String(name).match(ROOM_RE);
  if (!match) throw new Error(`房间名格式无效：${name}`);
  const x = match[1] === 'W' ? -Number(match[2]) - 1 : Number(match[2]);
  const y = match[3] === 'N' ? -Number(match[4]) - 1 : Number(match[4]);
  return {name, x, y};
}

/** 把整数坐标还原为房间名，坐标必须来自 parseRoomName 的同一套约定。 */
function formatRoomName(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('房间坐标必须是整数');
  return `${x < 0 ? `W${-x - 1}` : `E${x}`}${y < 0 ? `N${-y - 1}` : `S${y}`}`;
}

/** 返回以 name 为中心、radius 为半径的方形范围内全部房间名（含中心）。 */
function getNeighborRooms(name, radius = 1) {
  const center = parseRoomName(name);
  if (!Number.isInteger(radius) || radius < 0) throw new Error('范围必须是非负整数');
  const result = [];
  for (let y = center.y - radius; y <= center.y + radius; y++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) result.push(formatRoomName(x, y));
  }
  return result;
}

/** 兼容两种地形返回格式：非编码的格子数组，或官方编码的 2500 字符地形串。 */
function terrainCells(terrain) {
  if (!terrain) return [];
  let cells = terrain;
  if (Array.isArray(terrain) && terrain.length === 1 && typeof terrain[0]?.terrain === 'string') cells = terrain[0];
  const encoded = Array.isArray(cells) ? cells[0] || cells['0'] : cells;
  if (Array.isArray(cells) && cells.every(cell => cell && typeof cell.type === 'string')) return cells;
  if (!encoded || typeof encoded.terrain !== 'string') return [];
  const result = [];
  for (let i = 0; i < encoded.terrain.length; i++) {
    const value = Number(encoded.terrain[i]);
    if (value === 0) continue;
    result.push({x: i % 50, y: Math.floor(i / 50), type: value === 1 ? 'wall' : value === 2 ? 'swamp' : `unknown:${value}`});
  }
  return result;
}

/** 统计一个房间的墙、沼泽、平地格子数。 */
function terrainSummary(terrain) {
  const cells = terrainCells(terrain);
  const result = {wall: 0, swamp: 0, plain: 2500 - cells.length, unknown: 0, total: 2500};
  for (const cell of cells) {
    if (cell.type === 'wall') result.wall++;
    else if (cell.type === 'swamp') result.swamp++;
    else result.unknown++;
  }
  result.plain = Math.max(0, result.plain);
  return result;
}

/** 把地形渲染为 50 行 ASCII 图：# 墙、~ 沼泽、. 平地。 */
function terrainAscii(terrain) {
  const grid = Array.from({length: 50}, () => Array(50).fill('.'));
  for (const cell of terrainCells(terrain)) grid[cell.y][cell.x] = cell.type === 'wall' ? '#' : cell.type === 'swamp' ? '~' : '?';
  return grid.map(row => row.join('')).join('\n');
}

/** 从 version() 返回值提取服务器能力：是否赛季服、自定义对象、赛季资源类型、是否有反应堆。 */
function featureMap(version = {}) {
  // 赛季服的 features 在 serverData.features，旧版服务器在顶层 features
  const features = version.features || version.serverData?.features || [];
  const names = new Set(features.map(feature => feature && feature.name).filter(Boolean));
  const custom = version.serverData?.customObjectTypes || {};
  const resources = {};
  for (const feature of features) {
    for (const [type, name] of Object.entries(feature?.resourceTypeNames || {})) resources[type] = name;
  }
  return {
    season: names.has('season-world') || names.has('season11') || Boolean(version.serverData?.season),
    seasonFeatures: [...names].filter(name => name.startsWith('season')),
    customObjectTypes: Object.keys(custom),
    resourceTypeNames: resources,
    hasReactor: Boolean(custom.reactor),
    hasSeasonResource: Object.keys(resources).length > 0,
  };
}

/** 按服务器能力把房间对象分类；矿物类型命中赛季资源表时计入 seasonResources。 */
function classifyObjects(objects = [], capabilities = {}) {
  const result = {
    controller: [],
    sources: [],
    minerals: [],
    seasonResources: [],
    reactors: [],
    keeperLairs: [],
    invaderCores: [],
    other: [],
  };
  const resourceTypes = new Set(Object.keys(capabilities.resourceTypeNames || {}));
  for (const object of objects) {
    if (object.type === 'controller') result.controller.push(object);
    else if (object.type === 'source') result.sources.push(object);
    else if (object.type === 'mineral') {
      result.minerals.push(object);
      if (resourceTypes.has(object.mineralType)) result.seasonResources.push(object);
    } else if (object.type === 'reactor' || object.structureType === 'reactor') result.reactors.push(object);
    else if (object.type === 'keeperLair') result.keeperLairs.push(object);
    else if (object.type === 'invaderCore') result.invaderCores.push(object);
    else result.other.push(object);
  }
  return result;
}

/** 汇总单个房间的状态、地形、资源和反应堆，用于选点比较。 */
function summarizeRoom({room, status, terrain, objects, version}) {
  const capabilities = featureMap(version);
  const classified = classifyObjects(objects, capabilities);
  const seasonResourceAmount = classified.seasonResources.reduce((sum, item) => sum + (item.mineralAmount || 0), 0);
  return {
    room,
    status: status?.room?.status || status?.status || null,
    terrain: terrainSummary(terrain),
    terrainCells: terrainCells(terrain),
    controller: classified.controller[0] || null,
    sources: classified.sources.length,
    minerals: classified.minerals.map(item => ({type: item.mineralType, amount: item.mineralAmount || 0, x: item.x, y: item.y})),
    seasonResources: classified.seasonResources.map(item => ({type: item.mineralType, amount: item.mineralAmount || 0, x: item.x, y: item.y})),
    seasonResourceAmount,
    reactors: classified.reactors.map(item => ({x: item.x, y: item.y, owner: item.user || item.owner || null, store: item.store || {}, launchTime: item.launchTime || null})),
    keeperLairs: classified.keeperLairs.length,
    invaderCores: classified.invaderCores.length,
    capabilities,
  };
}

/** 聚合一批房间的扫描结果，给出范围级的总数统计。results 元素为 {ok, value|error}。 */
function summarizeResults(results) {
  const successful = results.filter(item => item.ok).map(item => item.value);
  return {
    rooms: successful.length,
    failed: results.length - successful.length,
    controllers: successful.filter(room => room.controller).length,
    reactors: successful.reduce((sum, room) => sum + room.reactors.length, 0),
    seasonResourceAmount: successful.reduce((sum, room) => sum + room.seasonResourceAmount, 0),
    terrain: successful.reduce((sum, room) => ({wall: sum.wall + room.terrain.wall, swamp: sum.swamp + room.terrain.swamp, plain: sum.plain + room.terrain.plain}), {wall: 0, swamp: 0, plain: 0}),
  };
}

module.exports = {classifyObjects, featureMap, formatRoomName, getNeighborRooms, parseRoomName, summarizeResults, summarizeRoom, terrainAscii, terrainCells, terrainSummary};
