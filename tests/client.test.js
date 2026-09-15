'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TARGETS, objectSummary, resolveServerConfig, resolveTarget} = require('../src/api/client');

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
