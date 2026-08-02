const assert = require('node:assert/strict');
const test = require('node:test');

const cli = require('./screeps-api-cli');

test('all documented commands are explicit read-only commands', () => {
  assert.equal(cli.COMMAND_HELP.length, cli.READ_ONLY_COMMANDS.size);
  for (const [command] of cli.COMMAND_HELP) assert.ok(cli.READ_ONLY_COMMANDS.has(command));

  for (const forbidden of [
    'user-code-set',
    'user-memory-set',
    'user-memory-segment-set',
    'user-console',
    'game-create-construction',
    'messages-send',
    'messages-mark-read'
  ]) {
    assert.equal(cli.READ_ONLY_COMMANDS.has(forbidden), false, forbidden);
  }
  assert.ok(cli.READ_ONLY_COMMANDS.has('token-info'));
});

test('dependency-backed allowlists include all supported values', () => {
  assert.deepEqual([...cli.VALID_INTERVALS].sort((a, b) => a - b), [8, 180, 1440]);
  assert.ok(cli.ROOM_STATS.has('energyHarvested'));
  assert.ok(cli.MAP_STATS.has('owner0'));
  assert.ok(cli.MAP_STATS.has('claim0'));
  assert.ok(cli.MARKET_RESOURCES.has('energy'));
  assert.ok(cli.MARKET_RESOURCES.has('XGHO2'));
  assert.deepEqual([...cli.LEADERBOARD_MODES].sort(), ['power', 'world']);
});

test('shared options parse without enabling arbitrary options', () => {
  const parsed = cli.parseOptions([
    '--room', 'E42N24', '--interval', '8', '--shard', 'shard2', '--pretty'
  ]);
  assert.deepEqual(parsed.positional, []);
  assert.equal(parsed.options.room, 'E42N24');
  assert.equal(parsed.options.pretty, true);
  assert.throws(() => cli.parseOptions(['--unknown', 'value']), /Unknown option/);
});

test('unknown commands fail before loading credentials', async () => {
  await assert.rejects(cli.runCommand('not-a-command', []), /Unknown command/);
});

test('every documented command has a working explicit route', async () => {
  const args = {
    version: [],
    'auth-mod': [],
    'auth-me': [],
    'token-info': [],
    'servers-list': [],
    'register-check-email': ['agent@example.com'],
    'register-check-username': ['agent'],
    'room-history': ['E42N24', '1', 'shard2'],
    'map-stats': ['E42N24', 'owner0', 'shard2'],
    'unique-object-name': ['spawn', 'shard2'],
    'check-object-name': ['spawn', 'Spawn1', 'shard2'],
    'unique-flag-name': ['shard2'],
    'check-flag-name': ['Flag1', 'shard2'],
    'game-time': ['shard2'],
    'world-size': ['shard2'],
    'room-decorations': ['E42N24', 'shard2'],
    'room-objects': ['E42N24', 'shard2'],
    'room-status': ['E42N24', 'shard2'],
    'room-terrain': ['E42N24', 'shard2'],
    'room-terrain-unencoded': ['E42N24', 'shard2'],
    'room-overview': ['E42N24', '8', 'shard2'],
    'market-orders-index': ['shard2'],
    'market-my-orders': [],
    'market-orders': ['energy', 'shard2'],
    'market-stats': ['energy', 'shard2'],
    'shards-info': [],
    'leaderboard-list': [],
    'leaderboard-find': ['agent'],
    'leaderboard-seasons': [],
    'seasons-list': [],
    'seasons-current': [],
    'world-start-room': ['shard2'],
    'world-status': [],
    branches: [],
    'code-get': ['main'],
    'decorations-inventory': [],
    'decorations-themes': [],
    'respawn-prohibited-rooms': [],
    'memory-get': [],
    'memory-segment-get': ['0', 'shard2'],
    'messages-list': ['user-id'],
    'messages-index': [],
    'messages-unread-count': [],
    'user-find': ['agent'],
    'user-find-by-id': ['user-id'],
    'user-stats': ['user-id', '8'],
    'user-rooms': ['user-id'],
    'user-overview': ['8', 'energyHarvested'],
    'money-history': [],
    'user-name': [],
    'experimental-pvp': [],
    'experimental-nukes': [],
    'warpath-battles': [],
    'scoreboard-list': []
  };
  const fakeApi = new Proxy({}, { get: () => async () => ({}) });

  assert.deepEqual(new Set(Object.keys(args)), cli.READ_ONLY_COMMANDS);
  for (const command of cli.READ_ONLY_COMMANDS) {
    await assert.doesNotReject(cli.runCommand(command, args[command], fakeApi), command);
  }
});
