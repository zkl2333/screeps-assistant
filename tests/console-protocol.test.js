'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  MAX_EXPRESSION_BYTES,
  assertExpressionSize,
  createRequestId,
  expressionBytes,
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
const exact = 'x'.repeat(MAX_EXPRESSION_BYTES);
assertExpressionSize(exact);
assert.throws(() => assertExpressionSize(exact + 'x'), /表达式过长：实际 1001 字节，上限 1000 字节/);

console.log('console 协议测试通过');