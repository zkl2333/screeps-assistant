'use strict';

const assert = require('node:assert/strict');
const client = require('../src/api/client');
const queries = require('../src/api/queries');

(async () => {
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
        ]}),
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
  } finally {
    client.context = originalContext;
    client.resolveTarget = originalResolveTarget;
  }
  console.log('共享查询测试通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
