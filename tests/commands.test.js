'use strict';

const assert = require('node:assert/strict');
const {COMMAND_BY_NAME, COMMAND_TABLE, flagName, tableFlags} = require('../src/commands');
const {COMMANDS, BOOLEAN_FLAGS, VALUE_FLAGS, commandArgs, helpText, parseArgs} = require('../src/cli/args');

// 命令表是 CLI 和 MCP 的唯一来源：名字唯一、每个命令都有处理函数说明。
assert.equal(new Set(COMMAND_TABLE.map(command => command.name)).size, COMMAND_TABLE.length);
for (const command of COMMAND_TABLE) {
  assert.equal(typeof command.run, 'function', `${command.name} 缺少 run`);
  assert.ok(command.description?.length > 0, `${command.name} 缺少 description`);
  assert.equal(COMMAND_BY_NAME[command.name], command);
}

// CLI 的命令列表 = 命令表 + console/help；每个命令都能通过参数校验。
assert.deepEqual(COMMANDS, [...COMMAND_TABLE.map(command => command.name), 'console', 'help']);
for (const command of COMMAND_TABLE) {
  assert.doesNotThrow(() => commandArgs([command.name]), `${command.name} 未被 CLI 接受`);
}

// camelCase 键 ↔ kebab-case flag，两边一一对应，且 CLI 都认得。
assert.equal(flagName('allShards'), 'all-shards');
assert.equal(flagName('summaryOnly'), 'summary-only');
assert.equal(flagName('cacheTtl'), 'cache-ttl');
assert.equal(flagName('noCache'), 'no-cache');
assert.equal(flagName('room'), 'room');

const {booleans, values} = tableFlags();
for (const flag of booleans) assert.ok(BOOLEAN_FLAGS.has(flag), `--${flag} 应是布尔 flag`);
for (const flag of values) assert.ok(VALUE_FLAGS.has(flag), `--${flag} 应是带值 flag`);

// 命令表里的参数写成 flag 都能解析出来，不需要再单独维护 KNOWN_FLAGS。
assert.deepEqual(parseArgs(['logs', '--all-shards', '--limit', '50']), {_: [], 'all-shards': true, limit: '50', command: 'logs'});
assert.deepEqual(parseArgs(['map', '--summary-only', '--cache-ttl', '1000']), {_: [], 'summary-only': true, 'cache-ttl': '1000', command: 'map'});
assert.deepEqual(parseArgs(['map', '--around', 'W1N1', '--radius', '2']), {_: [], around: 'W1N1', radius: '2', command: 'map'});

// 只有 console 和 help 是表外的，别把表外命令漏掉。
assert.deepEqual(COMMANDS.filter(name => !COMMAND_BY_NAME[name]).sort(), ['console', 'help']);

// status 之前只有 MCP 有，现在 CLI 也支持，help 里要能看到。
assert.ok(COMMAND_BY_NAME.status);
assert.doesNotThrow(() => commandArgs(['status']));
assert.match(helpText(), /status\s+检查目标和本地凭证配置/);

// 房间类命令的位置参数只声明一次，CLI 靠它把 `room W1N1` 对上 room。
for (const name of ['room', 'overview', 'history']) {
  assert.equal(COMMAND_BY_NAME[name].params.room.positional, true, `${name} 的 room 应是位置参数`);
  assert.equal(COMMAND_BY_NAME[name].params.room.required, true, `${name} 的 room 应必填`);
}
assert.equal(COMMAND_BY_NAME.memory.params.path.positional, true);
assert.equal(COMMAND_BY_NAME.segment.params.id.mcpRequired, undefined);

// summary 也支持 --branch 覆盖代码分支（原先在 bin 里单独透传，现在走命令表）。
assert.deepEqual(parseArgs(['summary', '--branch', 'default']), {_: [], branch: 'default', command: 'summary'});
assert.equal(COMMAND_BY_NAME.summary.params.branch.type, 'string');
assert.equal(COMMAND_BY_NAME.code.params.branch.type, 'string');

console.log('命令表测试通过');
