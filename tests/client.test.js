'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TARGETS, gclProgress, objectSummary, resolveServerConfig, resolveTarget} = require('../src/api/client');

assert.deepEqual(Object.keys(TARGETS), ['main', 'season']);
assert.equal(resolveTarget({target: 'main'}).shard, 'shard2');
assert.equal(resolveTarget({target: 'season'}).shard, 'shardSeason');
assert.equal(resolveTarget({target: 'main', shard: 'shardX'}).shard, 'shardX');
assert.throws(() => resolveTarget({target: 'season', shard: 'shard2'}), /不支持分片/);
assert.throws(() => resolveTarget({target: 'unknown'}), /不支持目标/);

// GCL 阶梯：常量来自 @screeps/common，数值本身由 package-lock 保证，此处只测公式逻辑，
// 期望值用同一常量构造——等级边界在 GCL_MULTIPLY * n^GCL_POW 处，取整方向 floor，边界上 progress 归零。
const {GCL_MULTIPLY} = require('@screeps/common/lib/constants');
assert.equal(gclProgress(GCL_MULTIPLY - 0.01).level, 1);
const level2 = gclProgress(GCL_MULTIPLY);
assert.equal(level2.level, 2);
assert.ok(Math.abs(level2.progress) < 1e-6);
assert.equal(gclProgress(-1), null);
assert.equal(gclProgress(undefined), null);
assert.equal(gclProgress('abc'), null);

// 己方房间：房间级计数与 own* 一致；spawning / storage 仍为己方。
const ownRoom = objectSummary([
  {type: 'controller', level: 4, x: 10, y: 10, user: 'me'},
  {type: 'spawn', user: 'me', spawning: {name: 'worker'}},
  {type: 'tower', user: 'me'},
  {type: 'tower', user: 'me'},
  {type: 'lab', user: 'me'},
  {type: 'factory', user: 'me'},
  {type: 'storage', user: 'me', store: {energy: 123}},
  {type: 'portal', x: 1, y: 2, destination: {room: 'E1N1', shard: 'shardX'}},
  {type: 'creep', user: 'me', name: 'a', x: 3, y: 4, body: [{type: 'move'}]},
  {type: 'creep', user: 'enemy', name: 'b', x: 5, y: 6, body: [{type: 'attack'}]},
], 'me');
assert.equal(ownRoom.rcl, 4);
assert.equal(ownRoom.storageEnergy, 123);
assert.deepEqual(ownRoom.spawning, ['worker']);
assert.equal(ownRoom.spawns, 1);
assert.equal(ownRoom.ownSpawns, 1);
assert.equal(ownRoom.towers, 2);
assert.equal(ownRoom.ownTowers, 2);
assert.equal(ownRoom.labs, 1);
assert.equal(ownRoom.ownLabs, 1);
assert.equal(ownRoom.factories, 1);
assert.equal(ownRoom.ownFactories, 1);
assert.equal(ownRoom.ownCreeps.length, 1);
assert.equal(ownRoom.hostileCreeps.length, 1);
assert.equal(ownRoom.portals.length, 1);

// 敌方房间：towers/spawns 等为房间级（含敌方），own* 为 0；storageEnergy 仍只看己方。
const enemyRoom = objectSummary([
  {type: 'controller', level: 6, x: 20, y: 20, user: 'enemy'},
  {type: 'spawn', user: 'enemy'},
  {type: 'tower', user: 'enemy'},
  {type: 'tower', user: 'enemy'},
  {type: 'tower', user: 'enemy'},
  {type: 'lab', user: 'enemy'},
  {type: 'lab', user: 'enemy'},
  {type: 'factory', user: 'enemy'},
  {type: 'storage', user: 'enemy', store: {energy: 999}},
  {type: 'creep', user: 'enemy', name: 'guard', x: 1, y: 1, body: [{type: 'attack'}]},
], 'me');
assert.equal(enemyRoom.rcl, 6);
assert.equal(enemyRoom.controller.owner, 'enemy');
assert.equal(enemyRoom.towers, 3);
assert.equal(enemyRoom.ownTowers, 0);
assert.equal(enemyRoom.spawns, 1);
assert.equal(enemyRoom.ownSpawns, 0);
assert.equal(enemyRoom.labs, 2);
assert.equal(enemyRoom.ownLabs, 0);
assert.equal(enemyRoom.factories, 1);
assert.equal(enemyRoom.ownFactories, 0);
assert.equal(enemyRoom.storageEnergy, undefined);
assert.deepEqual(enemyRoom.spawning, []);
assert.equal(enemyRoom.ownCreeps.length, 0);
assert.equal(enemyRoom.hostileCreeps.length, 1);

function writeFixture(contents) {
  const file = path.join(os.tmpdir(), `screeps-assistant-config-${Date.now()}-${Math.random().toString(16).slice(2)}.yml`);
  fs.writeFileSync(file, contents);
  return file;
}

const multiAccountFile = writeFixture(`
servers:
  main:
    url: https://screeps.com/
    token: "default-token"
    accounts:
      alt:
        token: "alt-token"
`);

try {
  assert.equal(resolveServerConfig('main', undefined, multiAccountFile).server.token, 'default-token');
  assert.equal(resolveServerConfig('main', 'alt', multiAccountFile).server.token, 'alt-token');
  assert.throws(() => resolveServerConfig('main', 'missing', multiAccountFile), /找不到账号 "missing"/);
} finally {
  fs.unlinkSync(multiAccountFile);
}

const accountsOnlyFile = writeFixture(`
servers:
  main:
    url: https://screeps.com/
    accounts:
      alt:
        token: "alt-token"
`);

try {
  assert.throws(
    () => resolveServerConfig('main', undefined, accountsOnlyFile),
    /未配置默认账号 token.*--account/,
  );
  assert.equal(resolveServerConfig('main', 'alt', accountsOnlyFile).server.token, 'alt-token');
} finally {
  fs.unlinkSync(accountsOnlyFile);
}

console.log('客户端基础测试通过');
