'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  MAX_EXPRESSION_BYTES,
  OFFICIAL_EXPRESSION_LIMIT,
  assertExpressionSize,
  buildChunkExpressions,
  buildRelayBootstrapExpression,
  createRequestId,
  expressionBytes,
  fitsOfficialConsole,
  jsonExpressionLength,
  parseResponse,
  unwrapValue,
  wrapExpression,
} = require('../src/api/console-protocol');

const id = createRequestId();
assert.match(id, /^[a-z0-9]{8}$/);
assert.notEqual(createRequestId(), createRequestId());

function execute(code, time = 123) {
  const context = {Game: {time}};
  context.global = context;
  vm.createContext(context);
  const driver = vm.runInContext('(function(code){return "" + eval(code);})', context);
  return {output: driver(code), context};
}

function check(code, expected, time = 123) {
  const {output} = execute(wrapExpression(code, id), time);
  const parsed = parseResponse(output, id);
  assert.equal(parsed.id, id);
  assert.equal(parsed.tick, time);
  assert.equal(parsed.kind, 'j');
  assert.deepEqual(parsed.value, expected);
}

check('42', 42);
check('({a: 1})', {a: 1});
check('[1, 2]', [1, 2]);
check("'hello'", 'hello');
check('var a = 1; a + 1', 2);
check('undefined', undefined);
assert.deepEqual(unwrapValue('{"a":1}'), {a: 1});

const varShadow = execute(wrapExpression('var t = 5; t', id), 234);
assert.deepEqual(parseResponse(varShadow.output, id), {id, tick: 234, kind: 'j', value: 5});
assert.equal(varShadow.context.__sa[id].t, 234);

const thrown = execute(wrapExpression('throw new Error("boom")', id));
const thrownParsed = parseResponse(thrown.output, id);
assert.equal(thrownParsed.kind, 'e');
assert.match(thrownParsed.error, /boom/);

const syntax = execute(wrapExpression('var {', id));
assert.equal(parseResponse(syntax.output, id).kind, 'e');

const circular = execute(wrapExpression('var a = {}; a.self = a; a', id));
assert.deepEqual(parseResponse(circular.output, id), {id, tick: 123, kind: 's', value: '[object Object]'});

const escaped = parseResponse(`@@sa:${id}:123:j:&quot;a&quot;`, id);
assert.deepEqual(escaped, {id, tick: 123, kind: 'j', value: 'a'});
assert.equal(parseResponse(`@@sa:other00:123:j:1`, id), null);

const sideContext = {Game: {time: 300}, sideEffects: 0};
sideContext.global = sideContext;
vm.createContext(sideContext);
const sideCode = 'global.sideEffects++; global.sideEffects';
const sideExpression = wrapExpression(sideCode, id);
const driver = vm.runInContext('(function(code){return "" + eval(code);})', sideContext);
const first = driver(sideExpression);
const second = driver(sideExpression);
assert.equal(sideContext.sideEffects, 1);
assert.equal(first, second);
assert.deepEqual(parseResponse(first, id), {id, tick: 300, kind: 'j', value: 1});

sideContext.__sa.old = {t: 100, r: '@@sa:old:100:j:1'};
vm.runInContext(wrapExpression('global.keep = true', 'newid000'), sideContext);
assert.equal(sideContext.__sa.old, undefined);
assert.ok(sideContext.__sa.newid000);

const code = 'x'.repeat(100);
assert.ok(wrapExpression(code, id).length - JSON.stringify(code).length <= 320);
assert.equal(expressionBytes('½'), 2);
const exact = 'x'.repeat(OFFICIAL_EXPRESSION_LIMIT - 2);
assertExpressionSize(exact);
assert.throws(() => assertExpressionSize(exact + 'x'), /表达式过长：JSON 序列化后 1025 字符，上限 1024 字符/);
// 含中文时按 JSON 序列化字符数而非 UTF-8 字节数计算（400 汉字 = 1200 UTF-8 字节，但 JSON 只有 402 字符）。
assertExpressionSize('中'.repeat(400));
// 含双引号转义时按 JSON 序列化后字符数拦截。
assert.throws(() => assertExpressionSize('"' + 'x'.repeat(OFFICIAL_EXPRESSION_LIMIT - 3)), /表达式过长：JSON 序列化后 1025 字符，上限 1024 字符/);

assert.equal(jsonExpressionLength('abc'), 5);
assert.equal(jsonExpressionLength('a"b'), 6);
assert.equal(fitsOfficialConsole('a'.repeat(OFFICIAL_EXPRESSION_LIMIT - 2)), true);
assert.equal(fitsOfficialConsole('a'.repeat(OFFICIAL_EXPRESSION_LIMIT - 1)), false);

// relay bootstrap：读取 Memory.__sa_boot、先删键再 eval，即使抛错也不留残留。
const relayCtx = {Game: {time: 500}, Memory: {__sa_boot: 'var x = 21; x * 2'}};
relayCtx.global = relayCtx;
vm.createContext(relayCtx);
const relayDriver = vm.runInContext('(function(code){return "" + eval(code);})', relayCtx);
const relayOut = relayDriver(wrapExpression(buildRelayBootstrapExpression(), 'rel00001'));
assert.deepEqual(parseResponse(relayOut, 'rel00001'), {id: 'rel00001', tick: 500, kind: 'j', value: 42});
assert.equal(relayCtx.Memory.__sa_boot, undefined);

relayCtx.Memory.__sa_boot = 'throw new Error("relay boom")';
const relayErrOut = relayDriver(wrapExpression(buildRelayBootstrapExpression(), 'rel00002'));
assert.equal(parseResponse(relayErrOut, 'rel00002').kind, 'e');
assert.equal(relayCtx.Memory.__sa_boot, undefined);

// chunk 分片：每片经 wrapExpression 包装后均 <= 1024 字符，顺序执行后完整求值并清理缓冲区。
const longScript = Array.from({length: 40}, (_, i) => `var v${i} = "line_${i}\\n";`).join('') + 'v0 + v39';
const {bufId, expressions} = buildChunkExpressions(longScript, {bufId: 'buf00001'});
assert.ok(expressions.length > 1);
for (let i = 0; i < expressions.length; i += 1) {
  const wrapped = wrapExpression(expressions[i], `chk0000${i}`.slice(0, 8));
  assert.ok(jsonExpressionLength(wrapped) <= OFFICIAL_EXPRESSION_LIMIT);
}
const chunkCtx = {Game: {time: 600}};
chunkCtx.global = chunkCtx;
vm.createContext(chunkCtx);
const chunkDriver = vm.runInContext('(function(code){return "" + eval(code);})', chunkCtx);
let finalChunkParsed = null;
for (let i = 0; i < expressions.length; i += 1) {
  const reqId = `chk0000${i}`.slice(0, 8);
  const out = chunkDriver(wrapExpression(expressions[i], reqId));
  finalChunkParsed = parseResponse(out, reqId);
}
assert.equal(finalChunkParsed.kind, 'j');
assert.equal(finalChunkParsed.value, 'line_0\nline_39\n');
assert.equal(chunkCtx.__sa_b[bufId], undefined);

console.log('console 协议测试通过');