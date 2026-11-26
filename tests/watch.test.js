'use strict';

const assert = require('node:assert/strict');
const {
  createMemoryWatcher,
  createRoomWatcher,
  matchesEvent,
  parseDurationSeconds,
  parseMatchSpec,
  parseRoomEvents,
  watchEvents,
} = require('../src/api/watch');

const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function createWatchHarness({shard = 'shardX', userId = 'u1'} = {}) {
  const clock = {now: 1_700_000_000_000};
  const timers = [];
  const subs = new Map();
  const calls = {connect: 0, disconnect: 0, subscribed: [], unsubscribed: []};

  const addSub = (key, cb) => {
    calls.subscribed.push(key);
    subs.set(key, cb);
  };
  const removeSub = key => {
    calls.unsubscribed.push(key);
    subs.delete(key);
  };

  const api = {
    socket: {
      on() {},
      off() {},
      async connect() { calls.connect += 1; },
      disconnect() { calls.disconnect += 1; },
      async subscribeRoom(room, s, cb) { addSub(`room:${s}/${room}`, cb); },
      async unsubscribeRoom(room, s) { removeSub(`room:${s}/${room}`); },
      async subscribeUserMemory(path, s, cb) { addSub(`memory:${s}/${path}`, cb); },
      async unsubscribeUserMemory(path, s) { removeSub(`memory:${s}/${path}`); },
      async subscribeUserCode(cb) { addSub('code', cb); },
      async unsubscribeUserCode() { removeSub('code'); },
      async subscribe(spec, cb) { addSub(spec, cb); },
      async unsubscribe(spec) { removeSub(spec); },
    },
  };

  const deps = {
    context: async () => ({api, account: {_id: userId, username: 'Me'}, target: 'main', shard}),
    now: () => clock.now,
    setTimeout: (fn, ms) => {
      const t = {fn, ms};
      timers.push(t);
      return t;
    },
    clearTimeout: t => {
      const idx = timers.indexOf(t);
      if (idx >= 0) timers.splice(idx, 1);
    },
    log: () => {},
  };

  return {
    clock,
    timers,
    calls,
    deps,
    emit: (key, data) => subs.get(key)?.({data}),
  };
}

(async () => {
  // 1. 时长解析（支持 s/m/h 后缀与范围校验）
  assert.equal(parseDurationSeconds('30'), 30);
  assert.equal(parseDurationSeconds('45s'), 45);
  assert.equal(parseDurationSeconds('15m'), 900);
  assert.equal(parseDurationSeconds('1h'), 3600);
  assert.throws(() => parseDurationSeconds('0'), /--timeout 必须是/);
  assert.throws(() => parseDurationSeconds('abc'), /--timeout 必须是/);

  // 2. --match 跨字段 OR 与 AND
  const groups = parseMatchSpec('name^=Assault_|type=spawn|type=tower');
  assert.equal(matchesEvent({name: 'Assault_60', type: 'creep'}, groups), true);
  assert.equal(matchesEvent({name: 'Other', type: 'spawn'}, groups), true);
  assert.equal(matchesEvent({name: 'Other', type: 'road'}, groups), false);
  const andGroup = parseMatchSpec('owner=hostile,hits<3000');
  assert.equal(matchesEvent({owner: 'hostile', hits: 2000}, andGroup), true);
  assert.equal(matchesEvent({owner: 'hostile', hits: 4000}, andGroup), false);
  assert.equal(matchesEvent({owner: 'own', hits: 2000}, andGroup), false);

  // 3. 房间事件类型校验
  assert.ok(parseRoomEvents(undefined).has('creep-enter'));
  assert.ok(parseRoomEvents('all').has('controller'));
  assert.throws(() => parseRoomEvents('bad-event'), /未知房间事件类型/);

  // 4. 房间实时差分引擎：首帧快照、creep 进房/阵亡/离开、拆毁建筑、敌方清零、掉血/低血量、核弹、控制器
  {
    const onRoom = createRoomWatcher({
      room: 'E49N36',
      shard: 'shardX',
      userId: 'me',
      events: 'all',
    });

    // 首帧建立基准快照，默认不触发存量事件
    assert.deepEqual(onRoom({
      objects: {
        sp1: {type: 'spawn', user: 'enemy', x: 20, y: 20, hits: 5000, hitsMax: 5000},
        ctrl: {type: 'controller', user: 'enemy', level: 5, x: 10, y: 10},
        c1: {type: 'creep', name: 'Assault_1', user: 'me', x: 5, y: 5, hits: 1000, hitsMax: 1000},
      },
    }), []);

    // 新 creep 进房 + 敌兵出现 + 己方掉血到 40%（触发 damage 和 low-hp）
    const tick1 = onRoom({
      gameTime: 1001,
      objects: {
        c2: {type: 'creep', name: 'Assault_60', user: 'me', x: 1, y: 16, hits: 5000, hitsMax: 5000},
        e1: {type: 'creep', name: 'Defender_1', user: 'enemy', x: 22, y: 22, hits: 500, hitsMax: 500},
        c1: {hits: 400},
      },
    });
    assert.ok(tick1.some(e => e.event === 'creep-enter' && e.name === 'Assault_60' && e.owner === 'own'));
    assert.ok(tick1.some(e => e.event === 'hostile-enter' && e.name === 'Defender_1' && e.owner === 'hostile'));
    assert.ok(tick1.some(e => e.event === 'damage' && e.name === 'Assault_1' && e.delta === -600));
    assert.ok(tick1.some(e => e.event === 'low-hp' && e.name === 'Assault_1'));

    // c1 继续掉血但仍在低血量：仍报 damage，不重复报 low-hp
    const tick2 = onRoom({gameTime: 1002, objects: {c1: {hits: 300}}});
    assert.equal(tick2.filter(e => e.event === 'damage').length, 1);
    assert.equal(tick2.filter(e => e.event === 'low-hp').length, 0);

    // c1 死亡（消失 + 墓碑出现）；c2 跨房离开（仅消失无墓碑）
    const tick3 = onRoom({
      gameTime: 1003,
      objects: {
        c1: null,
        t1: {type: 'tombstone', creepName: 'Assault_1', x: 5, y: 5, deathTime: 1003},
        c2: null,
      },
    });
    assert.ok(tick3.some(e => e.event === 'creep-die' && e.name === 'Assault_1'));
    assert.ok(tick3.some(e => e.event === 'creep-leave' && e.name === 'Assault_60'));

    // 敌方 spawn 与敌兵全部摧毁 → structure-destroyed + hostile-cleared；控制器开安全模式 + 核弹落地预警
    const tick4 = onRoom({
      gameTime: 1004,
      objects: {
        sp1: null,
        e1: null,
        nk1: {type: 'nuke', x: 25, y: 25, landTime: 51004, launchRoomName: 'E40N30'},
        ctrl: {safeMode: 21004},
      },
    });
    assert.ok(tick4.some(e => e.event === 'structure-destroyed' && e.type === 'spawn'));
    assert.ok(tick4.some(e => e.event === 'hostile-cleared'));
    assert.ok(tick4.some(e => e.event === 'nuke' && e.landTime === 51004));
    assert.ok(tick4.some(e => e.event === 'controller' && e.changes.safeMode.to === 21004));
  }

  // 5. --check-initial 首帧已满足条件时立刻返回
  {
    const onRoom = createRoomWatcher({
      room: 'E49N36',
      shard: 'shardX',
      userId: 'me',
      events: 'creep-enter',
      checkInitial: true,
    });
    const initEvs = onRoom({
      objects: {c1: {type: 'creep', name: 'Assault_60', user: 'me', x: 2, y: 16}},
    });
    assert.equal(initEvs.length, 1);
    assert.equal(initEvs[0].initial, true);
    assert.equal(initEvs[0].name, 'Assault_60');
  }

  // 6. Memory 路径监听（变化触发 & --until 精准条件 & 首帧检查）
  {
    const onMem = createMemoryWatcher({path: 'assault.plans.72', shard: 'shardX', until: 'phase=engage'});
    assert.deepEqual(onMem(JSON.stringify({phase: 'staging'})), []);
    assert.deepEqual(onMem(JSON.stringify({phase: 'staging'})), []);
    assert.deepEqual(onMem(JSON.stringify({phase: 'marching'})), []);
    const hit = onMem(JSON.stringify({phase: 'engage'}));
    assert.equal(hit.length, 1);
    assert.equal(hit[0].event, 'memory-match');
    assert.equal(hit[0].value.phase, 'engage');

    const onMemInit = createMemoryWatcher({path: 'missions.loot', shard: 'shardX', until: 'value!=undefined', checkInitial: true});
    assert.equal(onMemInit(JSON.stringify({active: true})).length, 1);
  }

  // 7. watchEvents 组合多路订阅（room + console + code + messages + cpu），命中即刻解订并唤醒
  {
    const h = createWatchHarness();
    const run = watchEvents({
      room: 'E49N36',
      on: 'creep-enter',
      match: 'name^=Assault_',
      console: true,
      errors: true,
      code: true,
      messages: true,
      cpuAbove: '50',
      timeout: '5m',
    }, h.deps);
    await settle();
    assert.equal(h.calls.connect, 1);
    assert.ok(h.calls.subscribed.includes('room:shardX/E49N36'));
    assert.ok(h.calls.subscribed.includes('console'));
    assert.ok(h.calls.subscribed.includes('code'));
    assert.ok(h.calls.subscribed.includes('newMessage'));
    assert.ok(h.calls.subscribed.includes('cpu'));

    // 首帧快照 + 路人 creep（不匹配 Assault_）不会触发
    h.emit('room:shardX/E49N36', {objects: {}});
    h.emit('room:shardX/E49N36', {gameTime: 100, objects: {c0: {type: 'creep', name: 'Mule_1', user: 'u1'}}});
    // 目标突击小队进入，瞬间唤醒
    h.clock.now += 2500;
    h.emit('room:shardX/E49N36', {gameTime: 101, objects: {c1: {type: 'creep', name: 'Assault_60', user: 'u1', x: 1, y: 16}}});

    const res = await run;
    assert.equal(res.triggered, true);
    assert.equal(res.reason, 'matched');
    assert.equal(res.count, 1);
    assert.equal(res.events[0].name, 'Assault_60');
    assert.equal(h.calls.disconnect, 1);
    assert.equal(h.calls.unsubscribed.length, h.calls.subscribed.length);
  }

  // 8. --stream + --cooldown 防抖去重与超时正常退出
  {
    const h = createWatchHarness();
    const streamed = [];
    const run = watchEvents({
      console: true,
      errors: true,
      stream: true,
      cooldown: '30s',
      timeout: '60s',
    }, {...h.deps, onEvent: ev => streamed.push(ev)});
    await settle();

    h.emit('console', {shard: 'shardX', error: 'TypeError: boom'});
    h.clock.now += 5000;
    h.emit('console', {shard: 'shardX', error: 'TypeError: boom'}); // 冷却期内去重
    h.clock.now += 31000;
    h.emit('console', {shard: 'shardX', error: 'TypeError: boom'}); // 冷却结束再次触发
    h.timers[0].fn(); // 触发超时退出

    const res = await run;
    assert.equal(res.triggered, true);
    assert.equal(res.reason, 'timeout');
    assert.equal(streamed.length, 2);
  }

  // 9. 代码部署上线触发 code-updated & 无订阅源报错
  {
    const h = createWatchHarness();
    const run = watchEvents({code: true, timeout: 60}, h.deps);
    await settle();
    h.emit('code', {branch: 'main', timestamp: 123456, hash: 99, modules: {main: 'code'}});
    const res = await run;
    assert.equal(res.triggered, true);
    assert.equal(res.events[0].event, 'code-updated');
    assert.deepEqual(res.events[0].modules, ['main']);

    await assert.rejects(() => watchEvents({}), /至少需要指定一种订阅源/);
  }

  console.log('实时事件订阅测试通过');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
