'use strict';

const assert = require('node:assert/strict');
const client = require('../src/api/client');
const queries = require('../src/api/queries');

(async () => {
  // room-overview 的 endTime 以 interval 分钟为单位；最后一格还没结束。
  const interval = 8;
  const slot = Math.floor(Date.now() / (interval * 60_000));
  const overview = {
    owner: {username: 'tester'},
    stats: {
      energyHarvested: [{endTime: slot - 1, value: 100}, {endTime: slot, value: 40}, {endTime: slot + 1, value: 5}],
      creepsLost: [{endTime: slot - 1, value: 0}, {endTime: slot, value: 0}, {endTime: slot + 1, value: 0}],
    },
    totals: {energyHarvested: 145},
  };
  const overviewCalls = [];
  const originalContext = client.context;
  const originalResolveTarget = client.resolveTarget;
  try {
    client.context = async options => ({
      target: options.target || 'main',
      shard: options.shard || 'shardX',
      account: {_id: 'u1', username: 'tester', cpu: 123, gcl: 1000, resources: {pixel: 4}},
      api: {
        userRooms: async () => ({shards: {shardX: ['E49N32']}}),
        gameRoomObjects: async () => ({objects: [
          {type: 'controller', level: 4, user: 'u1', x: 25, y: 25},
          {type: 'spawn', user: 'u1', x: 10, y: 10},
          {type: 'creep', user: '2', name: 'invader', x: 3, y: 3},
          {type: 'source', x: 5, y: 5},
        ], users: {u1: {username: 'tester'}, 2: {username: 'Invader'}}}),
        gameRoomOverview: async (room, interval) => overviewCalls.push({room, interval}) && overview,
        userMemoryGet: async () => ({data: '{"value":42}'}),
        userMemorySegmentGet: async id => ({[id]: 'segment'}),
        gameShardsInfo: async () => ({shards: [{name: 'shardX'}]}),
      },
    });
    client.resolveTarget = options => ({target: options.target || 'main', shard: options.shard || 'shardX', config: {app: 'default', server: 'main'}});

    assert.deepEqual(await queries.listRooms({target: 'main', shard: 'shardX'}), {target: 'main', shard: 'shardX', rooms: ['E49N32']});
    assert.deepEqual((await queries.getRoom({target: 'main', shard: 'shardX', room: 'E49N32'})).summary.spawns, 1);
    assert.deepEqual(await queries.getMemory({target: 'main', shard: 'shardX', path: 'rooms.E49N32'}), {target: 'main', shard: 'shardX', path: 'rooms.E49N32', value: {value: 42}});
    assert.deepEqual(await queries.getSegment({target: 'main', shard: 'shardX', id: '0'}), {target: 'main', shard: 'shardX', segments: {'0': 'segment'}});
    assert.deepEqual(await queries.listShards({target: 'main', shard: 'shardX'}), {shards: [{name: 'shardX'}]});
    await assert.rejects(() => queries.getMemory({path: ''}), /需要非空 path/);
    await assert.rejects(() => queries.getRoom({room: ''}), /需要 room/);

    // 全部对象原样返回；带 user 的补 username，无主对象不加字段。
    const objects = await queries.getRoomObjects({target: 'main', shard: 'shardX', room: 'E49N32'});
    assert.equal(objects.length, 4);
    assert.equal(objects.find(item => item.type === 'creep').username, 'Invader');
    assert.equal(objects.find(item => item.type === 'spawn').username, 'tester');
    assert.equal('username' in objects.find(item => item.type === 'source'), false);

    // 房间统计：总量按序列求和（官方 totals 漏掉的零值项也有），时间可解析回同一时刻，进行中的格子单独标出。
    const stats = await queries.getRoomStats({target: 'main', shard: 'shardX', room: 'E49N32', interval: String(interval)});
    assert.deepEqual(overviewCalls.at(-1), {room: 'E49N32', interval});
    assert.equal(stats.owner, 'tester');
    assert.equal(stats.stats.energyHarvested.total, 145);
    assert.equal(stats.stats.creepsLost.total, 0);
    const series = stats.stats.energyHarvested.series;
    assert.deepEqual(series.map(point => Date.parse(point.end)), [slot - 1, slot, slot + 1].map(index => index * interval * 60_000));
    assert.deepEqual(series.map(point => point.inProgress === true), [false, false, true]);

    const lost = await queries.getRoomStats({target: 'main', shard: 'shardX', room: 'E49N32', stat: 'creepsLost'});
    assert.deepEqual(Object.keys(lost.stats), ['creepsLost']);
    await assert.rejects(() => queries.getRoomStats({room: 'E49N32', stat: 'energyFoo'}), /未知统计项：energyFoo。可选：energyHarvested, creepsLost/);

    // 每格分钟数只有官方给的三档；不合法时联网前就报错。
    const callsBefore = overviewCalls.length;
    await assert.rejects(() => queries.getRoomStats({room: 'E49N32', interval: 60}), /interval 只支持/);
    assert.equal(overviewCalls.length, callsBefore);

    // 服务器没给统计（赛季服时有时无）：不报错，stats 为空；点名要某项时说明原因。
    assert.deepEqual(queries.formatRoomStats({ok: 1}, {interval}), {owner: null, interval, stats: {}});
    assert.throws(() => queries.formatRoomStats({ok: 1}, {interval, stat: 'creepsLost'}), /服务器没有返回该房间的统计数据/);
  } finally {
    client.context = originalContext;
    client.resolveTarget = originalResolveTarget;
  }
  console.log('共享查询测试通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
