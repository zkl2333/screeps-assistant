'use strict';

const assert = require('node:assert/strict');
const {HISTORY_CHUNK, applyDiff, chunkBase, chunkRange, describeObject, diffStates, replayChanges, replayState} = require('../src/api/replay');

/** 造一块回放：ticks[base] 是完整快照，其余帧默认是空差异，edits 是 {tick: 差异}；length 不足一块时模拟中途断掉。 */
function makeChunk(base, full, edits = {}, length = HISTORY_CHUNK) {
  const ticks = {[base]: full};
  for (let tick = base + 1; tick < base + length; tick += 1) ticks[tick] = edits[tick] ?? {};
  return {timestamp: 1_700_000_000_000, room: 'E1N1', base, ticks};
}

// chunkBase：块边界
assert.equal(chunkBase(0), 0);
assert.equal(chunkBase(99), 0);
assert.equal(chunkBase(100), 100);
assert.equal(chunkBase(77_949_750), 77_949_700);

// applyDiff：null 删除对象，删不存在的 id 无事发生
{
  const state = {a: {type: 'creep', x: 1}, b: {type: 'source'}};
  applyDiff(state, {a: null, nope: null});
  assert.deepEqual(state, {b: {type: 'source'}});
}

// applyDiff：新对象整体加入，之后改 diff 不影响 state
{
  const state = {};
  const diff = {n: {type: 'tombstone', store: {energy: 5}}};
  applyDiff(state, diff);
  diff.n.store.energy = 99;
  diff.n.extra = true;
  assert.deepEqual(state, {n: {type: 'tombstone', store: {energy: 5}}});
}

// applyDiff：顶层键 null 置 null 不删键；标量变化；类型变化
{
  const state = {c: {hits: 10, level: 1, reservation: null, user: 'u1'}};
  applyDiff(state, {c: {hits: null}});
  assert.equal(state.c.hits, null);
  assert.ok('hits' in state.c);
  applyDiff(state, {c: {level: 2}});
  assert.equal(state.c.level, 2);
  applyDiff(state, {c: {reservation: {user: 'u2', endTime: 123}}});
  assert.deepEqual(state.c.reservation, {user: 'u2', endTime: 123});
  applyDiff(state, {c: {reservation: {endTime: 124}}});
  assert.deepEqual(state.c.reservation, {user: 'u2', endTime: 124});
  applyDiff(state, {c: {reservation: null}});
  assert.equal(state.c.reservation, null);
  assert.equal(state.c.user, 'u1');
  assert.equal(state.c.level, 2);
}

// applyDiff：子键合并，没提到的子键不动，子键 null 置 null
{
  const state = {t: {store: {energy: 100}}, u: {store: {energy: 7, O: 3}}};
  applyDiff(state, {t: {store: {energy: 50, H: 5}}, u: {store: {energy: 6}}});
  assert.deepEqual(state.t.store, {energy: 50, H: 5});
  assert.deepEqual(state.u.store, {energy: 6, O: 3});
  applyDiff(state, {t: {store: {H: null}}});
  assert.deepEqual(state.t.store, {energy: 50, H: null});
}

// applyDiff：数组的子差异以下标为键，只换对应元素；新值是数组时整体替换
{
  const state = {c: {body: [{type: 'move', hits: 100}, {type: 'carry', hits: 100}]}};
  applyDiff(state, {c: {body: {1: {type: 'work', hits: 0}}}});
  assert.ok(Array.isArray(state.c.body));
  assert.deepEqual(state.c.body, [{type: 'move', hits: 100}, {type: 'work', hits: 0}]);
  applyDiff(state, {c: {body: {2: {type: 'tough', hits: 100}}}});
  assert.equal(state.c.body.length, 3);
  applyDiff(state, {c: {path: [1, 2]}});
  applyDiff(state, {c: {path: [3]}});
  assert.deepEqual(state.c.path, [3]);
  applyDiff(state, {c: {store: {energy: 1}}});
  applyDiff(state, {c: {store: [1, 2]}});
  assert.deepEqual(state.c.store, [1, 2]);
}

// applyDiff：空子差异不改变任何东西
{
  const state = {t: {store: {energy: 5}, body: [1, 2]}};
  const before = structuredClone(state);
  applyDiff(state, {t: {store: {}, body: {}}});
  assert.deepEqual(state, before);
}

// applyDiff：diff 不被改动，也不和 state 共享引用
{
  const diff = {n: {type: 'creep', store: {energy: 1}}, t: {store: {H: 5}, reservation: {user: 'u'}, body: {1: {type: 'work'}}}};
  const copy = structuredClone(diff);
  const state = {t: {store: {energy: 2}, reservation: null, body: [{type: 'move'}, {type: 'carry'}]}};
  applyDiff(state, diff);
  assert.deepEqual(diff, copy);
  state.n.store.energy = 99;
  state.t.reservation.user = 'changed';
  state.t.body[1].type = 'changed';
  assert.deepEqual(diff, copy);
}

// diffStates：对象新增、消失，标量、store 子键、body 下标、新增键的变化；没变化的对象不出现
{
  const body = [{type: 'move', hits: 100}, {type: 'work', hits: 100}, {type: 'carry', hits: 100}];
  const a = {
    gone: {type: 'creep', name: 'gone', x: 1, y: 1},
    same: {type: 'source', energy: 3000, store: {energy: 1}},
    moved: {type: 'creep', name: 'm', x: 10, y: 10, hits: 100, store: {energy: 50, H: 5}, body},
  };
  const b = {
    born: {type: 'tombstone', creepName: 'x', x: 3, y: 4, store: {energy: 10}},
    same: structuredClone(a.same),
    moved: {...structuredClone(a.moved), x: 11, store: {energy: 40, H: 5}, body: [body[0], body[1], {type: 'carry', hits: 0}], fatigue: 2},
  };
  const aBefore = structuredClone(a);
  const bBefore = structuredClone(b);
  const diff = diffStates(a, b);
  assert.deepEqual(diff, {
    gone: null,
    born: b.born,
    moved: {x: 11, store: {energy: 40}, body: {2: {type: 'carry', hits: 0}}, fatigue: 2},
  });
  assert.ok(!('same' in diff));
  assert.deepEqual(a, aBefore);
  assert.deepEqual(b, bBefore);
  // 差异应用到 a 上就得到 b
  const rebuilt = structuredClone(a);
  applyDiff(rebuilt, diff);
  assert.deepEqual(rebuilt, b);
  // 相同的两个状态没有差异
  assert.deepEqual(diffStates(a, structuredClone(a)), {});
  assert.deepEqual(diffStates({}, {}), {});
}

// diffStates：键或子键被删给 null；null 和缺键视为相同（引擎把“键被删”也写成 null，回放里留着 null，官方快照里没有这个键）
{
  assert.deepEqual(diffStates({o: {a: 1, k: 2}}, {o: {a: 1}}), {o: {k: null}});
  assert.deepEqual(diffStates({o: {store: {energy: 5, H: 1}}}, {o: {store: {energy: 5}}}), {o: {store: {H: null}}});
  assert.deepEqual(diffStates({o: {k: null, v: 1, log: {a: null}}}, {o: {v: 1, log: {}}}), {});
  assert.deepEqual(diffStates({o: {v: 1, log: {}}}, {o: {v: 1, k: null, log: {a: null}}}), {});
  assert.deepEqual(diffStates({o: {reservation: null}}, {o: {reservation: {user: 'u'}}}), {o: {reservation: {user: 'u'}}});
  assert.deepEqual(diffStates({o: {reservation: {user: 'u'}}}, {o: {reservation: null}}), {o: {reservation: null}});
  assert.deepEqual(diffStates({o: {k: 0}}, {o: {}}), {o: {k: null}});
}

// describeObject：creep、墓碑（creepName）、工地（structureType）；undefined 的键不出现
{
  assert.deepEqual(
    describeObject({_id: '1', type: 'creep', name: 'worker', user: 'u1', x: 1, y: 2, hits: 5, store: {}}),
    {type: 'creep', name: 'worker', user: 'u1', x: 1, y: 2},
  );
  assert.deepEqual(
    describeObject({type: 'tombstone', creepName: 'dead', user: 'u1', x: 3, y: 4, deathTime: 9}),
    {type: 'tombstone', name: 'dead', user: 'u1', x: 3, y: 4},
  );
  assert.deepEqual(
    describeObject({type: 'constructionSite', structureType: 'road', user: 'u1', x: 5, y: 6}),
    {type: 'constructionSite', structureType: 'road', user: 'u1', x: 5, y: 6},
  );
  assert.deepEqual(Object.keys(describeObject({type: 'source', x: 7, y: 8})), ['type', 'x', 'y']);
  assert.equal(describeObject({type: 'creep', name: 'n', creepName: 'other'}).name, 'n');
  assert.deepEqual(describeObject(undefined), {});
}

// replayState / chunkRange
{
  const full = {
    a: {type: 'creep', name: 'a', x: 10, y: 10, store: {energy: 50}},
    s: {type: 'source', x: 5, y: 5, energy: 3000},
  };
  const chunk = makeChunk(100, full, {
    101: {a: {x: 11}},
    102: {a: {x: 12, store: {energy: 40}}, b: {type: 'creep', name: 'b', x: 1, y: 1}},
    199: {a: null},
  });
  const untouched = structuredClone(chunk);
  assert.deepEqual(chunkRange(chunk), {first: 100, last: 199});

  // 起始帧、中间帧、最后一帧
  assert.deepEqual(replayState(chunk, 100), full);
  assert.deepEqual(replayState(chunk, 101).a, {type: 'creep', name: 'a', x: 11, y: 10, store: {energy: 50}});
  assert.deepEqual(replayState(chunk, 150).a, {type: 'creep', name: 'a', x: 12, y: 10, store: {energy: 40}});
  assert.equal(replayState(chunk, 150).b.name, 'b');
  assert.deepEqual(Object.keys(replayState(chunk, 199)).sort(), ['b', 's']);
  assert.deepEqual(chunk, untouched);

  // 返回的 state 和 chunk 不共享引用
  for (const tick of [100, 150, 199]) {
    const state = replayState(chunk, tick);
    for (const object of Object.values(state)) {
      object.x = 999;
      if (object.store) object.store.energy = 0;
    }
    delete state.s;
    assert.deepEqual(chunk, untouched);
  }

  // 块里只记录到一部分：超出范围的 tick 报错，写明记录范围
  const short = makeChunk(100, full, {}, 40);
  assert.deepEqual(chunkRange(short), {first: 100, last: 139});
  assert.deepEqual(replayState(short, 139), full);
  assert.throws(() => replayState(short, 140), /回放块 100～139 里没有 tick 140/);
  assert.throws(() => replayState(short, 99), /回放块 100～139 里没有 tick 99/);

  // 缺起始帧
  assert.throws(() => replayState({base: 100, ticks: {101: {}}}, 101), /回放块缺少起始帧 100；这一块从 tick 101 才开始有记录/);
  assert.throws(() => replayState({base: 100, ticks: {}}, 100), error => error.message === '回放块缺少起始帧 100');
  assert.throws(() => replayState({base: 100}, 100), error => error.message === '回放块缺少起始帧 100');

  // 官方也会用 null 占位没记录的帧（实测见于块开头）：当作没记录，不能当成空差异
  const hollow = {base: 100, ticks: {100: null, 101: null, 102: full}};
  assert.deepEqual(chunkRange(hollow), {first: 102, last: 102});
  assert.throws(() => replayState(hollow, 102), error => error.message === '回放块缺少起始帧 100；这一块从 tick 102 才开始有记录（官方只记录活跃房间）');
  const gap = {base: 100, ticks: {100: full, 101: {}, 102: null, 103: {}}};
  assert.deepEqual(chunkRange(gap), {first: 100, last: 103});
  assert.deepEqual(replayState(gap, 101), full);
  assert.throws(() => replayState(gap, 103), /回放块 100～103 缺少 tick 102 的记录/);
}

// replayChanges：块内的移动、消失、新对象
{
  const user = 'u1';
  const full = {
    A: {type: 'creep', name: 'A', user, x: 10, y: 10},
    B: {type: 'creep', name: 'B', user, x: 20, y: 20, store: {energy: 30}},
    S: {type: 'source', x: 5, y: 5, energy: 3000},
  };
  const chunk = makeChunk(100, full, {
    101: {A: {x: 11}},
    102: {A: {x: 12, y: 11}, S: {energy: 2990}},
    103: {B: null},
    104: {T: {type: 'tombstone', creepName: 'B', user, x: 20, y: 20, deathTime: 103}},
    105: {T: {decayTime: 150}},
  });
  const untouched = structuredClone(chunk);
  const records = replayChanges([chunk], 100, 105);
  assert.deepEqual(records, [
    {tick: 101, op: 'changed', id: 'A', type: 'creep', name: 'A', user, x: 11, y: 10, changes: {x: 11}},
    {tick: 102, op: 'changed', id: 'A', type: 'creep', name: 'A', user, x: 12, y: 11, changes: {x: 12, y: 11}},
    {tick: 102, op: 'changed', id: 'S', type: 'source', x: 5, y: 5, changes: {energy: 2990}},
    // removed 的位置是消失前的位置，不带 changes
    {tick: 103, op: 'removed', id: 'B', type: 'creep', name: 'B', user, x: 20, y: 20},
    // 本 tick 新生成的对象晚一帧出现；added 不带 changes，之后的变化按它自己的位置描述
    {tick: 104, op: 'added', id: 'T', type: 'tombstone', name: 'B', user, x: 20, y: 20},
    {tick: 105, op: 'changed', id: 'T', type: 'tombstone', name: 'B', user, x: 20, y: 20, changes: {decayTime: 150}},
  ]);
  assert.deepEqual(chunk, untouched);

  // 只列 (from, to] 内的变化；from == to 没有记录
  assert.deepEqual(replayChanges([chunk], 102, 103).map(item => `${item.tick}:${item.op}:${item.id}`), ['103:removed:B']);
  assert.deepEqual(replayChanges([chunk], 103, 103), []);
  assert.deepEqual(replayChanges([chunk], 105, 110), []);

  // changes 是克隆：改记录不影响 chunk
  const again = replayChanges([chunk], 100, 105);
  again[0].changes.x = 999;
  assert.deepEqual(chunk, untouched);
}

// replayChanges：跨块那一格由块末状态和下一块的起始快照比出，只含真正的变化
{
  const user = 'u1';
  const full = {
    A: {type: 'creep', name: 'A', user, x: 10, y: 10, _oldFatigue: 0},
    B: {type: 'creep', name: 'B', user, x: 20, y: 20},
    S: {type: 'source', x: 5, y: 5, energy: 3000},
  };
  // 第一块里 _oldFatigue 被删（回放里是 null），第二块的官方快照直接没有这个键
  const first = makeChunk(100, full, {110: {A: {_oldFatigue: null}}, 150: {A: {x: 15}}});
  const endState = replayState(first, 199);
  assert.equal(endState.A._oldFatigue, null);
  const nextFull = structuredClone(endState);
  delete nextFull.A._oldFatigue;
  const second = makeChunk(200, nextFull, {201: {A: {x: 17}}});

  // 只有一个变化：from 是块内最后一帧，to 是下一块的第一帧，只有 1 条跨块记录，null 残影不算变化
  const one = makeChunk(200, {...nextFull, A: {...nextFull.A, x: 16}});
  assert.deepEqual(replayChanges([first, one], 199, 200), [
    {tick: 200, op: 'changed', id: 'A', type: 'creep', name: 'A', user, x: 16, y: 10, changes: {x: 16}},
  ]);
  assert.deepEqual(replayChanges([first, second], 199, 200), []);

  // 多个变化：消失、移动、新增，按 removed 在前、其余按快照里的顺序
  const snapshot = {
    A: {...nextFull.A, x: 16},
    S: {...nextFull.S, energy: 2800},
    N: {type: 'creep', name: 'N', user, x: 30, y: 30},
  };
  const crossing = makeChunk(200, snapshot, {201: {A: {x: 17}}});
  const untouched = structuredClone([first, crossing]);
  const records = replayChanges([first, crossing], 198, 201);
  assert.deepEqual(records, [
    {tick: 200, op: 'removed', id: 'B', type: 'creep', name: 'B', user, x: 20, y: 20},
    {tick: 200, op: 'changed', id: 'A', type: 'creep', name: 'A', user, x: 16, y: 10, changes: {x: 16}},
    {tick: 200, op: 'changed', id: 'S', type: 'source', x: 5, y: 5, changes: {energy: 2800}},
    {tick: 200, op: 'added', id: 'N', type: 'creep', name: 'N', user, x: 30, y: 30},
    // 跨块之后状态已换成官方快照，下一格的差异照常应用
    {tick: 201, op: 'changed', id: 'A', type: 'creep', name: 'A', user, x: 17, y: 10, changes: {x: 17}},
  ]);
  assert.deepEqual([first, crossing], untouched);

  // 记录里的 changes 不和块数据共享引用
  records[1].changes.x = 999;
  records[3].x = 999;
  assert.deepEqual([first, crossing], untouched);

  // 一次跨过两个块边界：每块内的差异和每个边界的比较都出现
  const third = makeChunk(300, {A: {...snapshot.A, x: 20}, S: snapshot.S, N: snapshot.N});
  const wide = replayChanges([first, crossing, third], 199, 300);
  assert.deepEqual(wide.map(item => [item.tick, item.op, item.id]), [
    [200, 'removed', 'B'], [200, 'changed', 'A'], [200, 'changed', 'S'], [200, 'added', 'N'],
    [201, 'changed', 'A'],
    [300, 'changed', 'A'],
  ]);
}

// replayChanges：块内中途断、缺块、起始帧缺失
{
  const full = {A: {type: 'creep', name: 'A', x: 1, y: 1}};
  const short = makeChunk(100, full, {}, 40);
  const next = makeChunk(200, full);
  assert.throws(() => replayChanges([short], 135, 142), /回放块 100～139 只记录到 tick 139，tick 140 之后没有记录/);
  // 前一块中途断了，后一块存在也不能跨过去
  assert.throws(() => replayChanges([short, next], 135, 205), /只记录到 tick 139，tick 140/);
  assert.deepEqual(replayChanges([short], 135, 139), []);

  // 缺块：覆盖范围里少了哪一块就报哪一块
  const whole = makeChunk(100, full);
  assert.throws(() => replayChanges([whole], 190, 205), error => error.message === '缺少回放块 200');
  assert.throws(() => replayChanges([next], 150, 250), error => error.message === '缺少回放块 100');
  assert.throws(() => replayChanges([whole, makeChunk(300, full)], 150, 350), error => error.message === '缺少回放块 200');

  // 下一块的起始帧缺失或是 null 占位：不能当成空快照把所有对象报成消失
  const hollow = {base: 200, ticks: {200: null, 201: {}}};
  assert.throws(() => replayChanges([whole, hollow], 198, 201), error => error.message === '回放块缺少起始帧 200；这一块从 tick 201 才开始有记录（官方只记录活跃房间）');
  assert.throws(() => replayChanges([whole, {base: 200, ticks: {}}], 198, 201), error => error.message === '回放块缺少起始帧 200');
}

// 回放往返：逐帧用 diffStates 生成差异，replayState 还原出的每一帧都等于原状态
{
  const states = [];
  let current = {
    c1: {type: 'creep', name: 'c1', user: 'u', x: 1, y: 1, hits: 100, store: {energy: 50}, body: [{type: 'move', hits: 100}, {type: 'work', hits: 100}]},
    c2: {type: 'creep', name: 'c2', user: 'u', x: 9, y: 9, hits: 100, store: {}},
    s: {type: 'source', x: 5, y: 5, energy: 3000},
  };
  for (let index = 0; index < 12; index += 1) {
    states.push(structuredClone(current));
    current = structuredClone(current);
    current.c1.x += 1;
    current.s.energy -= 10;
    if (index === 2) current.c1.store.energy = 30;
    if (index === 3) current.c1.body[1] = {type: 'work', hits: 0};
    if (index === 4) current.c1.reservation = {user: 'u', endTime: 99};
    if (index === 5) current.c2.store = {energy: 10, H: 5};
    if (index === 6) current.t = {type: 'tombstone', creepName: 'c2', x: 9, y: 9, store: {energy: 10}};
    if (index === 7) delete current.c2;
    if (index === 8) current.c1.body.push({type: 'carry', hits: 100});
    if (index === 9) current.t.store = {energy: 5};
  }
  const ticks = {100: states[0]};
  for (let index = 1; index < states.length; index += 1) ticks[100 + index] = diffStates(states[index - 1], states[index]);
  const chunk = {base: 100, ticks: structuredClone(ticks)};
  for (let index = 0; index < states.length; index += 1) assert.deepEqual(replayState(chunk, 100 + index), states[index], `tick ${100 + index}`);
  // 块内每一格的记录条数等于差异里的对象数
  const records = replayChanges([chunk], 100, 100 + states.length - 1);
  assert.equal(records.length, Object.values(ticks).slice(1).reduce((sum, diff) => sum + Object.keys(diff).length, 0));
}

console.log('房间回放纯函数测试通过');
