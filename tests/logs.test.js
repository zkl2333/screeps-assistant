'use strict';

const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {
  DEFAULT_DURATION,
  DEFAULT_LIMIT,
  MAX_DURATION,
  MAX_LIMIT,
  collectLogs,
  estimateTick,
  formatLogLine,
  isErrorEntry,
  parseDuration,
  parseLimit,
  stripHtml,
} = require('../src/api/logs');

// 下面的假对象全是立即完成的 promise，让出两次事件循环就能跑完所有挂起的微任务链。
const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

/** 盯一个 promise 有没有完成，用来断言“还没提前结束”。 */
function watch(promise) {
  const state = {settled: false};
  promise.then(() => { state.settled = true; }, () => { state.settled = true; });
  return state;
}

/** 假 context / socket / 时钟 / 定时器：时间手动推进，不真等；gameTime(第几次调用, 时钟) 可以返回值、返回 rejected promise 或同步抛错。 */
function createHarness({shard = 'shard2', gameTime = () => ({ok: 1, time: 100}), connectError, subscribeError, unsubscribeError} = {}) {
  const clock = {now: 1_000_000};
  const calls = {context: [], connect: 0, subscribe: 0, unsubscribe: 0, disconnect: 0, gameTime: []};
  const logs = [];
  const timers = [];
  let listener;
  const api = {
    socket: {
      async connect() {
        calls.connect += 1;
        if (connectError) throw connectError;
      },
      async subscribe(channel, fn) {
        calls.subscribe += 1;
        assert.equal(channel, 'console');
        if (subscribeError) throw subscribeError;
        listener = fn;
      },
      async unsubscribe(channel, fn) {
        calls.unsubscribe += 1;
        assert.equal(channel, 'console');
        assert.equal(fn, listener);
        if (unsubscribeError) throw unsubscribeError;
      },
      disconnect() { calls.disconnect += 1; },
    },
    gameTime(targetShard) {
      calls.gameTime.push(targetShard);
      return gameTime(calls.gameTime.length, clock);
    },
  };
  const deps = {
    context: async options => {
      calls.context.push(options);
      return {api, shard};
    },
    now: () => clock.now,
    setTimeout: (fn, ms) => {
      const timer = {fn, ms};
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => {
      const at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
    },
    log: message => logs.push(message),
  };
  return {
    api,
    calls,
    clock,
    deps,
    logs,
    timers,
    emit: data => listener({type: 'user', id: 'u1', path: 'console', data}),
    dispatch: event => listener(event),
  };
}

/** 一条 console 事件的 data：bot 这个 tick 打印的日志（带 HTML）。 */
const shardEvent = (lines, shard = 'shard2') => ({shard, messages: {log: lines, results: []}});

const START = 1000;
const END = 31000;
/** 标准时钟：t=1000 读到 tick 100，t=31000 读到 tick 108（30 秒走 8 个 tick）。 */
const ticked = call => ({ok: 1, time: call === 1 ? 100 : 108});

/** 标准场景：t=1000 开始听，脚本里推进时钟并发事件，t=31000 时间到。 */
async function listen(options, script, config) {
  const h = createHarness({gameTime: ticked, ...config});
  h.clock.now = START;
  const run = collectLogs({duration: 30, ...options}, h.deps);
  await settle();
  await script(h);
  h.clock.now = END;
  h.timers[0]?.fn();
  const entries = await run;
  return {...h, entries};
}

/** 可以观察 {once: true} 和移除的假 signal。 */
function createFakeSignal(aborted = false) {
  const listeners = [];
  return {
    aborted,
    listeners,
    addEventListener(type, fn, opts) { listeners.push({type, fn, opts}); },
    removeEventListener(type, fn) {
      const at = listeners.findIndex(item => item.type === type && item.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    abort() {
      this.aborted = true;
      for (const item of [...listeners]) {
        if (item.opts?.once) this.removeEventListener(item.type, item.fn);
        item.fn();
      }
    },
  };
}

let finished = false;
process.on('exit', () => {
  // 某个 promise 一直不完成时事件循环会静默退出（退出码 0），这里把它变成失败。
  if (!finished) {
    console.error('日志监听测试没有跑完：有 promise 一直没有完成');
    process.exitCode = 1;
  }
});

(async () => {
  // stripHtml：去标签、解码实体、保留内部空格
  assert.equal(stripHtml('[<font color="#ffffff">    主循环</font>]         Bucket： 9791'), '[    主循环]         Bucket： 9791');
  assert.equal(stripHtml('<font color="#80ff80">[<a href="#!/room/shard2/E44N28">E44N28</a>]</font> TRR_7m 本 Tick 消耗了 6.33 CP'), '[E44N28] TRR_7m 本 Tick 消耗了 6.33 CP');
  assert.equal(stripHtml('a &lt; b &amp;&amp; c &gt; d'), 'a < b && c > d');
  assert.equal(
    stripHtml('<font color="#ff8080">[<font color="#80ff80">      单位</font>]<font color="#80ff80">[<a href="#!/room/shard2/E44N28">E44N28</a>]</font> TRR_7m 本 Tick 消耗了 6.33 CP</font>'),
    '[      单位][E44N28] TRR_7m 本 Tick 消耗了 6.33 CP',
  );
  assert.equal(stripHtml('  a   b  \t'), '  a   b', '前导和内部空格保留，只去尾部空白');
  assert.equal(stripHtml('<font color="#fff">x</font>   '), 'x');
  // 先去标签再解码：实体解出来的 < > 不会再被当成标签
  assert.equal(stripHtml('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
  assert.equal(stripHtml('<b>&lt;i&gt;</b>'), '<i>');
  assert.equal(stripHtml('&amp;lt;'), '&lt;', '只解码一层');
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml('<font color="#fff"></font>'), '');

  // isErrorEntry
  assert.equal(isErrorEntry({shard: 'shard2', text: '随便什么', error: true}), true);
  for (const text of ['TypeError: x is not a function', 'Error: boom', 'Uncaught ReferenceError', '这里报错了', '错误：找不到路径', '发生异常']) {
    assert.equal(isErrorEntry({shard: 'shard2', text}), true, text);
  }
  for (const text of ['Bucket： 9791', 'TRR_7m 本 Tick 消耗了 6.33 CP']) {
    assert.equal(isErrorEntry({shard: 'shard2', text}), false, text);
  }

  // parseDuration / parseLimit
  assert.equal(parseDuration(undefined), DEFAULT_DURATION);
  assert.equal(parseLimit(undefined), DEFAULT_LIMIT);
  assert.equal(parseDuration('30'), 30);
  assert.equal(parseDuration(30), 30);
  assert.equal(parseDuration('1'), 1);
  assert.equal(parseDuration(String(MAX_DURATION)), MAX_DURATION);
  assert.equal(parseLimit('50'), 50);
  assert.equal(parseLimit(50), 50);
  assert.equal(parseLimit('1'), 1);
  assert.equal(parseLimit(String(MAX_LIMIT)), MAX_LIMIT);
  for (const bad of [0, '0', MAX_DURATION + 1, String(MAX_DURATION + 1), 1.5, '1.5', 'abc', '', -1, '-1']) {
    assert.throws(() => parseDuration(bad), {message: `--duration 必须是 1～${MAX_DURATION} 的整数（秒），收到：${bad}`}, `duration ${JSON.stringify(bad)}`);
  }
  for (const bad of [0, '0', MAX_LIMIT + 1, String(MAX_LIMIT + 1), 1.5, '1.5', 'abc', '', -1, '-1']) {
    assert.throws(() => parseLimit(bad), {message: `--limit 必须是 1～${MAX_LIMIT} 的整数，收到：${bad}`}, `limit ${JSON.stringify(bad)}`);
  }

  // estimateTick：两端点线性插值，端点外线性外推，锚点缺失或不一致时不估算
  {
    const start = {at: 1000, tick: 100};
    const end = {at: 31000, tick: 108};
    assert.equal(estimateTick(16000, start, end), 104);
    assert.equal(estimateTick(1000, start, end), 100);
    assert.equal(estimateTick(31000, start, end), 108);
    assert.equal(estimateTick(9000, start, end), 102, '102.13 取整');
    assert.equal(estimateTick(14500, start, end), 104, '103.6 四舍五入');
    assert.equal(estimateTick(46000, start, end), 112);
    assert.equal(estimateTick(-14000, start, end), 96);
    assert.equal(estimateTick(16000, undefined, end), undefined);
    assert.equal(estimateTick(16000, start, undefined), undefined);
    assert.equal(estimateTick(16000, start, {at: 1000, tick: 108}), undefined, 'end.at 等于 start.at');
    assert.equal(estimateTick(16000, start, {at: 500, tick: 108}), undefined, 'end.at 早于 start.at');
    assert.equal(estimateTick(16000, start, {at: 31000, tick: 99}), undefined, 'end.tick 小于 start.tick');
    assert.equal(estimateTick(16000, start, {at: 31000, tick: 100}), 100, 'tick 没走时斜率为 0');
    assert.equal(estimateTick(NaN, start, end), undefined);
  }

  // formatLogLine
  assert.equal(formatLogLine({tick: 77950310, shard: 'shard2', text: 'hello'}), '~77950310 shard2 hello');
  assert.equal(formatLogLine({shard: 'shard3', text: 'hello'}), 'shard3 hello');
  assert.equal(formatLogLine({tick: 5, shard: 'shard2', text: 'TypeError: x', error: true}), '~5 shard2 [错误] TypeError: x');
  assert.equal(formatLogLine({shard: 'shard2', text: 'boom', error: true}), 'shard2 [错误] boom');

  // collectLogs 1：默认只留目标分片，allShards 才有其它分片；其它分片的条目没有 tick；缺 shard（私服）视为目标分片
  {
    const script = h => {
      h.clock.now = 1000;
      h.emit(shardEvent(['t0 line']));
      h.clock.now = 9000;
      h.emit(shardEvent(['other shard line'], 'shard3'));
      h.clock.now = 16000;
      h.emit(shardEvent(['t2 line', 't2 second']));
      h.clock.now = 20000;
      h.emit({messages: {log: ['no shard line']}});
      h.clock.now = 24000;
      h.emit(shardEvent(['x line'], 'shardX'));
    };
    const target = await listen({}, script);
    assert.deepEqual(target.entries, [
      {tick: 100, shard: 'shard2', text: 't0 line'},
      {tick: 104, shard: 'shard2', text: 't2 line'},
      {tick: 104, shard: 'shard2', text: 't2 second'},
      {tick: 105, shard: 'shard2', text: 'no shard line'},
    ]);
    assert.deepEqual(target.logs, ['听了 30 秒：收到 6 行（目标分片 4 行），输出 4 行']);

    const all = await listen({allShards: true}, script);
    assert.deepEqual(all.entries, [
      {tick: 100, shard: 'shard2', text: 't0 line'},
      {shard: 'shard3', text: 'other shard line'},
      {tick: 104, shard: 'shard2', text: 't2 line'},
      {tick: 104, shard: 'shard2', text: 't2 second'},
      {tick: 105, shard: 'shard2', text: 'no shard line'},
      {shard: 'shardX', text: 'x line'},
    ]);
    assert.deepEqual(all.logs, ['听了 30 秒：收到 6 行（目标分片 4 行），输出 6 行']);
    assert.deepEqual(Object.keys(all.entries[0]), ['tick', 'shard', 'text'], '字段顺序固定');
    assert.deepEqual(Object.keys(all.entries[1]), ['shard', 'text']);
  }

  // collectLogs 2：grep 不区分大小写、是子串；errors 同时命中 data.error 事件和文本像报错的行；两者同用是“且”
  {
    const script = h => {
      h.emit(shardEvent([
        '[<font color="#ffffff">    主循环</font>]         Bucket： 9791',
        '<font color="#80ff80">单位</font> TRR_7m 本 Tick 消耗了 6.33 CP',
        'TypeError: x is not a function',
        '单位 报错：找不到路径',
        'bucket 偏低',
        'a.c',
        'abc',
      ]));
      h.emit({shard: 'shard2', error: 'Error: boom\n    at main:1:1'});
    };
    const texts = async options => (await listen(options, script)).entries.map(entry => entry.text);
    assert.deepEqual(await texts({grep: '单位'}), ['单位 TRR_7m 本 Tick 消耗了 6.33 CP', '单位 报错：找不到路径']);
    assert.deepEqual(await texts({grep: 'BUCKET'}), ['[    主循环]         Bucket： 9791', 'bucket 偏低']);
    assert.deepEqual(await texts({grep: 'font'}), [], '标签已经去掉，不会被 grep 命中');
    assert.deepEqual(await texts({grep: 'a.c'}), ['a.c'], 'grep 是纯子串，不是正则');
    assert.deepEqual(await texts({errors: true}), ['TypeError: x is not a function', '单位 报错：找不到路径', 'Error: boom\n    at main:1:1']);
    assert.deepEqual(await texts({errors: true, grep: '单位'}), ['单位 报错：找不到路径']);
    assert.deepEqual(await texts({errors: true, grep: 'BOOM'}), ['Error: boom\n    at main:1:1']);
    const errors = (await listen({errors: true}, script)).entries;
    assert.deepEqual(errors[2], {tick: 100, shard: 'shard2', text: 'Error: boom\n    at main:1:1', error: true});
    assert.equal('error' in errors[0], false, '文本像报错的行不带 error 字段，只有 data.error 事件才带');
  }

  // collectLogs 3：limit 超出被丢弃、汇总提示；达到 limit 提前结束（不用等满 duration），且计数口径是过滤之后
  {
    // 一条事件就超出 limit：保留前 3 条，不用触发定时器
    const h = createHarness();
    h.clock.now = START;
    const run = collectLogs({duration: 30, limit: 3}, h.deps);
    await settle();
    h.clock.now = START + 4000;
    h.emit(shardEvent(['l1', 'l2', 'l3', 'l4', 'l5']));
    h.emit(shardEvent(['收满之后同一时刻到达的行']));
    assert.deepEqual((await run).map(entry => entry.text), ['l1', 'l2', 'l3']);
    assert.equal(h.timers.length, 0, '提前结束后定时器已清掉');
    assert.deepEqual(h.logs, ['听了 4 秒：收到 5 行（目标分片 5 行），输出 3 行；已达 --limit，提前结束'], '结束之后到达的行不再统计');
    h.emit(shardEvent(['迟到的行']));
    assert.equal(h.logs.length, 1);
  }
  {
    // 逐条到达：收满那一条才结束
    const h = createHarness();
    const run = collectLogs({duration: '30', limit: '3'}, h.deps);
    const state = watch(run);
    await settle();
    h.emit(shardEvent(['l1']));
    h.emit(shardEvent(['l2']));
    await settle();
    assert.equal(state.settled, false);
    h.emit(shardEvent(['l3']));
    assert.deepEqual((await run).map(entry => entry.text), ['l1', 'l2', 'l3']);
    assert.match(h.logs[0], /已达 --limit，提前结束/);
  }
  {
    // 计数口径是过滤之后：被 grep 滤掉的行不会让它提前结束
    const h = createHarness();
    const run = collectLogs({duration: 30, limit: 2, grep: 'hit'}, h.deps);
    const state = watch(run);
    await settle();
    for (const line of ['noise 1', 'noise 2', 'noise 3', 'noise 4', 'hit 1']) h.emit(shardEvent([line]));
    await settle();
    assert.equal(state.settled, false);
    h.emit(shardEvent(['hit 2']));
    assert.deepEqual((await run).map(entry => entry.text), ['hit 1', 'hit 2']);
    assert.match(h.logs[0], /收到 6 行（目标分片 6 行），输出 2 行；已达 --limit，提前结束/);
  }
  {
    // 其它分片的行默认不输出，也就不占 limit；allShards 时才占
    const h = createHarness();
    const run = collectLogs({duration: 30, limit: 2}, h.deps);
    const state = watch(run);
    await settle();
    h.emit(shardEvent(['x1', 'x2', 'x3'], 'shard3'));
    await settle();
    assert.equal(state.settled, false);
    h.timers[0].fn();
    assert.deepEqual(await run, []);
    assert.match(h.logs[0], /收到 3 行（目标分片 0 行），输出 0 行$/, '没收满就没有“已达 --limit”');

    const all = createHarness();
    const allRun = collectLogs({duration: 30, limit: 2, allShards: true}, all.deps);
    await settle();
    all.emit(shardEvent(['x1', 'x2', 'x3'], 'shard3'));
    assert.deepEqual(await allRun, [{shard: 'shard3', text: 'x1'}, {shard: 'shard3', text: 'x2'}]);
    assert.match(all.logs[0], /已达 --limit，提前结束/);
  }
  {
    // 定时器按 duration 秒设置；duration 先到时没有“已达 --limit”
    const h = createHarness();
    const run = collectLogs({duration: '20', limit: 5}, h.deps);
    await settle();
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 20_000);
    h.emit(shardEvent(['only one']));
    h.timers[0].fn();
    h.emit(shardEvent(['时间到之后同一时刻到达的行']));
    assert.deepEqual((await run).map(entry => entry.text), ['only one']);
    assert.match(h.logs[0], /收到 1 行（目标分片 1 行），输出 1 行$/);
    assert.doesNotMatch(h.logs[0], /已达 --limit/);
    assert.equal(h.timers.length, 0);
  }
  {
    // 定时器句柄不一定是对象（假实现可能什么都不返回）：照样要 clearTimeout
    const h = createHarness();
    const cleared = [];
    const run = collectLogs({duration: 30}, {
      ...h.deps,
      setTimeout: fn => { h.timers.push({fn}); },
      clearTimeout: handle => cleared.push(handle),
    });
    await settle();
    h.timers[0].fn();
    await run;
    assert.equal(cleared.length, 1);
  }

  // collectLogs 4：tick 估算
  {
    const {entries, logs} = await listen({}, h => {
      for (const [at, text] of [[1000, 't100'], [9000, 't102'], [16000, 't104'], [24000, 't106'], [31000, 't108']]) {
        h.clock.now = at;
        h.emit(shardEvent([text]));
      }
    });
    assert.deepEqual(entries.map(entry => [entry.tick, entry.text]), [[100, 't100'], [102, 't102'], [104, 't104'], [106, 't106'], [108, 't108']]);
    assert.doesNotMatch(logs[0], /读不到当前 tick/);
  }
  {
    // 锚点时刻取请求往返的中点：起点往返 8000ms（1000→9000，at=5000，tick 100），终点往返 4000ms（31000→35000，at=33000，tick 108）
    const latency = (call, clock) => {
      clock.now += call === 1 ? 8000 : 4000;
      return {ok: 1, time: call === 1 ? 100 : 108};
    };
    const {entries} = await listen({}, h => {
      h.clock.now = 5000;
      h.emit(shardEvent(['start']));
      h.clock.now = 19000;
      h.emit(shardEvent(['middle']));
      h.clock.now = 33000;
      h.emit(shardEvent(['end']));
    }, {gameTime: latency});
    assert.deepEqual(entries.map(entry => entry.tick), [100, 104, 108]);
  }
  {
    // gameTime 读不到：条目没有 tick 字段、汇总有提示、监听结果不受影响，清理照常
    const failures = {
      异步抛错: () => Promise.reject(new Error('gameTime failed')),
      同步抛错: () => { throw new Error('shard must be defined'); },
      time不是数字: () => ({ok: 1, time: 'abc'}),
      没有time: () => ({ok: 1}),
      返回undefined: () => undefined,
    };
    for (const [name, gameTime] of Object.entries(failures)) {
      const {entries, logs, calls, timers} = await listen({}, h => {
        h.clock.now = 16000;
        h.emit(shardEvent(['line']));
      }, {gameTime});
      assert.deepEqual(entries, [{shard: 'shard2', text: 'line'}], name);
      assert.deepEqual(logs, ['听了 30 秒：收到 1 行（目标分片 1 行），输出 1 行；读不到当前 tick，条目没有估算 tick'], name);
      assert.deepEqual(calls.gameTime, ['shard2', 'shard2'], `${name}：起点和终点各读一次目标分片`);
      assert.equal(calls.unsubscribe, 1, name);
      assert.equal(calls.disconnect, 1, name);
      assert.equal(timers.length, 0, name);
    }
    // 只有一端读不到也不估算
    for (const failing of [1, 2]) {
      const gameTime = call => (call === failing ? Promise.reject(new Error('gameTime failed')) : ticked(call));
      const {entries, logs} = await listen({}, h => h.emit(shardEvent(['line'])), {gameTime});
      assert.deepEqual(entries, [{shard: 'shard2', text: 'line'}], `第 ${failing} 次读不到`);
      assert.match(logs[0], /；读不到当前 tick，条目没有估算 tick$/);
    }
  }

  // collectLogs 5：清理（正常结束、gameTime 抛错、abort 三种情况都要 unsubscribe 和 disconnect）
  {
    const expectCleaned = (h, name) => {
      assert.deepEqual([h.calls.connect, h.calls.subscribe, h.calls.unsubscribe, h.calls.disconnect], [1, 1, 1, 1], name);
      assert.equal(h.timers.length, 0, name);
    };
    expectCleaned(await listen({}, h => h.emit(shardEvent(['line']))), '正常结束');
    expectCleaned(await listen({}, h => h.emit(shardEvent(['line'])), {gameTime: () => { throw new Error('boom'); }}), 'gameTime 抛错');

    const aborted = createHarness({gameTime: ticked});
    const controller = new AbortController();
    const abortedRun = collectLogs({duration: 30}, {...aborted.deps, signal: controller.signal});
    await settle();
    controller.abort();
    await abortedRun;
    expectCleaned(aborted, 'abort');

    // subscribe 失败：disconnect 后抛出原错误；订阅都没成功就没有 unsubscribe 可做
    const boom = new Error('subscribe failed');
    const failed = createHarness({subscribeError: boom});
    await assert.rejects(() => collectLogs({duration: 30}, failed.deps), error => error === boom);
    assert.deepEqual([failed.calls.connect, failed.calls.subscribe, failed.calls.unsubscribe, failed.calls.disconnect], [1, 1, 0, 1]);
    assert.equal(failed.logs.length, 0);
    assert.equal(failed.timers.length, 0);

    // unsubscribe 失败不覆盖主结果，disconnect 照常
    const stubborn = await listen({}, h => h.emit(shardEvent(['line'])), {unsubscribeError: new Error('unsubscribe failed')});
    assert.deepEqual(stubborn.entries.map(entry => entry.text), ['line']);
    assert.deepEqual([stubborn.calls.unsubscribe, stubborn.calls.disconnect], [1, 1]);

    // connect 失败：原错误抛出，不会去订阅
    const refused = new Error('connect failed');
    const offline = createHarness({connectError: refused});
    await assert.rejects(() => collectLogs({duration: 30}, offline.deps), error => error === refused);
    assert.equal(offline.calls.subscribe, 0);
  }

  // collectLogs 6：signal abort 提前结束，正常返回已收集的条目
  {
    const h = createHarness({gameTime: call => ({ok: 1, time: call === 1 ? 100 : 104})});
    const controller = new AbortController();
    h.clock.now = START;
    const run = collectLogs({duration: 30}, {...h.deps, signal: controller.signal});
    await settle();
    h.clock.now = 9000;
    h.emit(shardEvent(['abort 之前']));
    h.clock.now = 17000;
    controller.abort();
    assert.deepEqual(await run, [{tick: 102, shard: 'shard2', text: 'abort 之前'}]);
    assert.deepEqual(h.logs, ['听了 16 秒：收到 1 行（目标分片 1 行），输出 1 行；被中断']);
    assert.equal(h.timers.length, 0, 'abort 之后定时器已清掉');
    h.emit(shardEvent(['迟到的行']));
    assert.equal(h.logs.length, 1);
  }
  {
    // signal 的监听用 {once: true}，等待结束时（不管怎么结束）都已移除
    const waiting = createHarness();
    const signal = createFakeSignal();
    const run = collectLogs({duration: 30}, {...waiting.deps, signal});
    await settle();
    assert.equal(signal.listeners.length, 1);
    assert.equal(signal.listeners[0].type, 'abort');
    assert.deepEqual(signal.listeners[0].opts, {once: true});
    waiting.timers[0].fn();
    await run;
    assert.equal(signal.listeners.length, 0, 'duration 到时移除监听');

    const aborting = createHarness();
    const abortSignal = createFakeSignal();
    const abortRun = collectLogs({duration: 30}, {...aborting.deps, signal: abortSignal});
    await settle();
    abortSignal.abort();
    await abortRun;
    assert.equal(abortSignal.listeners.length, 0);
    assert.match(aborting.logs[0], /；被中断$/);

    // 开始监听前就已经 abort：不留监听，立刻结束，返回空数组
    const early = createHarness();
    const earlySignal = createFakeSignal(true);
    assert.deepEqual(await collectLogs({duration: 30}, {...early.deps, signal: earlySignal}), []);
    assert.equal(earlySignal.listeners.length, 0);
    assert.match(early.logs[0], /；被中断$/);
    assert.deepEqual([early.calls.unsubscribe, early.calls.disconnect], [1, 1]);
    assert.equal(early.timers.length, 0);
  }

  // collectLogs 7：messages.results 被忽略；清理后为空的行被跳过
  {
    const h = createHarness();
    const run = collectLogs({duration: 30}, h.deps);
    await settle();
    h.emit({shard: 'shard2', messages: {log: ['<font color="#ffffff"></font>', '   ', '', 'real line'], results: ['@@sa:abcd1234:123:j:1', 'plain result']}});
    h.emit({shard: 'shard2', messages: {results: ['@@sa:abcd1234:124:j:2']}});
    h.emit({shard: 'shard2', messages: {log: [], results: ['只有回包']}});
    h.emit({shard: 'shard2', error: '<font color="#ff0000"></font>'});
    h.timers[0].fn();
    assert.deepEqual(await run, [{shard: 'shard2', text: 'real line'}]);
    assert.match(h.logs[0], /收到 1 行（目标分片 1 行），输出 1 行/);
  }

  // collectLogs 8：联网前校验，非法参数时 context 一次都不能被调用
  {
    const h = createHarness();
    const cases = [
      [{duration: '0'}, /^--duration 必须是 1～/],
      [{duration: 0}, /^--duration 必须是 1～/],
      [{duration: String(MAX_DURATION + 1)}, /^--duration 必须是 1～/],
      [{duration: '1.5'}, /^--duration 必须是 1～/],
      [{duration: 'abc'}, /^--duration 必须是 1～/],
      [{duration: ''}, /^--duration 必须是 1～/],
      [{limit: 'abc'}, /^--limit 必须是 1～/],
      [{limit: '0'}, /^--limit 必须是 1～/],
      [{limit: String(MAX_LIMIT + 1)}, /^--limit 必须是 1～/],
      [{grep: ''}, /^--grep 不能为空$/],
    ];
    for (const [options, pattern] of cases) {
      await assert.rejects(() => collectLogs(options, h.deps), error => pattern.test(error.message), JSON.stringify(options));
    }
    assert.equal(h.calls.context.length, 0);
    assert.equal(h.calls.connect, 0);
    assert.equal(h.logs.length, 0);
  }

  // collectLogs 9：汇总行只通过注入的 log 输出一次；options 原样交给 context
  {
    const h = createHarness();
    const run = collectLogs({target: 'main', shard: 'shard2', account: 'alice', duration: 5}, h.deps);
    await settle();
    h.emit(shardEvent(['a', 'b'], 'shard2'));
    h.emit(shardEvent(['c'], 'shard3'));
    h.timers[0].fn();
    await run;
    assert.equal(h.logs.length, 1);
    assert.match(h.logs[0], /^听了 \d+(\.\d)? 秒：收到 3 行（目标分片 2 行），输出 2 行/);
    assert.equal(h.calls.context.length, 1);
    assert.deepEqual([h.calls.context[0].target, h.calls.context[0].shard, h.calls.context[0].account], ['main', 'shard2', 'alice']);
  }

  // collectLogs 10：格式异常的事件不会让监听崩掉，也不产生条目
  {
    const h = createHarness();
    const run = collectLogs({duration: 30}, h.deps);
    await settle();
    for (const event of [undefined, {}, {data: null}, {data: {}}, {data: {messages: {log: 'not an array'}}}, {data: {messages: {log: [1, null, {}, undefined]}}}, {data: {error: ''}}]) {
      assert.doesNotThrow(() => h.dispatch(event));
    }
    h.dispatch({data: {messages: {log: [1, 'ok']}}});
    h.timers[0].fn();
    assert.deepEqual(await run, [{shard: 'shard2', text: 'ok'}]);
  }

  // collectLogs 11：screeps-api 自带的 console.error 监听要换成静默监听，socket 出错不再整段打印，也不会因无人监听而抛出
  {
    const socket = Object.assign(new EventEmitter(), {
      async connect() {},
      async subscribe() {},
      async unsubscribe() {},
      disconnect() {},
    });
    socket.on('error', console.error);
    const timers = [];
    const run = collectLogs({duration: 30}, {
      context: async () => ({api: {socket, gameTime: async () => ({ok: 1, time: 5})}, shard: 'shard2'}),
      setTimeout: fn => timers.push(fn),
      clearTimeout: () => {},
      log: () => {},
    });
    await settle();
    assert.equal(socket.listeners('error').includes(console.error), false);
    assert.doesNotThrow(() => socket.emit('error', new Error('socket reset')));
    timers[0]();
    assert.deepEqual(await run, []);
  }
})().then(() => {
  finished = true;
  console.log('日志监听测试通过');
});
