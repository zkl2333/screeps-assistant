'use strict';

const assert = require('node:assert/strict');
const {
  classifyObjects,
  featureMap,
  formatRoomName,
  getNeighborRooms,
  parseRoomName,
  summarizeResults,
  summarizeRoom,
  terrainAscii,
  terrainSummary,
} = require('../src/map/analysis');
const {collectRooms, mapLimit} = require('../src/map/query');

// 房间名与坐标互转
assert.deepEqual(parseRoomName('W3N2'), {name: 'W3N2', x: -4, y: -3});
assert.equal(formatRoomName(-3, -2), 'W2N1');
assert.equal(formatRoomName(0, 0), 'E0S0');
assert.deepEqual(getNeighborRooms('E0S0', 1), [
  'W0N0', 'E0N0', 'E1N0',
  'W0S0', 'E0S0', 'E1S0',
  'W0S1', 'E0S1', 'E1S1',
]);
assert.throws(() => parseRoomName('bad'), /房间名格式无效/);
assert.throws(() => getNeighborRooms('E0S0', -1), /非负整数/);

// 地形统计：非编码格子数组
const cellsTerrain = [
  {room: 'E0S0', x: 0, y: 0, type: 'wall'},
  {room: 'E0S0', x: 1, y: 0, type: 'swamp'},
];
assert.deepEqual(terrainSummary(cellsTerrain), {wall: 1, swamp: 1, plain: 2498, unknown: 0, total: 2500});
assert.match(terrainAscii(cellsTerrain), /^#~\./);

// 地形统计：官方编码地形串
assert.deepEqual(terrainSummary([{room: 'E0S0', terrain: '120'}]), {wall: 1, swamp: 1, plain: 2498, unknown: 0, total: 2500});
assert.deepEqual(terrainSummary(undefined), {wall: 0, swamp: 0, plain: 2500, unknown: 0, total: 2500});

// 服务器能力识别与对象分类
const capabilities = featureMap({features: [{name: 'season11', resourceTypeNames: {T: 'thorium'}}], serverData: {customObjectTypes: {reactor: {}}}});
assert.equal(capabilities.season, true);
assert.equal(capabilities.hasReactor, true);
assert.equal(capabilities.resourceTypeNames.T, 'thorium');
assert.equal(featureMap({}).season, false);

// 赛季服的 features 放在 serverData.features（当前线上实际格式）
const nested = featureMap({serverData: {features: [{name: 'season11', resourceTypeNames: {T: 'thorium'}}], customObjectTypes: {reactor: {}}}});
assert.equal(nested.season, true);
assert.equal(nested.resourceTypeNames.T, 'thorium');
assert.equal(nested.hasReactor, true);
const classified = classifyObjects([
  {type: 'mineral', mineralType: 'T', mineralAmount: 3000},
  {type: 'mineral', mineralType: 'H', mineralAmount: 1000},
  {type: 'reactor', x: 9, y: 24},
  {type: 'controller', level: 0},
], capabilities);
assert.equal(classified.seasonResources.length, 1);
assert.equal(classified.minerals.length, 2);
assert.equal(classified.reactors.length, 1);

// 单房间汇总
const room = summarizeRoom({
  room: 'E0S0',
  status: {room: {status: 'normal'}},
  terrain: cellsTerrain,
  objects: [
    {type: 'source', x: 5, y: 5},
    {type: 'mineral', mineralType: 'T', mineralAmount: 3000, x: 7, y: 7},
    {type: 'reactor', x: 9, y: 24, user: 'me', store: {T: 100}},
  ],
  version: {features: [{name: 'season11', resourceTypeNames: {T: 'thorium'}}], serverData: {customObjectTypes: {reactor: {}}}},
});
assert.equal(room.status, 'normal');
assert.equal(room.sources, 1);
assert.equal(room.seasonResourceAmount, 3000);
assert.deepEqual(room.reactors, [{x: 9, y: 24, owner: 'me', store: {T: 100}, launchTime: null}]);

// 范围汇总：失败的房间只计入 failed
const aggregated = summarizeResults([
  {ok: true, value: room},
  {ok: false, room: 'E1S0', error: 'not found'},
]);
assert.equal(aggregated.rooms, 1);
assert.equal(aggregated.failed, 1);
assert.equal(aggregated.seasonResourceAmount, 3000);
assert.equal(aggregated.terrain.wall, 1);

// 扫描范围收集
assert.deepEqual(collectRooms({room: 'E5S5'}), ['E5S5']);
assert.deepEqual(collectRooms({rooms: 'E5S5, E6S5'}), ['E5S5', 'E6S5']);
assert.equal(collectRooms({around: 'E5S5', radius: 2}).length, 25);
const all = collectRooms({all: true, worldSize: {width: 10, height: 10}});
assert.equal(all.length, 100);
assert.ok(all.includes('E0S0') && all.includes('E4S4') && all.includes('W4N4') && !all.includes('E5S0'));
assert.throws(() => collectRooms({all: true}), /世界尺寸/);
assert.deepEqual(collectRooms({}), []);

// 并发池：不超过并发上限，单个失败不影响整体
async function testMapLimit() {
  let active = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async item => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    if (item === 3) throw new Error('boom');
    return item * 2;
  });
  assert.ok(peak <= 2, `并发峰值 ${peak} 应不超过 2`);
  assert.deepEqual(results[0], {ok: true, value: 2});
  assert.equal(results[2].ok, false);
  assert.equal(results[2].error, 'boom');
  assert.equal(results.filter(item => item.ok).length, 4);
}

testMapLimit()
  .then(() => console.log('地图分析测试通过'))
  .catch(error => { console.error(error); process.exitCode = 1; });
