'use strict';

const assert = require('node:assert/strict');
const {
  ConsoleClosedError,
  ConsoleExpressionError,
  ConsoleRateLimitError,
  ConsoleProtocolError,
  ConsoleRejectedError,
  ConsoleTimeoutError,
  openConsoleSession,
  runConsoleRepeat,
} = require('../src/api/console');
const {wrapExpression} = require('../src/api/console-protocol');

const nextTick = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function createHarness(config = {}) {
  const {send, shard = 'shard2', unsubscribe} = config;
  const calls = {connect: 0, subscribe: 0, unsubscribe: 0, disconnect: 0};
  const sent = [];
  const timers = [];
  const logs = [];
  let listener;
  const api = {
    rateLimits: {find: () => ({limit: 360, remaining: 123, reset: 1760000000})},
    socket: {
      async connect() { calls.connect++; },
      async subscribe(channel, fn) { calls.subscribe++; listener = fn; },
      async unsubscribe() {
        calls.unsubscribe++;
        if (unsubscribe) await unsubscribe();
      },
      disconnect() { calls.disconnect++; },
    },
  };
  const deps = {
    context: async () => ({api, shard}),
    send: async (client, expression, targetShard) => {
      sent.push({expression, targetShard});
      return send(sent.length, expression, targetShard);
    },
    now: () => 1760000000000,
    log: message => logs.push(message),
    setTimeout: fn => {
      const timer = {fn};
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => {
      const at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
    },
  };
  return {api, calls, sent, timers, logs, deps, emit: event => listener({channel: 'console', data: event})};
}

function requestId(expression) {
  return expression.match(/,"([a-z0-9]{8})"\)$/)[1];
}

function responseEvent(expression, value, {tick = 123, kind = 'j'} = {}) {
  const id = requestId(expression);
  const payload = kind === 'e' ? value : JSON.stringify(value);
  return {shard: 'shard2', messages: {log: ['bot log'], results: [`@@sa:${id}:${tick}:${kind}:${payload}`]}};
}

async function openHarness(config) {
  const harness = createHarness(config);
  const session = await openConsoleSession({}, harness.deps);
  return {...harness, session};
}

(async () => {
  const first = await openHarness({send: () => ({ok: 1})});
  const retrying = first.session.run('42', {timeoutMs: 20, retries: 1});
  await nextTick();
  assert.equal(first.sent.length, 1);
  first.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  first.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  assert.equal(first.sent.length, 2);
  first.emit(responseEvent(first.sent[1].expression, 42));
  assert.deepEqual(await retrying, {shard: 'shard2', id: requestId(first.sent[1].expression), tick: 123, attempts: 2, kind: 'j', value: 42});
  await first.session.close();
  assert.deepEqual(first.calls, {connect: 1, subscribe: 1, unsubscribe: 1, disconnect: 1});
  assert.equal(first.sent[0].expression, first.sent[1].expression);
  assert.equal(first.timers.length, 0);

  const late = await openHarness({send: () => ({ok: 1})});
  const lateRun = late.session.run('42', {timeoutMs: 20, retries: 1});
  await nextTick();
  late.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  late.emit(responseEvent(late.sent[0].expression, 7));
  assert.deepEqual(await lateRun, {shard: 'shard2', id: requestId(late.sent[0].expression), tick: 123, attempts: 1, kind: 'j', value: 7});
  assert.equal(late.sent.length, 1);
  assert.equal(late.timers.length, 0);
  await late.session.close();

  const closingAttempt = await openHarness({send: () => new Promise(() => {})});
  const closingAttemptRun = closingAttempt.session.run('42', {timeoutMs: 20});
  await nextTick();
  const closingAttemptClose = closingAttempt.session.close();
  await assert.rejects(() => closingAttemptRun, error => {
    assert.ok(error instanceof ConsoleClosedError);
    assert.equal(error.kind, 'closed');
    assert.match(error.message, /会话已关闭，当前请求已取消/);
    return true;
  });
  await closingAttemptClose;
  assert.equal(closingAttempt.sent.length, 1);
  assert.equal(closingAttempt.timers.length, 0);
  assert.equal(closingAttempt.calls.disconnect, 1);

  const closingBeforeSend = await openHarness({send: () => ({ok: 1})});
  const closingBeforeSendRun = closingBeforeSend.session.run('42', {timeoutMs: 20});
  const closingBeforeSendClose = closingBeforeSend.session.close();
  await assert.rejects(() => closingBeforeSendRun, error => error instanceof ConsoleClosedError);
  await closingBeforeSendClose;
  assert.equal(closingBeforeSend.sent.length, 0);
  assert.equal(closingBeforeSend.timers.length, 0);

  const closingBackoff = await openHarness({send: () => ({ok: 1})});
  const closingBackoffRun = closingBackoff.session.run('42', {timeoutMs: 20, retries: 1});
  await nextTick();
  closingBackoff.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  assert.equal(closingBackoff.timers.length, 1);
  const closingBackoffClose = closingBackoff.session.close();
  await assert.rejects(() => closingBackoffRun, /会话已关闭，当前请求已取消/);
  await closingBackoffClose;
  assert.equal(closingBackoff.sent.length, 1);
  assert.equal(closingBackoff.timers.length, 0);

  const concurrent = await openHarness({send: () => ({ok: 1})});
  const concurrentRun = concurrent.session.run('42', {timeoutMs: 20});
  await nextTick();
  await assert.rejects(() => concurrent.session.run('43', {timeoutMs: 20}), /不能并发 run/);
  concurrent.emit(responseEvent(concurrent.sent[0].expression, 42));
  assert.equal((await concurrentRun).value, 42);
  assert.equal(concurrent.sent.length, 1);
  await concurrent.session.close();

  const rejected = await openHarness({send: () => ({error: 'expression size is too large'})});
  await assert.rejects(() => rejected.session.run('42'), error => {
    assert.ok(error instanceof ConsoleRejectedError);
    assert.equal(error.kind, 'rejected');
    assert.match(error.message, /expression size is too large/);
    return true;
  });
  assert.equal(rejected.sent.length, 1);
  await rejected.session.close();

  const limited = await openHarness({send: () => {
    const error = new Error('Too Many Requests');
    error.status = 429;
    error.headers = {'x-ratelimit-reset': 1760000000};
    error.data = {};
    return Promise.reject(error);
  }});
  await assert.rejects(() => limited.session.run('42'), error => {
    assert.ok(error instanceof ConsoleRateLimitError);
    assert.equal(error.kind, 'rate-limit');
    assert.match(error.message, /额度剩余 123\/360/);
    return true;
  });
  assert.equal(limited.sent.length, 1);
  await limited.session.close();

  let networkAttempt = 0;
  const network = await openHarness({send: () => {
    networkAttempt += 1;
    return networkAttempt === 1 ? Promise.reject(new Error('socket reset')) : {ok: 1};
  }});
  const networkRun = network.session.run('42', {timeoutMs: 20, retries: 1});
  await nextTick();
  assert.equal(network.sent.length, 1);
  network.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  assert.equal(network.sent.length, 2);
  network.emit(responseEvent(network.sent[1].expression, 9));
  assert.equal((await networkRun).attempts, 2);
  await network.session.close();

  const responseRaceRef = {};
  const responseRace = await openHarness({send: (attempt, expression) => {
    const event = responseEvent(expression, 42);
    responseRaceRef.harness.emit(event);
    return Promise.reject(new Error('socket reset'));
  }});
  const responseRaceRun = responseRace.session.run('42', {timeoutMs: 20, retries: 0});
  responseRaceRef.harness = responseRace;
  await nextTick();
  assert.equal((await responseRaceRun).value, 42);
  assert.equal(responseRace.sent.length, 1);
  await responseRace.session.close();

  const timedOut = await openHarness({send: () => ({ok: 1})});
  const timeoutRun = timedOut.session.run('42', {timeoutMs: 20, retries: 1});
  await nextTick();
  timedOut.emit({shard: 'shard2', error: 'Script execution interrupted: CPU time limit reached'});
  timedOut.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  timedOut.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  timedOut.timers.splice(0).forEach(timer => timer.fn());
  await assert.rejects(() => timeoutRun, error => {
    assert.ok(error instanceof ConsoleTimeoutError);
    assert.equal(error.kind, 'timeout');
    assert.equal(error.attempts, 2);
    assert.match(error.message, /CPU time limit reached/);
    assert.match(error.message, /这通常表示该 tick 的 console 命令没有执行/);
    return true;
  });
  await timedOut.session.close();

  const noise = await openHarness({send: () => ({ok: 1})});
  const noiseRun = noise.session.run('42', {timeoutMs: 20, retries: 0});
  await nextTick();
  noise.emit({shard: 'shard3', messages: {results: ['wrong shard']}});
  noise.emit({shard: 'shard2', messages: {log: ['bot log'], results: ['@@sa:other00:123:j:99']}});
  noise.timers.splice(0).forEach(timer => timer.fn());
  await assert.rejects(() => noiseRun, /未收到回包/);
  await noise.session.close();

  const expressionError = await openHarness({send: () => ({ok: 1})});
  const expressionRun = expressionError.session.run('throw new Error("boom")', {timeoutMs: 20});
  await nextTick();
  expressionError.emit(responseEvent(expressionError.sent[0].expression, 'Error: boom', {kind: 'e'}));
  await assert.rejects(() => expressionRun, error => {
    assert.ok(error instanceof ConsoleExpressionError);
    assert.equal(error.kind, 'expression');
    assert.equal(error.tick, 123);
    return true;
  });
  assert.equal(expressionError.sent.length, 1);
  await expressionError.session.close();

  const lateError = await openHarness({send: () => ({ok: 1})});
  const lateErrorRun = lateError.session.run('throw new Error("late")', {timeoutMs: 20, retries: 1});
  await nextTick();
  lateError.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  lateError.emit(responseEvent(lateError.sent[0].expression, 'Error: late\n    at user.js:1:1\n    at runtime', {kind: 'e'}));
  await assert.rejects(() => lateErrorRun, error => {
    assert.ok(error instanceof ConsoleExpressionError);
    assert.equal(error.kind, 'expression');
    assert.equal(error.message, 'Error: late\n    at user.js:1:1');
    assert.equal(error.fullError, 'Error: late\n    at user.js:1:1\n    at runtime');
    return true;
  });
  assert.equal(lateError.sent.length, 1);
  assert.equal(lateError.timers.length, 0);
  await lateError.session.close();

  const protocol = await openHarness({send: () => ({ok: 1})});
  const protocolRun = protocol.session.run('JSON.parse("x")', {timeoutMs: 20, retries: 1});
  await nextTick();
  protocol.timers.splice(0).forEach(timer => timer.fn());
  await nextTick();
  assert.equal(protocol.timers.length, 1);
  const protocolId = requestId(protocol.sent[0].expression);
  protocol.emit({shard: 'shard2', messages: {results: [`@@sa:${protocolId}:123:j:{坏JSON`]}});
  await assert.rejects(() => protocolRun, error => {
    assert.ok(error instanceof ConsoleProtocolError);
    assert.equal(error.kind, 'protocol');
    assert.match(error.message, /console 回包解析失败/);
    assert.match(error.message, /@@sa:\w{8}:123:j:\{坏JSON/);
    return true;
  });
  assert.equal(protocol.sent.length, 1);
  assert.equal(protocol.timers.length, 0);
  await protocol.session.close();

  const raw = await openHarness({send: () => ({ok: 1})});
  const rawRun = raw.session.run('42', {timeoutMs: 20, raw: true});
  await nextTick();
  raw.emit({shard: 'shard2', messages: {log: ['bot log'], results: []}});
  raw.emit({shard: 'shard2', messages: {results: ['42']}});
  assert.deepEqual(await rawRun, {shard: 'shard2', attempts: 1, kind: 'raw', value: ['42']});
  await raw.session.close();

  const rawError = await openHarness({send: () => ({ok: 1})});
  const rawErrorRun = rawError.session.run('null.x', {timeoutMs: 20, raw: true});
  const rawErrorText = 'TypeError: full raw error\n    at first\n    at second';
  await nextTick();
  rawError.emit({shard: 'shard2', error: rawErrorText});
  await assert.rejects(() => rawErrorRun, error => {
    assert.ok(error instanceof ConsoleExpressionError);
    assert.equal(error.message, `表达式执行出错：${rawErrorText}`);
    assert.equal(error.fullError, `表达式执行出错：${rawErrorText}`);
    return true;
  });
  await rawError.session.close();

  const cleanup = await openHarness({send: () => ({ok: 1}), unsubscribe: async () => {
    throw new Error('unsubscribe failed');
  }});
  const cleanupRun = cleanup.session.run('42', {timeoutMs: 20});
  await nextTick();
  cleanup.emit(responseEvent(cleanup.sent[0].expression, 42));
  assert.equal((await cleanupRun).value, 42);
  await cleanup.session.close();
  assert.equal(cleanup.calls.disconnect, 1);

  const repeated = {runs: 0};
  let repeatedNow = 0;
  const repeatWaits = [];
  const repeatStats = await runConsoleRepeat({
    run: async () => {
      repeated.runs += 1;
      repeatedNow += 3000;
      return {tick: repeated.runs, value: repeated.runs};
    },
  }, 'Game.time', {intervalMs: 2000, times: 2, timeoutMs: 20, retries: 0}, {
    now: () => repeatedNow,
    sleep: async ms => repeatWaits.push(ms),
    emit: () => {},
  });
  assert.deepEqual(repeatStats, {processed: 2, successful: 2, failed: 0, total: 2, interrupted: false});
  assert.deepEqual(repeatWaits, []);

  const unwrappedFrames = [];
  await runConsoleRepeat({
    run: async () => ({tick: 1, value: JSON.stringify({x: 1})}),
  }, 'JSON.stringify({x: 1})', {intervalMs: 0, times: 1, timeoutMs: 20, retries: 0}, {
    now: () => 0,
    sleep: async () => {},
    emit: value => unwrappedFrames.push(value),
  });
  assert.deepEqual(unwrappedFrames, [{frame: 1, tick: 1, value: {x: 1}}]);

  const stoppedStats = await runConsoleRepeat({
    run: async () => {
      throw new Error('should not run');
    },
  }, 'Game.time', {intervalMs: 0, times: 2, timeoutMs: 20, retries: 0}, {
    now: () => 0,
    sleep: async () => {},
    emit: () => {},
    shouldStop: () => true,
  });
  assert.deepEqual(stoppedStats, {processed: 0, successful: 0, failed: 0, total: 2, interrupted: true});

  const repeatOptions = [];
  await runConsoleRepeat({
    run: async (expression, opts) => {
      repeatOptions.push(opts);
      return {tick: 1, value: 1};
    },
  }, 'Game.time', {intervalMs: 0, times: 1}, {
    now: () => 0,
    sleep: async () => {},
    emit: () => {},
  });
  assert.equal(repeatOptions[0].retries, 0);

  const emitted = [];
  let failureRuns = 0;
  await assert.rejects(() => runConsoleRepeat({
    run: async () => {
      failureRuns += 1;
      if (failureRuns === 3) throw new ConsoleRejectedError('server rejected');
      if (failureRuns === 2) throw new ConsoleTimeoutError('no response');
      return {tick: 1, value: 'ok'};
    },
  }, 'Game.time', {intervalMs: 0, times: 3}, {now: () => 0, sleep: async () => {}, emit: value => emitted.push(value)}), /server rejected/);
  assert.equal(emitted.length, 3);
  assert.equal(emitted[1].kind, 'timeout');
  assert.equal(emitted[2].kind, 'rejected');
})().then(() => console.log('console 会话测试通过'));
