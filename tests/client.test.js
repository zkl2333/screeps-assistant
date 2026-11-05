'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {gclProgress, objectSummary, resolveServerConfig, resolveTarget} = require('../src/api/client');

// 内置目标不依赖本机 .screeps.yml：传一个不存在的配置路径。
const NO_CONFIG = path.join(os.tmpdir(), `screeps-assistant-no-config-${process.pid}.yml`);
assert.equal(resolveTarget({target: 'main'}, NO_CONFIG).shard, 'shard2');
assert.equal(resolveTarget({target: 'season'}, NO_CONFIG).shard, 'shardSeason');
assert.equal(resolveTarget({target: 'main', shard: 'shardX'}, NO_CONFIG).shard, 'shardX');
assert.throws(() => resolveTarget({target: 'season', shard: 'shard2'}, NO_CONFIG), /不支持分片/);
assert.throws(() => resolveTarget({target: 'unknown'}, NO_CONFIG), /不支持目标：unknown。可选：main, ptr, season, pserver/);

// PTR 是正式服的测试环境：分片是正式服的子集，默认分片和代码分支与正式服一致。
const mainTarget = resolveTarget({target: 'main'}, NO_CONFIG);
const ptrTarget = resolveTarget({target: 'ptr'}, NO_CONFIG);
assert.equal(ptrTarget.config.server, 'ptr');
assert.ok(ptrTarget.config.shards.every(shard => mainTarget.config.shards.includes(shard)));
assert.equal(ptrTarget.shard, mainTarget.shard);
assert.equal(ptrTarget.config.codeBranch, mainTarget.config.codeBranch);

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

// 服务器块可覆盖内置目标的分片、默认分片和代码分支；新赛季换分片不用改代码。
const overrideFile = writeFixture(`
servers:
  season:
    url: https://screeps.com/season/
    token: "season-token"
    shards: [shardSeason, shardNext]
    defaultShard: shardNext
    codeBranch: s12
  main:
    url: https://screeps.com/
    token: "main-token"
    codeBranch: experiment
  staging:
    url: http://127.0.0.1:21025/
    token: "staging-token"
    defaultShard: shardA
`);

try {
  const season = resolveTarget({target: 'season'}, overrideFile);
  assert.equal(season.shard, 'shardNext');
  assert.equal(season.config.codeBranch, 's12');
  assert.equal(resolveTarget({target: 'season', shard: 'shardSeason'}, overrideFile).shard, 'shardSeason');
  assert.throws(() => resolveTarget({target: 'season', shard: 'shard2'}, overrideFile), /不支持分片 shard2/);

  // 只覆盖一项时，其余沿用内置默认值。
  const main = resolveTarget({target: 'main'}, overrideFile);
  assert.equal(main.config.codeBranch, 'experiment');
  assert.deepEqual(main.config.shards, resolveTarget({target: 'main'}, NO_CONFIG).config.shards);
  assert.equal(main.shard, resolveTarget({target: 'main'}, NO_CONFIG).shard);

  // yml 里新增的服务器块直接可用；只给 defaultShard 时分片列表就是它。
  const staging = resolveTarget({target: 'staging'}, overrideFile);
  assert.equal(staging.shard, 'shardA');
  assert.deepEqual(staging.config.shards, ['shardA']);
  assert.equal(resolveServerConfig('staging', undefined, overrideFile).server.token, 'staging-token');
  assert.throws(() => resolveTarget({target: 'nowhere'}, overrideFile), /不支持目标：nowhere。可选：.*staging/);
} finally {
  fs.unlinkSync(overrideFile);
}

const badOverrideFile = writeFixture(`
servers:
  season:
    url: https://screeps.com/season/
    token: "season-token"
    shards: [shardSeason]
    defaultShard: shardOther
  main:
    url: https://screeps.com/
    token: "main-token"
    shards: shard2
`);

try {
  assert.throws(() => resolveTarget({target: 'season'}, badOverrideFile), /defaultShard "shardOther" 不在分片列表里/);
  assert.throws(() => resolveTarget({target: 'main'}, badOverrideFile), /shards 必须是非空的分片名数组/);
} finally {
  fs.unlinkSync(badOverrideFile);
}

console.log('客户端基础测试通过');
