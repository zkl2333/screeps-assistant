const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

test('watch options allow only supported channels and values', () => {
  assert.deepEqual(cli.parseWatchArgs(['cpu', '--shard', 'shard2', '--count', '2']), {
    channel: 'cpu',
    target: undefined,
    shard: 'shard2',
    count: 2,
    pretty: false
  });
  assert.deepEqual(cli.parseWatchArgs(['memory', 'creeps.预定_985', 'shard2', '--pretty']), {
    channel: 'memory',
    target: 'creeps.预定_985',
    shard: 'shard2',
    count: undefined,
    pretty: true
  });
  assert.throws(() => cli.parseWatchArgs(['not-a-channel']), /channel/);
  assert.throws(() => cli.parseWatchArgs(['cpu', '--unknown', 'value']), /Unknown option/);
});

test('watch cpu connects, subscribes, and emits JSON events', async () => {
  const socket = new EventEmitter();
  let subscribed;
  socket.connect = async () => {};
  socket.subscribeUserCpu = async callback => {
    subscribed = callback;
  };
  const output = [];

  const watching = cli.runWatch(['cpu', '--count', '1'], { socket }, {
    write: value => output.push(value)
  });
  await new Promise(resolve => setImmediate(resolve));
  subscribed({ type: 'user', path: 'cpu', data: { cpu: 12, memory: 4096 } });
  await watching;

  assert.deepEqual(output, [
    '{"type":"user","path":"cpu","data":{"cpu":12,"memory":4096}}\n'
  ]);
});

test('watch memory uses the requested path and shard', async () => {
  const socket = new EventEmitter();
  let subscription;
  socket.connect = async () => {};
  socket.subscribeUserMemory = async (path, shard, callback) => {
    subscription = { path, shard, callback };
  };
  const output = [];

  const watching = cli.runWatch(['memory', 'creeps.预定_985', 'shard2', '--count', '1'], { socket }, {
    write: value => output.push(value)
  });
  await new Promise(resolve => setImmediate(resolve));
  subscription.callback({ type: 'user', path: 'memory/shard2/creeps.预定_985', data: '{}' });
  await watching;

  assert.deepEqual(subscription.path, 'creeps.预定_985');
  assert.deepEqual(subscription.shard, 'shard2');
  assert.equal(output.length, 1);
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
