'use strict';

const assert = require('node:assert/strict');
const {commandArgs, decodeStdinChunks, expressionSourceNames, parseArgs, readConsoleExpression} = require('../src/cli/args');
const {applyOutputOptions, consoleEnvelope, printResult} = require('../src/cli/output');

(async () => {

assert.deepEqual(parseArgs(['--target', 'season', 'memory', 'operations']), {_: ['operations'], target: 'season', command: 'memory'});
assert.deepEqual(parseArgs(['memory', 'operations', '--target=season']), {_: ['operations'], target: 'season', command: 'memory'});
assert.deepEqual(parseArgs(['map', '--room=E41N23', '--ascii']), {_: [], room: 'E41N23', ascii: true, command: 'map'});
assert.deepEqual(parseArgs(['--help']), {_: [], help: true, command: 'summary'});
assert.deepEqual(commandArgs(['--help', 'unknown']), {_: [], help: true, command: 'help'});
assert.throws(() => parseArgs(['summary', '--unknown']), /未知参数：--unknown。收到的参数：\["summary","--unknown"\]/);
assert.throws(() => parseArgs(['summary', '--target']), /参数缺少值：--target/);
assert.throws(() => commandArgs(['what', '--target', 'main']), /暂不支持命令："what"。收到的参数：\["what","--target","main"\]。可用命令：summary, account/);

assert.deepEqual(expressionSourceNames({_: ['Game.time']}), ['位置参数']);
assert.deepEqual(expressionSourceNames({_: [], expr: 'Game.time'}), ['--expr']);
assert.deepEqual(expressionSourceNames({_: [], file: 'probe.js'}), ['--file']);
assert.deepEqual(expressionSourceNames({_: ['Game.time'], expr: 'Game.cpu'}), ['位置参数', '--expr']);
assert.equal(await readConsoleExpression({_: ['Game.time']}), 'Game.time');
assert.equal(await readConsoleExpression({expr: ' Game.time '}), 'Game.time');
assert.equal(await readConsoleExpression({file: 'probe.js'}, {readFile: async () => '\uFEFF Game.time \n'}), 'Game.time');
assert.equal(await readConsoleExpression({file: '-'}, {readStdin: async () => 'Game.cpu\n'}), 'Game.cpu');
assert.equal(decodeStdinChunks([Buffer.from([0xe4]), Buffer.from([0xb8, 0xad])]), '中');
await assert.rejects(() => readConsoleExpression({_: ['a'], expr: 'b'}), /来源只能给一种/);
await assert.rejects(() => readConsoleExpression({file: 'missing.js'}, {readFile: async () => {throw Object.assign(new Error('missing'), {code: 'ENOENT'});}}), /表达式文件不存在：missing\.js/);

const creeps = [
  {name: 'h1', memory: {role: 'harvester', room: 'E1N1'}},
  {name: 'u1', memory: {role: 'upgrader', room: 'E1N1'}},
];
assert.deepEqual(applyOutputOptions(creeps, {filter: 'memory.role=harvester'}), [creeps[0]]);
assert.deepEqual(applyOutputOptions(creeps, {filter: 'memory.role!=harvester'}), [creeps[1]]);
assert.deepEqual(applyOutputOptions({h1: creeps[0], u1: creeps[1]}, {filter: 'memory.room=E1N1'}), {h1: creeps[0], u1: creeps[1]});
assert.deepEqual(applyOutputOptions(creeps, {filter: 'memory.missing!=x'}), creeps);
assert.throws(() => applyOutputOptions(42, {filter: 'a=1'}), /--filter 只适用于数组或对象集合，当前结果是 number/);
assert.deepEqual(applyOutputOptions(creeps, {fields: 'name,memory.role'}), [
  {name: 'h1', 'memory.role': 'harvester'},
  {name: 'u1', 'memory.role': 'upgrader'},
]);
assert.deepEqual(applyOutputOptions({h1: creeps[0]}, {fields: 'name,memory.role'}), {
  h1: {name: 'h1', 'memory.role': 'harvester'},
});
assert.throws(() => applyOutputOptions('text', {fields: 'name'}), /--fields 只适用于数组或对象集合，当前结果是 string/);

const compact = [];
printResult({a: 1}, {compact: true}, {write: text => compact.push(text)});
assert.equal(compact.join(''), '{"a":1}\n');
const undefinedOutput = [];
printResult(undefined, {}, {write: text => undefinedOutput.push(text)});
assert.equal(undefinedOutput.join(''), 'undefined\n');
assert.deepEqual(consoleEnvelope({shard: 'shard2', id: 'abcd1234', tick: 123, attempts: 1}, undefined), {
  shard: 'shard2', id: 'abcd1234', tick: 123, attempts: 1, value: null, valueKind: 'undefined',
});
assert.deepEqual(consoleEnvelope({shard: 'shard2', id: 'abcd1234', tick: 123, attempts: 1}, 42), {
  shard: 'shard2', id: 'abcd1234', tick: 123, attempts: 1, value: 42,
});

const pretty = [];
printResult({a: 1}, {}, {write: text => pretty.push(text)});
assert.match(pretty.join(''), /\{\n {2}"a": 1\n\}/);

})().then(() => console.log('CLI 参数与输出测试通过'));
