'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  createRequestId,
  jsonExpressionLength,
  parseResponse,
  unwrapValue,
  wrapExpression,
} = require('../src/api/console-protocol');
const {
  DEFAULT_TOOLKIT_VERSION,
  clearToolbox,
  flushInbox,
  injectToolbox,
  pushInbox,
  runLargeConsole,
  statusToolbox,
} = require('../src/api/toolbox');

function createMockSession() {
  const memory = {rooms: {W1N1: {}}, creeps: {}};
  const context = {
    FIND_SOURCES: 105,
    FIND_MY_SPAWNS: 112,
    FIND_MY_STRUCTURES: 107,
    FIND_MY_CREEPS: 101,
    FIND_HOSTILE_CREEPS: 103,
    STRUCTURE_TOWER: 'tower',
    Memory: memory,
    Game: {
      time: 1000,
      cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 9500,
        getUsed: () => 3.456,
        getHeapStatistics: () => ({used_heap_size: 10 * 1048576, heap_size_limit: 128 * 1048576}),
      },
      rooms: {
        W1N1: {
          name: 'W1N1',
          controller: {level: 4, my: true, progress: 100, progressTotal: 1000, ticksToDowngrade: 5000},
          energyAvailable: 550,
          energyCapacityAvailable: 1300,
          storage: {store: {energy: 12000, getUsedCapacity: () => 15000}},
          terminal: null,
          find: type => {
            if (type === 105) return [{id: 'src1', energy: 3000, energyCapacity: 3000}];
            if (type === 112) return [{name: 'Spawn1', spawning: null}];
            if (type === 107) return [{structureType: 'tower'}];
            if (type === 101) return [{name: 'c1'}];
            return [];
          },
        },
      },
      creeps: {
        h1: {name: 'h1', room: {name: 'W1N1'}, ticksToLive: 1200, body: [1, 2, 3], memory: {role: 'harvester'}},
        u1: {name: 'u1', room: {name: 'W1N1'}, ticksToLive: 800, body: [1, 2], memory: {role: 'upgrader'}},
      },
    },
  };
  context.global = context;
  vm.createContext(context);
  const driver = vm.runInContext('(function(code){return "" + eval(code);})', context);

  const memorySetCalls = [];
  const consoleCalls = [];

  const api = {
    async userMemorySet(path, value, shard) {
      memorySetCalls.push({path, value, shard});
      const parts = path.split('.');
      let cur = memory;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      return {ok: 1};
    },
  };

  const session = {
    api,
    shard: 'shard2',
    async run(code) {
      const id = createRequestId();
      const wrapped = wrapExpression(code, id);
      assert.ok(jsonExpressionLength(wrapped) <= 1024, `wrapped expression exceeded 1024: ${jsonExpressionLength(wrapped)}`);
      consoleCalls.push({code, id});
      context.Game.time += 1;
      const raw = driver(wrapped);
      const parsed = parseResponse(raw, id);
      if (parsed.kind === 'e') throw new Error(parsed.error);
      return {
        shard: 'shard2',
        id,
        tick: parsed.tick,
        attempts: 1,
        value: parsed.kind === 'j' ? unwrapValue(parsed.value) : parsed.value,
        valueKind: parsed.value === undefined ? 'undefined' : 'value',
      };
    },
  };

  return {session, api, context, memory, memorySetCalls, consoleCalls};
}

(async () => {
  // 1. 短表达式走 direct 快速路径，不写 Memory。
  {
    const {session, memorySetCalls} = createMockSession();
    const res = await runLargeConsole(session, '1 + 2');
    assert.equal(res.transport, 'direct');
    assert.equal(res.value, 3);
    assert.equal(memorySetCalls.length, 0);
  }

  // 2. 长表达式走 memory 中转（使用随机后缀键防并发覆盖），执行后自动删除。
  {
    const {session, memory, memorySetCalls, consoleCalls} = createMockSession();
    const longExpr = Array.from({length: 80}, (_, i) => `var n${i} = ${i};`).join('') + 'n79';
    const res = await runLargeConsole(session, longExpr, {transport: 'memory'});
    assert.equal(res.transport, 'memory');
    assert.equal(res.chunks, 1);
    assert.match(res.memoryKey, /^__sa_boot_[a-z0-9]{8}$/);
    assert.equal(res.value, 79);
    assert.equal(memorySetCalls.length, 1);
    assert.equal(consoleCalls.length, 1);
    assert.equal(memory[res.memoryKey], undefined);
  }

  // 2b. auto 模式下若 Bot 清理了未知 Memory 键，自动降级为 chunk 分片执行。
  {
    const {session, memory} = createMockSession();
    const origRun = session.run.bind(session);
    session.run = code => {
      for (const k of Object.keys(memory)) {
        if (k.startsWith('__sa_boot')) delete memory[k];
      }
      return origRun(code);
    };
    const longExpr = Array.from({length: 80}, (_, i) => `var a${i} = ${i};`).join('') + 'a79';
    const res = await runLargeConsole(session, longExpr);
    assert.equal(res.transport, 'chunk');
    assert.ok(res.chunks > 1);
    assert.equal(res.value, 79);
  }

  // 3. 长表达式走 chunk 分片，不触碰 Memory。
  {
    const {session, memorySetCalls, consoleCalls} = createMockSession();
    const longExpr = Array.from({length: 80}, (_, i) => `var x${i} = ${i};`).join('') + 'x79';
    const res = await runLargeConsole(session, longExpr, {transport: 'chunk'});
    assert.equal(res.transport, 'chunk');
    assert.ok(res.chunks > 1);
    assert.equal(consoleCalls.length, res.chunks);
    assert.equal(memorySetCalls.length, 0);
    assert.equal(res.value, 79);
  }

  // 4. 注入通用工具包并调用内置方法 + 状态检查 + 清理。
  {
    const {session, context} = createMockSession();
    const injected = await injectToolbox(session);
    assert.equal(injected.injected, true);
    assert.equal(injected.value.version, DEFAULT_TOOLKIT_VERSION);
    assert.ok(injected.value.tools.includes('cpu'));
    assert.ok(injected.value.tools.includes('room'));

    const cpuRes = await session.run('__sa.t.cpu()');
    assert.equal(cpuRes.value.limit, 20);
    assert.equal(cpuRes.value.bucket, 9500);

    const roomsRes = await session.run('__sa.t.rooms()');
    assert.equal(roomsRes.value.W1N1.rcl, 4);
    assert.equal(roomsRes.value.W1N1.storageEnergy, 12000);

    const roomRes = await session.run('__sa.t.room("W1N1")');
    assert.equal(roomRes.value.towers, 1);
    assert.equal(roomRes.value.creeps, 1);

    const creepsRes = await session.run('__sa.t.creeps("h")');
    assert.equal(creepsRes.value.length, 1);
    assert.equal(creepsRes.value[0].name, 'h1');

    const memRes = await session.run('__sa.t.memKeys()');
    assert.ok(memRes.value.rooms >= 2);

    await session.run('__sa.t.qPush({op:"ping"})');
    const st = await statusToolbox(session);
    assert.equal(st.value.hasTools, true);
    assert.equal(st.value.globalQueue, 1);

    const cleared = await clearToolbox(session);
    assert.equal(cleared.value.cleared, true);
    assert.equal(context.__sa.t, undefined);
  }

  // 5. 收件箱连续写入 + 一次 flush 消费并清空。
  {
    const {session, api, memory} = createMockSession();
    await pushInbox(api, 'shard2', {cmd: 'a'}, {id: 'm1', ts: 200});
    await pushInbox(api, 'shard2', {cmd: 'b'}, {id: 'm2', ts: 100});
    const st = await statusToolbox(session);
    assert.equal(st.value.memoryInbox, 2);

    const flushed = await flushInbox(session);
    assert.equal(flushed.value.count, 2);
    assert.deepEqual(flushed.value.items.map(i => i.id), ['m2', 'm1']);
    assert.equal(memory.__sa_inbox_m1, undefined);
    assert.equal(memory.__sa_inbox_m2, undefined);

    // 带自定义消费函数。
    await pushInbox(api, 'shard2', {v: 10}, {id: 'm3', ts: 300});
    await pushInbox(api, 'shard2', {v: 15}, {id: 'm4', ts: 400});
    const handled = await flushInbox(session, {
      handlerExpr: 'items => items.reduce((s, x) => s + x.payload.v, 0)',
    });
    assert.equal(handled.value.count, 2);
    assert.equal(handled.value.result, 25);
    assert.equal(memory.__sa_inbox_m3, undefined);
    assert.equal(memory.__sa_inbox_m4, undefined);
  }

  console.log('临时工具空间与收件箱测试通过');
})();
