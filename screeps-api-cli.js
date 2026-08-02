// Explicit read-only facade for screeps-api.
// Keep the command set explicit: never dispatch arbitrary client methods.
const {
  ScreepsHttpClient,
  LeaderboardModes,
  MarketResources,
  RoomStatIntervals,
  RoomStats
} = require('screeps-api');

const VALID_INTERVALS = new Set(Object.values(RoomStatIntervals));
const ROOM_STATS = new Set(Object.values(RoomStats));
const MAP_STATS = new Set([...ROOM_STATS, 'owner0', 'claim0']);
const MARKET_RESOURCES = new Set(Object.values(MarketResources));
const LEADERBOARD_MODES = new Set(Object.values(LeaderboardModes));

const COMMAND_HELP = [
  ['version', 'Screeps server version information'],
  ['auth-mod', 'Authentication mode information'],
  ['auth-me', 'Authenticated account summary'],
  ['token-info', 'Configured token permissions without token value'],
  ['servers-list', 'Available server list'],
  ['register-check-email', 'Check whether an email is registered'],
  ['register-check-username', 'Check whether a username is registered'],
  ['room-history', 'Historical room snapshots'],
  ['map-stats', 'Map-wide room statistics'],
  ['unique-object-name', 'Generate an unused object name'],
  ['check-object-name', 'Check an object name'],
  ['unique-flag-name', 'Generate an unused flag name'],
  ['check-flag-name', 'Check a flag name'],
  ['game-time', 'Game time'],
  ['world-size', 'Shard world dimensions'],
  ['room-decorations', 'Room decorations'],
  ['room-objects', 'Room objects and users'],
  ['room-status', 'Room status'],
  ['room-terrain', 'Encoded room terrain'],
  ['room-terrain-unencoded', 'Human-readable room terrain'],
  ['room-overview', 'Official room time-series stats'],
  ['market-orders-index', 'Market order index'],
  ['market-my-orders', 'Authenticated user market orders'],
  ['market-orders', 'Market orders for a resource'],
  ['market-stats', 'Market price statistics for a resource'],
  ['shards-info', 'Shard metadata'],
  ['leaderboard-list', 'Leaderboard entries'],
  ['leaderboard-find', 'Leaderboard entry for a username'],
  ['leaderboard-seasons', 'Leaderboard seasons'],
  ['seasons-list', 'Season metadata'],
  ['seasons-current', 'Current season metadata'],
  ['world-start-room', 'Authenticated user world start room'],
  ['world-status', 'Authenticated user world status'],
  ['branches', 'Authenticated user code branches'],
  ['code-get', 'Read code from a branch'],
  ['decorations-inventory', 'Authenticated user decorations'],
  ['decorations-themes', 'Decoration themes'],
  ['respawn-prohibited-rooms', 'Rooms unavailable for respawn'],
  ['memory-get', 'Read Memory'],
  ['memory-segment-get', 'Read RawMemory segments'],
  ['messages-list', 'Read messages with a user'],
  ['messages-index', 'Read message threads'],
  ['messages-unread-count', 'Read unread message count'],
  ['user-find', 'Find a user by username'],
  ['user-find-by-id', 'Find a user by ID'],
  ['user-stats', 'Read stats for a user'],
  ['user-rooms', 'Read rooms claimed by a user'],
  ['user-overview', 'Authenticated user stats by room and time'],
  ['money-history', 'Authenticated user market transactions'],
  ['user-name', 'Authenticated username'],
  ['experimental-pvp', 'Recent PVP activity'],
  ['experimental-nukes', 'Active nuclear launches'],
  ['warpath-battles', 'Recent warpath battles'],
  ['scoreboard-list', 'Seasonal scoreboard entries']
];

const READ_ONLY_COMMANDS = new Set(COMMAND_HELP.map(([command]) => command));

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseOptions(argv) {
  const positional = [];
  const options = { server: 'main', app: 'default', pretty: false };
  const supported = [
    'room', 'rooms', 'interval', 'shard', 'path', 'stat', 'server', 'app', 'email',
    'tick', 'resource', 'type', 'name', 'branch', 'id', 'segment', 'offset',
    'limit', 'search', 'mode', 'season', 'username', 'respondent', 'page'
  ];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--pretty') {
      options.pretty = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const option = token.slice(2);
    if (!supported.includes(option)) throw new Error(`Unknown option: ${token}`);
    options[option] = readValue(argv, index, token);
    index += 1;
  }

  return { positional, options };
}

function positionalOrOption(options, positional, option, index) {
  return options[option] ?? positional[index];
}

function requiredValue(value, name) {
  if (value === undefined || value === '') throw new Error(`Missing value for ${name}`);
  return value;
}

function integerValue(value, name, { defaultValue, min = 0 } = {}) {
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing value for ${name}`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return number;
}

function optionalInteger(value, name, defaultValue) {
  return value === undefined ? defaultValue : integerValue(value, name);
}

function roomName(value) {
  if (!value || !/^[WE]\d+[NS]\d+$/.test(value)) {
    throw new Error(`Invalid or missing room name: ${value || '(none)'}`);
  }
  return value;
}

function roomList(value) {
  const rooms = requiredValue(value, 'rooms')
    .split(',')
    .map(room => room.trim())
    .filter(Boolean)
    .map(roomName);
  if (rooms.length === 0) throw new Error('At least one room is required');
  return rooms;
}

function intervalValue(value, defaultValue) {
  const interval = integerValue(value, 'interval', { defaultValue });
  if (!VALID_INTERVALS.has(interval)) throw new Error('Interval must be one of 8, 180, or 1440 minutes');
  return interval;
}

function oneOf(value, name, values) {
  const result = requiredValue(value, name);
  if (!values.has(result)) throw new Error(`${name} must be one of: ${[...values].join(', ')}`);
  return result;
}

function statName(value) {
  return oneOf(value, 'stat', ROOM_STATS);
}

function mapStatName(value) {
  return oneOf(value, 'stat', MAP_STATS);
}

function marketResource(value) {
  return oneOf(value, 'resource', MARKET_RESOURCES);
}

function leaderboardMode(value, defaultValue = 'world') {
  return oneOf(value === undefined ? defaultValue : value, 'mode', LEADERBOARD_MODES);
}

function withMeta(endpoint, meta, response) {
  return { ...response, endpoint, ...meta };
}

async function runCommand(command, argv, client) {
  if (!READ_ONLY_COMMANDS.has(command)) throw new Error(`Unknown command: ${command}`);

  const { positional, options } = parseOptions(argv);
  const api = client || await ScreepsHttpClient.fromConfig(options.server, { app: options.app });

  if (command === 'version') return withMeta(command, {}, await api.version());
  if (command === 'auth-mod') return withMeta(command, {}, await api.authmod());
  if (command === 'auth-me') return withMeta(command, {}, await api.authMe());
  if (command === 'token-info') {
    const tokenInfo = await api.tokenInfo();
    const safeInfo = Object.fromEntries(Object.entries(tokenInfo || {}).filter(([key]) => key !== 'token'));
    return withMeta(command, { tokenPresent: Boolean(tokenInfo && tokenInfo.token) }, safeInfo);
  }
  if (command === 'servers-list') return withMeta(command, {}, await api.serversList());

  if (command === 'register-check-email') {
    const email = positionalOrOption(options, positional, 'email', 0);
    return withMeta(command, { email }, await api.registerCheckEmail(requiredValue(email, 'email')));
  }

  if (command === 'register-check-username') {
    const username = positionalOrOption(options, positional, 'username', 0);
    return withMeta(command, { username }, await api.registerCheckUsername(requiredValue(username, 'username')));
  }

  if (command === 'room-history') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const tick = integerValue(positionalOrOption(options, positional, 'tick', 1), 'tick');
    const shard = positionalOrOption(options, positional, 'shard', 2);
    return withMeta(command, { room, tick, shard: shard || null }, await api.history(room, tick, shard));
  }

  if (command === 'map-stats') {
    const rooms = roomList(options.rooms || positional[0]);
    const stat = mapStatName(positionalOrOption(options, positional, 'stat', 1));
    const shard = positionalOrOption(options, positional, 'shard', 2);
    return withMeta(command, { rooms, stat, shard: shard || null }, await api.gameMapStats(rooms, stat, shard));
  }

  if (command === 'unique-object-name') {
    const type = requiredValue(positionalOrOption(options, positional, 'type', 0), 'type');
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { type, shard: shard || null }, await api.gameGenUniqueObjectName(type, shard));
  }

  if (command === 'check-object-name') {
    const type = requiredValue(positionalOrOption(options, positional, 'type', 0), 'type');
    const name = requiredValue(positionalOrOption(options, positional, 'name', 1), 'name');
    const shard = positionalOrOption(options, positional, 'shard', 2);
    return withMeta(command, { type, name, shard: shard || null }, await api.gameCheckUniqueObjectName(type, name, shard));
  }

  if (command === 'unique-flag-name') {
    const shard = positionalOrOption(options, positional, 'shard', 0);
    return withMeta(command, { shard: shard || null }, await api.gameGenUniqueFlagName(shard));
  }

  if (command === 'check-flag-name') {
    const name = requiredValue(positionalOrOption(options, positional, 'name', 0), 'name');
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { name, shard: shard || null }, await api.gameCheckUniqueFlagName(name, shard));
  }

  if (command === 'game-time') {
    const shard = positionalOrOption(options, positional, 'shard', 0);
    return withMeta(command, { shard: shard || null }, await api.gameTime(shard));
  }

  if (command === 'world-size') {
    const shard = positionalOrOption(options, positional, 'shard', 0);
    return withMeta(command, { shard: shard || null }, await api.gameWorldSize(shard));
  }

  if (command === 'room-decorations') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { room, shard: shard || null }, await api.gameRoomDecorations(room, shard));
  }

  if (command === 'room-objects') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { room, shard: shard || null }, await api.gameRoomObjects(room, shard));
  }

  if (command === 'room-status') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { room, shard: shard || null }, await api.gameRoomStatus(room, shard));
  }

  if (command === 'room-terrain') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { room, shard: shard || null }, await api.gameRoomTerrain(room, shard));
  }

  if (command === 'room-terrain-unencoded') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { room, shard: shard || null }, await api.gameRoomTerrainUnencoded(room, shard));
  }

  if (command === 'room-overview') {
    const room = roomName(positionalOrOption(options, positional, 'room', 0));
    const interval = intervalValue(positionalOrOption(options, positional, 'interval', 1), 8);
    const shard = positionalOrOption(options, positional, 'shard', 2);
    const response = await api.gameRoomOverview(room, interval, shard);
    return {
      endpoint: 'gameRoomOverview',
      room,
      shard: shard || null,
      intervalMinutes: interval,
      owner: response.owner || null,
      stats: response.stats || {},
      totals: response.totals || {},
      statsMax: response.statsMax || {}
    };
  }

  if (command === 'market-orders-index') {
    const shard = positionalOrOption(options, positional, 'shard', 0);
    return withMeta(command, { shard: shard || null }, await api.gameMarketOrdersIndex(shard));
  }
  if (command === 'market-my-orders') return withMeta(command, {}, await api.gameMarketMyOrders());

  if (command === 'market-orders') {
    const resource = marketResource(positionalOrOption(options, positional, 'resource', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { resource, shard: shard || null }, await api.gameMarketOrders(resource, shard));
  }

  if (command === 'market-stats') {
    const resource = marketResource(positionalOrOption(options, positional, 'resource', 0));
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { resource, shard: shard || null }, await api.gameMarketStats(resource, shard));
  }

  if (command === 'shards-info') return withMeta(command, {}, await api.gameShardsInfo());

  if (command === 'leaderboard-list') {
    const limit = optionalInteger(positionalOrOption(options, positional, 'limit', 0), 'limit');
    const mode = leaderboardMode(positionalOrOption(options, positional, 'mode', 1));
    const offset = optionalInteger(positionalOrOption(options, positional, 'offset', 2), 'offset');
    const season = positionalOrOption(options, positional, 'season', 3);
    return withMeta(command, { limit, mode, offset, season: season || null }, await api.leaderboardList(limit, mode, offset, season));
  }

  if (command === 'leaderboard-find') {
    const username = requiredValue(positionalOrOption(options, positional, 'username', 0), 'username');
    const mode = leaderboardMode(positionalOrOption(options, positional, 'mode', 1));
    const season = positionalOrOption(options, positional, 'season', 2);
    return withMeta(command, { username, mode, season: season || null }, await api.leaderboardFind(username, mode, season));
  }

  if (command === 'leaderboard-seasons') return withMeta(command, {}, await api.leaderboardSeasons());
  if (command === 'seasons-list') return withMeta(command, {}, await api.seasonsList());
  if (command === 'seasons-current') return withMeta(command, {}, await api.seasonsCurrent());
  if (command === 'world-start-room') return withMeta(command, { shard: options.shard || positional[0] || null }, await api.userWorldStartRoom(options.shard || positional[0]));
  if (command === 'world-status') return withMeta(command, {}, await api.userWorldStatus());
  if (command === 'branches') return withMeta(command, {}, await api.userBranches());

  if (command === 'code-get') {
    const branch = requiredValue(positionalOrOption(options, positional, 'branch', 0), 'branch');
    return withMeta(command, { branch }, await api.userCodeGet(branch));
  }

  if (command === 'decorations-inventory') return withMeta(command, {}, await api.userDecorationsInventory());
  if (command === 'decorations-themes') return withMeta(command, {}, await api.userDecorationsThemes());
  if (command === 'respawn-prohibited-rooms') return withMeta(command, {}, await api.userRespawnProhibitedRooms());

  if (command === 'memory-get') {
    const path = positionalOrOption(options, positional, 'path', 0);
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { path: path || null, shard: shard || null }, await api.userMemoryGet(path, shard));
  }

  if (command === 'memory-segment-get') {
    const segment = requiredValue(positionalOrOption(options, positional, 'segment', 0), 'segment');
    const shard = positionalOrOption(options, positional, 'shard', 1);
    return withMeta(command, { segment, shard: shard || null }, await api.userMemorySegmentGet(segment, shard));
  }

  if (command === 'messages-list') {
    const respondent = requiredValue(positionalOrOption(options, positional, 'respondent', 0), 'respondent');
    return withMeta(command, { respondent }, await api.userMessagesList(respondent));
  }

  if (command === 'messages-index') return withMeta(command, {}, await api.userMessagesIndex());
  if (command === 'messages-unread-count') return withMeta(command, {}, await api.userMessagesUnreadCount());

  if (command === 'user-find') {
    const username = requiredValue(positionalOrOption(options, positional, 'username', 0), 'username');
    return withMeta(command, { username }, await api.userFind(username));
  }

  if (command === 'user-find-by-id') {
    const id = requiredValue(positionalOrOption(options, positional, 'id', 0), 'id');
    return withMeta(command, { id }, await api.userFindById(id));
  }

  if (command === 'user-stats') {
    const id = requiredValue(positionalOrOption(options, positional, 'id', 0), 'id');
    const interval = intervalValue(positionalOrOption(options, positional, 'interval', 1));
    return withMeta(command, { id, intervalMinutes: interval }, await api.userStats(id, interval));
  }

  if (command === 'user-rooms') {
    const id = requiredValue(positionalOrOption(options, positional, 'id', 0), 'id');
    return withMeta(command, { id }, await api.userRooms(id));
  }

  if (command === 'user-overview') {
    const interval = intervalValue(positionalOrOption(options, positional, 'interval', 0));
    const stat = statName(positionalOrOption(options, positional, 'stat', 1));
    return withMeta(command, { intervalMinutes: interval, stat }, await api.userOverview(interval, stat));
  }

  if (command === 'money-history') {
    const page = optionalInteger(positionalOrOption(options, positional, 'page', 0), 'page', 0);
    return withMeta(command, { page }, await api.userMoneyHistory(page));
  }

  if (command === 'user-name') return withMeta(command, {}, await api.userName());

  if (command === 'experimental-pvp') {
    const interval = optionalInteger(positionalOrOption(options, positional, 'interval', 0), 'interval', 100);
    return withMeta(command, { interval }, await api.experimentalPvp(interval));
  }

  if (command === 'experimental-nukes') return withMeta(command, {}, await api.experimentalNukes());

  if (command === 'warpath-battles') {
    const interval = optionalInteger(positionalOrOption(options, positional, 'interval', 0), 'interval', 100);
    return withMeta(command, { interval }, await api.warpathBattles(interval));
  }

  if (command === 'scoreboard-list') {
    const offset = optionalInteger(positionalOrOption(options, positional, 'offset', 0), 'offset', 0);
    const limit = optionalInteger(positionalOrOption(options, positional, 'limit', 1), 'limit', 20);
    const search = positionalOrOption(options, positional, 'search', 2);
    return withMeta(command, { offset, limit, search: search || null }, await api.scoreboardList(offset, limit, search));
  }

  throw new Error(`Unhandled command: ${command}`);
}

function printHelp() {
  console.log('Usage: npm run api -- <command> [arguments] [options]');
  console.log('');
  console.log('Read-only commands:');
  for (const [command, description] of COMMAND_HELP) {
    console.log(`  ${command.padEnd(28)} ${description}`);
  }
  console.log('');
  console.log('Options: --room --rooms --interval --shard --path --stat --server --app --email');
  console.log('         --tick --resource --type --name --branch --id --segment');
  console.log('         --offset --limit --search --mode --season --username --respondent --page --pretty');
  console.log('');
  console.log('Use --help with the command documentation in AGENTS.md for argument order and allowed values.');
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  const result = await runCommand(command, args);
  const pretty = args.includes('--pretty');
  process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`screeps-api-cli failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  COMMAND_HELP,
  LEADERBOARD_MODES,
  MAP_STATS,
  MARKET_RESOURCES,
  READ_ONLY_COMMANDS,
  ROOM_STATS,
  VALID_INTERVALS,
  parseOptions,
  runCommand
};
