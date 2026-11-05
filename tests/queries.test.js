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
  // 当前 tick 与分片平均 tick 时长（毫秒）；另一个分片的时长不同，用来确认按当前分片取。
  const gameTime = 77_950_310;
  const tickMs = 4000;
  const shardsInfo = {shards: [{name: 'shardY', tick: tickMs * 10}, {name: 'shardX', tick: tickMs}]};
  const gameTimeShards = [];
  const responses = {}; // 按 interval 换掉 gameRoomOverview 的回包，没设的用 overview
  const originalContext = client.context;
  const originalResolveTarget = client.resolveTarget;
  try {
    const mockContext = (apiOverrides = {}) => async options => ({
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
        gameRoomOverview: async (room, interval) => {
          overviewCalls.push({room, interval});
          return responses[interval] ?? overview;
        },
        userMemoryGet: async () => ({data: '{"value":42}'}),
        userMemorySegmentGet: async id => ({[id]: 'segment'}),
        gameTime: async shard => {
          gameTimeShards.push(shard);
          return {ok: 1, time: gameTime};
        },
        gameShardsInfo: async () => shardsInfo,
        ...apiOverrides,
      },
    });
    client.context = mockContext();
    client.resolveTarget = options => ({target: options.target || 'main', shard: options.shard || 'shardX', config: {app: 'default', server: 'main'}});

    assert.deepEqual(await queries.listRooms({target: 'main', shard: 'shardX'}), {target: 'main', shard: 'shardX', rooms: ['E49N32']});
    assert.deepEqual((await queries.getRoom({target: 'main', shard: 'shardX', room: 'E49N32'})).summary.spawns, 1);
    assert.deepEqual(await queries.getMemory({target: 'main', shard: 'shardX', path: 'rooms.E49N32'}), {target: 'main', shard: 'shardX', path: 'rooms.E49N32', value: {value: 42}});
    assert.deepEqual(await queries.getSegment({target: 'main', shard: 'shardX', id: '0'}), {target: 'main', shard: 'shardX', segments: {'0': 'segment'}});
    assert.deepEqual(await queries.listShards({target: 'main', shard: 'shardX'}), shardsInfo);
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

    // tick 换算：时钟是输入，结果可以手算。
    const clock = {gameTime, tickMs, at: 1_700_000_000_000};
    assert.equal(queries.estimateTick(clock, clock.at), gameTime);
    assert.equal(queries.estimateTick(clock, clock.at - 10 * tickMs), gameTime - 10);
    assert.equal(queries.estimateTick(clock, clock.at + 3 * tickMs), gameTime + 3);

    const slotMs = interval * 60_000;
    const perCell = slotMs / tickMs; // 一格多少 tick
    const elapsed = 105; // 当前格已经走过多少 tick
    const pure = {gameTime, tickMs, at: slot * slotMs + elapsed * tickMs};
    const withTicks = queries.formatRoomStats(overview, {interval, clock: pure, now: pure.at});
    const harvested = withTicks.stats.energyHarvested.series;
    assert.deepEqual(harvested.map(cell => cell.ticks), [
      [gameTime - elapsed - 2 * perCell, gameTime - elapsed - perCell - 1],
      [gameTime - elapsed - perCell, gameTime - elapsed - 1],
      [gameTime - elapsed, gameTime], // 进行中的格子到当前 tick 为止
    ]);
    for (let index = 1; index < harvested.length; index += 1) assert.equal(harvested[index - 1].ticks[1] + 1, harvested[index].ticks[0]);
    assert.deepEqual(Object.keys(withTicks), ['owner', 'interval', 'gameTime', 'tickMs', 'stats']);
    assert.deepEqual(Object.keys(harvested[0]), ['ticks', 'end', 'value']);
    assert.deepEqual(Object.keys(harvested[2]), ['ticks', 'end', 'value', 'inProgress']);
    assert.equal(withTicks.gameTime, gameTime);
    assert.equal(withTicks.tickMs, tickMs);
    assert.equal(queries.formatRoomStats(overview, {interval, clock: {...pure, tickMs: tickMs + 0.4}, now: pure.at}).tickMs, tickMs);

    // 没有 clock：除了没有 ticks / gameTime / tickMs，输出和以前完全一样。
    const bare = queries.formatRoomStats(overview, {interval, now: pure.at});
    assert.deepEqual(Object.keys(bare), ['owner', 'interval', 'stats']);
    assert.deepEqual(Object.keys(bare.stats.energyHarvested.series[2]), ['end', 'value', 'inProgress']);
    const stripped = structuredClone(withTicks.stats);
    for (const item of Object.values(stripped)) {
      for (const cell of item.series) delete cell.ticks;
    }
    assert.deepEqual(stripped, bare.stats);

    // 给 tick：每个 tick 恰好落在一格里，边界 tick 归各自那一格；total 只算留下的格子。
    const atTick = tick => queries.formatRoomStats(overview, {interval, clock: pure, now: pure.at, tick});
    for (const [tick, value] of [
      [gameTime - elapsed - perCell - 1, 100],
      [gameTime - elapsed - perCell, 40],
      [gameTime - elapsed - 1, 40],
      [gameTime - elapsed, 5],
      [gameTime, 5],
    ]) {
      const hit = atTick(tick);
      assert.equal(hit.tick, tick);
      assert.equal(hit.stats.energyHarvested.series.length, 1);
      assert.equal(hit.stats.energyHarvested.total, value);
      assert.equal(hit.stats.creepsLost.series.length, 1);
    }
    assert.deepEqual(Object.keys(atTick(gameTime)), ['owner', 'interval', 'gameTime', 'tickMs', 'tick', 'stats']);
    assert.deepEqual(atTick(gameTime - elapsed - 2 * perCell - 1).stats.energyHarvested, {total: 0, series: []});
    assert.throws(() => queries.formatRoomStats(overview, {interval, tick: gameTime}), /读不到当前 tick 或分片平均 tick 时长，无法按 tick 查询/);

    // getRoomStats：冻结 Date.now，格子边界和读时钟的时刻都固定，各档的 tick 范围可以手算。
    const frozenNow = Date.UTC(2026, 10, 5, 6, 0, 0) + elapsed * tickMs;
    const ticksPer = minutes => minutes * 60_000 / tickMs;
    const elapsedIn = minutes => (frozenNow % (minutes * 60_000)) / tickMs;
    // minutes 档里从当前格往前数 back 格（0 是进行中的当前格）的 tick 范围
    const span = (minutes, back) => {
      const from = gameTime - elapsedIn(minutes) - back * ticksPer(minutes);
      return [from, back === 0 ? gameTime : from + ticksPer(minutes) - 1];
    };
    const valueAt = (minutes, back) => minutes * (3 - back);
    // 每档三格（旧到新），值 = 档位 × 序号，从值就能看出回包来自哪一档哪一格。
    const overviewOf = minutes => {
      const current = Math.floor(frozenNow / (minutes * 60_000)) + 1; // 进行中那一格的 endTime
      const ends = [current - 2, current - 1, current];
      return {
        owner: {username: 'tester'},
        stats: {
          energyHarvested: ends.map((endTime, index) => ({endTime, value: minutes * (index + 1)})),
          creepsLost: ends.map(endTime => ({endTime, value: 0})),
        },
      };
    };
    const query = options => queries.getRoomStats({target: 'main', shard: 'shardX', room: 'E49N32', ...options});
    const calledSince = start => overviewCalls.slice(start).map(call => call.interval);
    const realNow = Date.now;
    Date.now = () => frozenNow;
    try {
      for (const minutes of [8, 180, 1440]) responses[minutes] = overviewOf(minutes);
      let mark = overviewCalls.length;

      // 不给 tick：每格带估算的 tick 范围，顶层带换算依据；按当前分片取 tick 时长，并把分片名传给 gameTime。
      const plain = await query({});
      assert.deepEqual(Object.keys(plain), ['target', 'shard', 'room', 'owner', 'interval', 'gameTime', 'tickMs', 'stats']);
      assert.equal(plain.gameTime, gameTime);
      assert.equal(plain.tickMs, tickMs);
      assert.deepEqual(plain.stats.energyHarvested.series.map(cell => cell.ticks), [span(8, 2), span(8, 1), span(8, 0)]);
      const other = await query({shard: 'shardY'});
      assert.equal(gameTimeShards.at(-1), 'shardY');
      assert.equal(other.tickMs, shardsInfo.shards[0].tick);

      // 给 tick：只剩覆盖它的那一格，total 等于它的值；数字和字符串都行，输出里的 tick 是数字。
      mark = overviewCalls.length;
      const inside = span(8, 1)[0] + 10;
      for (const given of [inside, String(inside)]) {
        const hit = await query({tick: given});
        assert.deepEqual(Object.keys(hit), ['target', 'shard', 'room', 'owner', 'interval', 'gameTime', 'tickMs', 'tick', 'stats']);
        assert.equal(hit.interval, 8);
        assert.equal(hit.tick, inside);
        assert.deepEqual(hit.stats.energyHarvested.series.map(cell => cell.ticks), [span(8, 1)]);
        assert.equal(hit.stats.energyHarvested.total, valueAt(8, 1));
        assert.equal(hit.stats.creepsLost.series.length, 1);
      }
      assert.deepEqual(calledSince(mark), [8, 8]);

      // 没指定 interval：8 档盖不到就升到 180，再不行升到 1440。
      const in180 = gameTime - 1000;
      const in1440 = gameTime - 20_000;
      assert.ok(in180 < span(8, 2)[0] && in1440 < span(180, 2)[0]); // 场景前提：更细的几档确实盖不到
      mark = overviewCalls.length;
      const second = await query({tick: in180});
      assert.equal(second.interval, 180);
      assert.deepEqual(calledSince(mark), [8, 180]);
      assert.deepEqual(second.stats.energyHarvested.series.map(cell => cell.ticks), [span(180, 1)]);
      assert.equal(second.stats.energyHarvested.total, valueAt(180, 1));
      mark = overviewCalls.length;
      const third = await query({tick: in1440});
      assert.equal(third.interval, 1440);
      assert.deepEqual(calledSince(mark), [8, 180, 1440]);
      assert.deepEqual(third.stats.energyHarvested.series.map(cell => cell.ticks), [span(1440, 1)]);
      const onlyLost = await query({tick: in180, stat: 'creepsLost'});
      assert.deepEqual(Object.keys(onlyLost.stats), ['creepsLost']);
      assert.equal(onlyLost.interval, 180);
      assert.equal(onlyLost.stats.creepsLost.series.length, 1);

      // 指定了 interval 就只查那一档；覆盖不到时写出这一档的范围并提示换更大的，最大一档没有更大的可换。
      mark = overviewCalls.length;
      assert.equal((await query({interval: 180, tick: in180})).interval, 180);
      assert.deepEqual(calledSince(mark), [180]);
      mark = overviewCalls.length;
      await assert.rejects(() => query({interval: 8, tick: in180}), error => {
        assert.match(error.message, /不在 interval 8 覆盖的范围内/);
        assert.ok(error.message.includes(`${span(8, 2)[0]}～${span(8, 0)[1]}`), error.message);
        assert.match(error.message, /更大的 --interval/);
        return true;
      });
      assert.deepEqual(calledSince(mark), [8]);
      const tooOld = span(1440, 2)[0] - 1;
      await assert.rejects(() => query({interval: 1440, tick: tooOld}), error => {
        assert.match(error.message, /不在 interval 1440 覆盖的范围内/);
        assert.doesNotMatch(error.message, /更大的/);
        return true;
      });

      // 三档都盖不到：报早于范围，并带上最大一档最早覆盖到的 tick。0 也是合法的 tick。
      mark = overviewCalls.length;
      await assert.rejects(() => query({tick: tooOld}), error => {
        assert.match(error.message, /^tick \d+ 早于官方房间统计能覆盖的范围/);
        assert.ok(error.message.includes(String(span(1440, 2)[0])), error.message);
        return true;
      });
      assert.deepEqual(calledSince(mark), [8, 180, 1440]);
      await assert.rejects(() => query({tick: 0}), /早于官方房间统计能覆盖的范围/);

      // 还没到的 tick 在查统计之前就报错；当前 tick 本身可以查。
      mark = overviewCalls.length;
      await assert.rejects(() => query({tick: gameTime + 1000}), error => error.message === `tick ${gameTime + 1000} 还没到（当前 tick ${gameTime}）`);
      assert.equal(overviewCalls.length, mark);
      assert.deepEqual((await query({tick: gameTime})).stats.energyHarvested.series.map(cell => cell.ticks), [span(8, 0)]);

      // tick 不是非负整数：联网前就报错，统计和时钟都没请求。
      mark = overviewCalls.length;
      const clockReads = gameTimeShards.length;
      for (const bad of ['abc', '-1', '1.5', '1e3', '', -3, 2.5, NaN]) {
        await assert.rejects(() => query({tick: bad}), error => error.message === `tick 必须是非负整数，收到：${bad}`, String(bad));
      }
      assert.equal(overviewCalls.length, mark);
      assert.equal(gameTimeShards.length, clockReads);
      await assert.rejects(() => query({tick: in180, stat: 'energyFoo'}), /未知统计项：energyFoo/);

      // 服务器没给统计：细的一档空、更粗的有数据就用更粗的（带 stat 也一样）。
      responses[8] = {ok: 1};
      assert.equal((await query({tick: in180, stat: 'creepsLost'})).interval, 180);
      // 查过的档全都没数据：给 tick 报没有数据（不是不在范围内）；不给 tick 照常输出空 stats。
      for (const minutes of [8, 180, 1440]) responses[minutes] = {ok: 1};
      mark = overviewCalls.length;
      await assert.rejects(() => query({tick: in180}), error => error.message === '服务器没有返回该房间的统计数据');
      assert.deepEqual(calledSince(mark), [8, 180, 1440]);
      mark = overviewCalls.length;
      await assert.rejects(() => query({tick: in180, interval: 180}), error => error.message === '服务器没有返回该房间的统计数据');
      assert.deepEqual(calledSince(mark), [180]);
      await assert.rejects(() => query({tick: in180, stat: 'creepsLost'}), /服务器没有返回该房间的统计数据/);
      for (const minutes of [8, 180, 1440]) responses[minutes] = {stats: {energyHarvested: []}};
      await assert.rejects(() => query({tick: in180}), error => error.message === '服务器没有返回该房间的统计数据');
      const empty = await query({});
      assert.deepEqual(empty.stats, {energyHarvested: {total: 0, series: []}});
      responses[8] = {ok: 1};
      const noStats = await query({});
      assert.deepEqual(noStats.stats, {});
      assert.equal(noStats.gameTime, gameTime);
    } finally {
      Date.now = realNow;
      for (const key of Object.keys(responses)) delete responses[key];
    }

    // 读不到时钟：统计照常输出，只是没有 tick 相关字段；按 tick 查则直接报错，也不去查统计。
    const brokenClocks = {
      'gameTime 失败': {gameTime: async () => { throw new Error('boom'); }},
      'gameTime 同步抛错': {gameTime: () => { throw new Error('shard must be defined'); }},
      'gameShardsInfo 失败': {gameShardsInfo: async () => { throw new Error('boom'); }},
      '分片没有 tick': {gameShardsInfo: async () => ({shards: [{name: 'shardX'}]})},
      'tick 时长不是正数': {gameShardsInfo: async () => ({shards: [{name: 'shardX', tick: 0}]})},
      '当前 tick 不是数字': {gameTime: async () => ({ok: 1, time: 'x'})},
    };
    for (const [label, overrides] of Object.entries(brokenClocks)) {
      client.context = mockContext(overrides);
      const mark = overviewCalls.length;
      const result = await queries.getRoomStats({target: 'main', shard: 'shardX', room: 'E49N32', interval: String(interval)});
      assert.deepEqual(Object.keys(result), ['target', 'shard', 'room', 'owner', 'interval', 'stats'], label);
      assert.ok(Object.values(result.stats).every(item => item.series.every(cell => !('ticks' in cell))), label);
      assert.equal(result.stats.energyHarvested.total, 145, label);
      assert.equal(overviewCalls.length, mark + 1, label);
      await assert.rejects(() => queries.getRoomStats({target: 'main', shard: 'shardX', room: 'E49N32', tick: gameTime}), /读不到当前 tick 或分片平均 tick 时长，无法按 tick 查询/, label);
      assert.equal(overviewCalls.length, mark + 1, label);
    }
    client.context = mockContext();
  } finally {
    client.context = originalContext;
    client.resolveTarget = originalResolveTarget;
  }
  console.log('共享查询测试通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
