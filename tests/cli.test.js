'use strict';

const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {COMMANDS, commandArgs, decodeStdinChunks, expressionSourceNames, helpText, parseArgs, readConsoleExpression} = require('../src/cli/args');
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

// --file 先按原样找；裸名找不到再去 probes/，.js 可省略；带目录的路径不改写。
const probesDir = path.join('repo', 'probes');
const fakeFiles = {[path.join(probesDir, 'evac-check.js')]: 'Game.time', 'local.js': 'Game.cpu'};
const readFake = async file => {
  if (file in fakeFiles) return fakeFiles[file];
  throw Object.assign(new Error('missing'), {code: 'ENOENT'});
};
assert.equal(await readConsoleExpression({file: 'evac-check'}, {probesDir, readFile: readFake}), 'Game.time');
assert.equal(await readConsoleExpression({file: 'evac-check.js'}, {probesDir, readFile: readFake}), 'Game.time');
assert.equal(await readConsoleExpression({file: 'local.js'}, {probesDir, readFile: readFake}), 'Game.cpu');
await assert.rejects(
  () => readConsoleExpression({file: path.join('other', 'evac-check.js')}, {probesDir, readFile: readFake}),
  error => error.message === `表达式文件不存在：${path.join('other', 'evac-check.js')}`,
);
await assert.rejects(() => readConsoleExpression({file: 'nope'}, {probesDir, readFile: readFake}), /表达式文件不存在：nope、.*nope、.*nope\.js/);
await assert.rejects(
  () => readConsoleExpression({file: 'locked.js'}, {probesDir, readFile: async () => {throw Object.assign(new Error('denied'), {code: 'EACCES'});}}),
  /无法读取表达式文件 locked\.js：denied/,
);

assert.deepEqual(parseArgs(['room', 'E43N28', '--objects']), {_: ['E43N28'], objects: true, command: 'room'});

// overview 的 --tick 是带值参数；help 的 overview 那一行要列出它。
assert.deepEqual(parseArgs(['overview', 'E43N28', '--tick', '77950310']), {_: ['E43N28'], tick: '77950310', command: 'overview'});
assert.deepEqual(parseArgs(['overview', 'E43N28', '--tick=77950310']), {_: ['E43N28'], tick: '77950310', command: 'overview'});
assert.throws(() => parseArgs(['overview', 'E43N28', '--tick']), /参数缺少值：--tick/);
assert.match(helpText(), /overview <房间>[^\n]*--tick/);

// history 是房间回放：--tick 选那个 tick，再加 --to 列出这段 tick 内的变化；help 里有命令行和示例小节。
assert.ok(COMMANDS.includes('overview'));
assert.ok(COMMANDS.includes('history'));
assert.doesNotThrow(() => commandArgs(['history', 'E43N28']));
assert.deepEqual(parseArgs(['history', 'E43N28', '--tick', '77949750', '--to', '77949780']), {_: ['E43N28'], tick: '77949750', to: '77949780', command: 'history'});
assert.deepEqual(parseArgs(['history', 'E43N28', '--tick=77949750', '--to=77949780']), {_: ['E43N28'], tick: '77949750', to: '77949780', command: 'history'});
assert.throws(() => parseArgs(['history', 'E43N28', '--tick', '77949750', '--to']), /参数缺少值：--to/);
assert.match(helpText(), /history <房间>[^\n]*--tick[^\n]*--to/);
assert.match(helpText(), /房间回放（官方 room-history/);
assert.match(helpText(), /history E43N28 --tick \d+ --filter type=creep/);
assert.match(helpText(), /history E43N28 --tick \d+ --to \d+ --filter type=creep --fields tick,op,name,x,y,changes/);

// bin 的 history 分支：参数在联网之前就校验，所以不需要凭据也能确认房间、--tick、--to 都传到了查询层。
const cliFailure = args => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'screeps-assistant.js'), ...args], {encoding: 'utf8'});
  assert.equal(result.status, 1, result.stdout);
  return result.stderr.trim();
};
assert.equal(cliFailure(['history', '--tick', '100']), '查询失败：history 命令需要房间名：history E43N28 或 --room E43N28');
assert.equal(cliFailure(['history', 'E43N28']), '查询失败：history 需要 --tick <tick>（房间回放）；房间统计请用 overview <房间>');
assert.equal(cliFailure(['history', '--room', 'E43N28', '--tick', '100', '--to', '50']), '查询失败：--to 必须大于 --tick（收到 --tick 100 --to 50）');
assert.equal(cliFailure(['history', 'E43N28', '--tick', 'abc']), '查询失败：--tick 必须是非负整数，收到：abc');

// logs 订阅 console 事件流听 bot 的日志：布尔 flag 和带值 flag 各自解析，help 里有命令行和示例小节
assert.ok(COMMANDS.includes('logs'));
assert.doesNotThrow(() => commandArgs(['logs']));
assert.deepEqual(
  parseArgs(['logs', '--duration', '20', '--grep', '单位', '--errors', '--all-shards', '--limit', '50', '--text']),
  {_: [], duration: '20', grep: '单位', errors: true, 'all-shards': true, limit: '50', text: true, command: 'logs'},
);
assert.deepEqual(parseArgs(['logs', '--duration=20', '--grep=单位', '--limit=50']), {_: [], duration: '20', grep: '单位', limit: '50', command: 'logs'});
assert.deepEqual(parseArgs(['logs', '--errors=false']), {_: [], command: 'logs'});
assert.throws(() => parseArgs(['logs', '--duration']), /参数缺少值：--duration/);
assert.throws(() => parseArgs(['logs', '--grep']), /参数缺少值：--grep/);
assert.throws(() => parseArgs(['logs', '--limit']), /参数缺少值：--limit/);
assert.match(helpText(), /logs\s+听 bot 的 console 日志[^\n]*--duration[^\n]*--grep[^\n]*--errors[^\n]*--all-shards[^\n]*--limit[^\n]*--text/);
assert.match(helpText(), /日志（logs/);
assert.match(helpText(), /logs --errors --duration 120/);

// bin 的 logs 分支：参数在联网之前就校验，所以不需要凭据也能确认
assert.equal(cliFailure(['logs', '--text', '--compact']), '查询失败：--text 不能和 --pick / --filter / --fields / --compact 一起用');
assert.equal(cliFailure(['logs', '--text', '--filter', 'type=x']), '查询失败：--text 不能和 --pick / --filter / --fields / --compact 一起用');
assert.equal(cliFailure(['logs', '--text', '--pick', 'x', '--fields', 'text']), '查询失败：--text 不能和 --pick / --filter / --fields / --compact 一起用');
assert.match(cliFailure(['logs', '--duration', '0']), /^查询失败：--duration 必须是 1～\d+ 的整数（秒），收到：0$/);
assert.match(cliFailure(['logs', '--limit', 'abc']), /^查询失败：--limit 必须是 1～\d+ 的整数，收到：abc$/);
assert.equal(cliFailure(['logs', '--grep', '']), '查询失败：--grep 不能为空');

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

// --pick 先取子路径，--filter / --fields 作用于取出的部分。
const report = {room: 'E1N1', stats: {energyHarvested: {total: 5, series: []}, creepsLost: {total: 0, series: []}}};
assert.deepEqual(applyOutputOptions(report, {pick: 'stats', fields: 'total'}), {energyHarvested: {total: 5}, creepsLost: {total: 0}});
assert.equal(applyOutputOptions(report, {pick: 'stats.energyHarvested.total'}), 5);
assert.throws(() => applyOutputOptions(report, {pick: 'stats.missing'}), /--pick 路径不存在：stats\.missing/);

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
