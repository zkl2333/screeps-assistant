'use strict';

const assert = require('node:assert/strict');
const {TARGETS, objectSummary, resolveTarget} = require('../src/api/client');

assert.deepEqual(Object.keys(TARGETS), ['main', 'season']);
assert.equal(resolveTarget({target: 'main'}).shard, 'shard2');
assert.equal(resolveTarget({target: 'season'}).shard, 'shardSeason');
assert.equal(resolveTarget({target: 'main', shard: 'shardX'}).shard, 'shardX');
assert.throws(() => resolveTarget({target: 'season', shard: 'shard2'}), /不支持分片/);
assert.throws(() => resolveTarget({target: 'unknown'}), /不支持目标/);

const summary = objectSummary([
  {type: 'controller', level: 4, x: 10, y: 10, user: 'me'},
  {type: 'spawn', user: 'me', spawning: {name: 'worker'}},
  {type: 'storage', user: 'me', store: {energy: 123}},
  {type: 'portal', x: 1, y: 2, destination: {room: 'E1N1', shard: 'shardX'}},
  {type: 'creep', user: 'me', name: 'a', x: 3, y: 4, body: [{type: 'move'}]},
  {type: 'creep', user: 'enemy', name: 'b', x: 5, y: 6, body: [{type: 'attack'}]},
], 'me');
assert.equal(summary.rcl, 4);
assert.equal(summary.storageEnergy, 123);
assert.deepEqual(summary.spawning, ['worker']);
assert.equal(summary.ownCreeps.length, 1);
assert.equal(summary.hostileCreeps.length, 1);
assert.equal(summary.portals.length, 1);
console.log('客户端基础测试通过');
