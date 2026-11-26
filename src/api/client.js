'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('yaml');
const {ScreepsConfigManager, ScreepsHttpClient} = require('screeps-api');

const CONFIG_FILE = path.join(__dirname, '..', '..', '.screeps.yml');
const AUTH_CACHE_FILE = path.join(__dirname, '..', '..', '.cache', 'auth-me.json');
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const memoryAuthCache = new Map();

const OFFICIAL_SHARDS = Object.freeze(['shard0', 'shard1', 'shard2', 'shard3', 'shardX']);

/** 内置目标默认值；.screeps.yml 的同名服务器块可用 shards / defaultShard / codeBranch 覆盖。 */
const TARGETS = Object.freeze({
  main: Object.freeze({server: 'main', app: 'default', shards: OFFICIAL_SHARDS, defaultShard: 'shard2', codeBranch: 'main'}),
  // PTR 实测只有 shard0～shard3、没有 shardX（2026-11-05 gameShardsInfo）；bot 往 PTR 部署的也是 main 分支。
  ptr: Object.freeze({server: 'ptr', app: 'ptr', shards: Object.freeze(['shard0', 'shard1', 'shard2', 'shard3']), defaultShard: 'shard2', codeBranch: 'main'}),
  season: Object.freeze({server: 'season', app: 'season', shards: Object.freeze(['shardSeason']), defaultShard: 'shardSeason', codeBranch: 'default'}),
  pserver: Object.freeze({server: 'pserver', app: 'pserver', shards: Object.freeze(['shard0']), defaultShard: 'shard0', codeBranch: 'default'}),
});

/** 读取并解析本地 .screeps.yml；不存在时报错提示。 */
function loadRawConfig(file = CONFIG_FILE) {
  if (!fs.existsSync(file)) throw new Error(`找不到配置文件：${file}`);
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !parsed.servers) throw new Error(`配置缺少 servers 对象：${file}`);
  return parsed;
}

/** 配置文件不存在时返回 null，内置目标照常解析，缺凭据的报错留给连接阶段。 */
function readServerBlocks(file = CONFIG_FILE) {
  if (!fs.existsSync(file)) return null;
  return loadRawConfig(file).servers;
}

function mergeTargetConfig(target, builtin, block = {}) {
  const server = builtin?.server || target;
  const where = `.screeps.yml 的 servers.${server}`;
  if (block.shards !== undefined && !(Array.isArray(block.shards) && block.shards.length && block.shards.every(name => typeof name === 'string' && name))) {
    throw new Error(`${where}.shards 必须是非空的分片名数组`);
  }
  for (const key of ['defaultShard', 'codeBranch']) {
    if (block[key] !== undefined && !(typeof block[key] === 'string' && block[key])) throw new Error(`${where}.${key} 必须是非空字符串`);
  }
  const shards = block.shards || builtin?.shards || (block.defaultShard ? [block.defaultShard] : ['shard0']);
  const defaultShard = block.defaultShard || (shards.includes(builtin?.defaultShard) ? builtin.defaultShard : shards[0]);
  if (!shards.includes(defaultShard)) throw new Error(`${where}.defaultShard "${defaultShard}" 不在分片列表里：${shards.join(', ')}`);
  return Object.freeze({
    server,
    app: builtin?.app || target,
    shards: Object.freeze([...shards]),
    defaultShard,
    codeBranch: block.codeBranch || builtin?.codeBranch || 'default',
  });
}

/** 目标 = 内置默认值 + .screeps.yml 同名服务器块的覆盖；yml 里新增的服务器块也能直接当目标用。 */
function targetConfig(target = 'main', file = CONFIG_FILE) {
  const builtin = TARGETS[target];
  const servers = readServerBlocks(file);
  const block = servers?.[builtin?.server || target];
  if (!builtin && !block) {
    const names = [...new Set([...Object.keys(TARGETS), ...Object.keys(servers || {})])];
    throw new Error(`不支持目标：${target}。可选：${names.join(', ')}`);
  }
  return mergeTargetConfig(target, builtin, block || {});
}

function resolveTarget({target = 'main', shard} = {}, file = CONFIG_FILE) {
  const config = targetConfig(target, file);
  const resolvedShard = shard || config.defaultShard;
  if (!config.shards.includes(resolvedShard)) throw new Error(`${target} 不支持分片 ${resolvedShard}。可选：${config.shards.join(', ')}`);
  return {target, config, shard: resolvedShard};
}

/** 解析单个或多个分片：支持 `allShards: true`、`shard: 'all'` 或逗号分隔 `shard2,shard3,shardX`。 */
function resolveShards({target = 'main', shard, allShards} = {}, file = CONFIG_FILE) {
  const config = targetConfig(target, file);
  if (allShards || shard === 'all') {
    return {target, config, shards: [...config.shards]};
  }
  if (!shard) {
    return {target, config, shards: [config.defaultShard]};
  }
  const parts = String(shard).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return {target, config, shards: [config.defaultShard]};
  const unique = [];
  for (const name of parts) {
    if (!config.shards.includes(name)) {
      throw new Error(`${target} 不支持分片 ${name}。可选：${config.shards.join(', ')}`);
    }
    if (!unique.includes(name)) unique.push(name);
  }
  return {target, config, shards: unique};
}

/**
 * 从配置中解析某个服务器下的某个账号，返回 {server, app} 供构造 client。
 * 结构：账号嵌套在服务器下的 accounts 里；服务器块自身的 token 是该服务器默认账号。
 *
 *   servers:
 *     main:
 *       url: https://screeps.com/
 *       token: "默认账号token"        # 不带 --account 时使用
 *       accounts:
 *         alt: { token: "..." }  # --account alt 时使用
 *
 * account 省略 → 用服务器块自身的 token；给出 → 用 accounts[account].token。
 */
function resolveServerConfig(target, account, file = CONFIG_FILE) {
  const parsed = loadRawConfig(file);
  const config = targetConfig(target, file);
  const serverName = config.server;
  const serverBlock = parsed.servers[serverName];
  if (!serverBlock) {
    const defined = Object.keys(parsed.servers).join(', ');
    throw new Error(`配置里找不到服务器 "${serverName}"；已定义：${defined}`);
  }

  // 浅拷贝，避免污染原始配置；账号 token 覆盖默认 token。
  const merged = {...serverBlock};
  delete merged.accounts;
  const definedAccounts = Object.keys(serverBlock.accounts || {});
  if (account) {
    const accountBlock = serverBlock.accounts?.[account];
    if (!accountBlock || !accountBlock.token) {
      throw new Error(`服务器 "${serverName}" 下找不到账号 "${account}"；已定义账号：${definedAccounts.join(', ') || '(无)'}`);
    }
    Object.assign(merged, accountBlock);
  } else if (!merged.token && !(merged.email && merged.password)) {
    // 未选 --account 且服务器块没有默认凭证时，给出可操作提示，避免落到 screeps-api 的泛化错误。
    const hint = definedAccounts.length
      ? `请在服务器块设置 token，或用 --account 选择：${definedAccounts.join(', ')}`
      : '请在服务器块设置 token，或在 accounts 下添加账号后再用 --account 选择';
    throw new Error(`服务器 "${serverName}" 未配置默认账号 token；${hint}`);
  }

  const manager = new ScreepsConfigManager();
  return {server: manager.normalizeServerConfig(merged), app: {name: config.app}};
}

async function openClient(target = 'main', account) {
  const config = resolveServerConfig(target, account);
  const api = new ScreepsHttpClient(config);
  // 私服账密配置：构造函数不会自动登录，显式走一遍 signin 换取会话 token。
  if (!config.server.token && config.server.email && config.server.password) {
    await api.auth(new Error(`无法登录 ${config.server.url}，请检查 email/password 配置`));
  }
  return api;
}

function sanitizeCachedAccount(account) {
  if (!account || !account._id) return null;
  return {
    _id: account._id,
    username: account.username,
    cpu: account.cpu,
    gcl: account.gcl,
    money: account.money,
    credits: account.credits,
    cpuShard: account.cpuShard,
    resources: account.resources,
  };
}

function readDiskAuthCache(cacheKey, now = Date.now()) {
  const memHit = memoryAuthCache.get(cacheKey);
  if (memHit && now - memHit.at < AUTH_CACHE_TTL_MS) return memHit.account;
  try {
    if (!fs.existsSync(AUTH_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, 'utf8'));
    const entry = raw?.[cacheKey];
    if (entry && entry.account && now - Number(entry.at) < AUTH_CACHE_TTL_MS) {
      memoryAuthCache.set(cacheKey, entry);
      return entry.account;
    }
  } catch {
    // 缓存不可读时静默回退实时接口
  }
  return null;
}

function writeDiskAuthCache(cacheKey, account, now = Date.now()) {
  const clean = sanitizeCachedAccount(account);
  if (!clean) return;
  const entry = {at: now, account: clean};
  memoryAuthCache.set(cacheKey, entry);
  try {
    fs.mkdirSync(path.dirname(AUTH_CACHE_FILE), {recursive: true});
    let store = {};
    if (fs.existsSync(AUTH_CACHE_FILE)) {
      try {
        store = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, 'utf8')) || {};
      } catch {
        store = {};
      }
    }
    store[cacheKey] = entry;
    fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // 缓存不可写时不阻塞正常查询
  }
}

async function context(options = {}) {
  const resolved = resolveTarget(options);
  const api = await openClient(resolved.target, options.account);
  const useCache = !options.freshAccount && process.env.SCREEPS_ASSISTANT_NO_AUTH_CACHE !== '1';
  const cacheKey = `${resolved.config.server}:${options.account || 'default'}`;
  let account = useCache ? readDiskAuthCache(cacheKey) : null;
  if (!account) {
    account = await api.authMe();
    writeDiskAuthCache(cacheKey, account);
  }
  return {...resolved, accountAlias: options.account || null, api, account};
}

// GCL 升级公式常量来自官方引擎同源包（github.com/screeps/common），随依赖更新，不自行维护。
// 等级 = floor((gcl/GCL_MULTIPLY)^(1/GCL_POW)) + 1。
const {GCL_MULTIPLY, GCL_POW} = require('@screeps/common/lib/constants');

/**
 * 把累计 GCL 经验解析为等级阶梯：当前等级、本级起点、升下一级所需总量与累计门槛。
 * 服务器只返回累计经验（如 13163017），阶梯数量由公式推导，无需硬编码整张表。
 */
function gclProgress(gcl) {
  const total = Number(gcl);
  if (!Number.isFinite(total) || total < 0) return null;
  const level = Math.floor(Math.pow(total / GCL_MULTIPLY, 1 / GCL_POW)) + 1;
  const base = Math.pow(level - 1, GCL_POW) * GCL_MULTIPLY;
  const next = Math.pow(level, GCL_POW) * GCL_MULTIPLY;
  return {level, progress: total - base, progressTotal: next - base, nextAt: next};
}

function accountSummary(account) {
  return {id: account?._id, username: account?.username, cpu: account?.cpu, gcl: account?.gcl, gclProgress: gclProgress(account?.gcl), money: account?.money, credits: account?.credits, pixels: account?.resources?.pixel};
}

function nonEmptyStore(store) {
  if (!store || typeof store !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(store)) {
    if (Number(v) > 0) out[k] = v;
  }
  return out;
}

/**
 * 房间对象摘要。
 *
 * 结构计数字段语义（易误读，务必注意）：
 * - towers / spawns / labs / factories：房间内该类型建筑总数（含敌方），用于房间情报；
 * - ownTowers / ownSpawns / ownLabs / ownFactories：仅当前账号拥有的数量；
 * - storageEnergy / terminalEnergy / spawning / constructionSites：仍为己方专用。
 */
function objectSummary(objects, userId, {users = {}, gameTime} = {}) {
  const owned = objects.filter(item => item.user === userId);
  const countAll = type => objects.filter(item => item.type === type).length;
  const countOwn = type => owned.filter(item => item.type === type).length;
  const controller = objects.find(item => item.type === 'controller');
  const storage = owned.find(item => item.type === 'storage');
  const terminal = owned.find(item => item.type === 'terminal');
  const factory = owned.find(item => item.type === 'factory');
  const nuker = owned.find(item => item.type === 'nuker');
  const ownLabsList = owned.filter(item => item.type === 'lab');
  const creeps = objects.filter(item => item.type === 'creep');
  const ttlOf = item => (item.ageTime != null && gameTime != null ? item.ageTime - gameTime : undefined);
  const usernameOf = id => (id == null ? undefined : users[id]?.username);

  const energyStructures = objects.filter(item => item.type === 'spawn' || item.type === 'extension');
  const energyAvailable = energyStructures.reduce((sum, item) => sum + (item.store?.energy ?? item.energy ?? 0), 0);
  const energyCapacityAvailable = energyStructures.reduce((sum, item) => sum + (item.storeCapacityResource?.energy ?? item.energyCapacity ?? 0), 0);

  const structures = {};
  for (const item of objects) {
    if (item.hits === undefined && item.hitsMax === undefined) continue;
    if (item.type === 'creep' || item.type === 'powerCreep') continue;
    const entry = structures[item.type] || (structures[item.type] = {count: 0, minHits: null, totalHits: 0, totalMaxHits: 0});
    entry.count += 1;
    const hits = item.hits ?? 0;
    const maxHits = item.hitsMax ?? 0;
    entry.minHits = entry.minHits === null ? hits : Math.min(entry.minHits, hits);
    entry.totalHits += hits;
    entry.totalMaxHits += maxHits;
  }

  const sources = objects.filter(item => item.type === 'source').map(item => ({
    id: item._id,
    x: item.x,
    y: item.y,
    energy: item.energy,
    energyCapacity: item.energyCapacity,
  }));
  const mineralObj = objects.find(item => item.type === 'mineral');
  const mineral = mineralObj ? {type: mineralObj.mineralType, amount: mineralObj.mineralAmount} : null;

  const spawningDetails = owned
    .filter(item => item.type === 'spawn' && item.spawning)
    .map(item => ({
      spawn: item.name,
      name: item.spawning.name,
      needTime: item.spawning.needTime,
      remainingTime: item.spawning.spawnTime != null && gameTime != null ? Math.max(0, item.spawning.spawnTime - gameTime) : undefined,
    }));

  const labDetails = ownLabsList.map(l => {
    const store = nonEmptyStore(l.store) || {};
    const mineralType = Object.keys(store).find(k => k !== 'energy') || l.mineralType || null;
    const mineralAmount = mineralType ? (store[mineralType] ?? l.mineralAmount ?? 0) : 0;
    return {
      id: l._id,
      x: l.x,
      y: l.y,
      mineralType,
      mineralAmount,
      energy: store.energy ?? l.energy ?? 0,
      cooldown: l.cooldownTime != null && gameTime != null ? Math.max(0, l.cooldownTime - gameTime) : (l.cooldown ?? 0),
    };
  });

  const factoryDetails = factory ? {
    id: factory._id,
    level: factory.level ?? 0,
    cooldown: factory.cooldownTime != null && gameTime != null ? Math.max(0, factory.cooldownTime - gameTime) : (factory.cooldown ?? 0),
    store: nonEmptyStore(factory.store) || {},
  } : null;

  const nukerDetails = nuker ? {
    energy: nuker.store?.energy ?? nuker.energy ?? 0,
    G: nuker.store?.G ?? nuker.ghodium ?? 0,
    cooldown: nuker.cooldownTime != null && gameTime != null ? Math.max(0, nuker.cooldownTime - gameTime) : undefined,
  } : null;

  return {
    rcl: controller?.level,
    controller: controller ? {
      x: controller.x,
      y: controller.y,
      owner: controller.user,
      ownerName: usernameOf(controller.user),
      reservation: controller.reservation
        ? {...controller.reservation, username: usernameOf(controller.reservation.user)}
        : undefined,
      ticksToDowngrade: controller.downgradeTime != null && gameTime != null ? controller.downgradeTime - gameTime : undefined,
      safeMode: controller.safeMode != null && gameTime != null ? Math.max(0, controller.safeMode - gameTime) : undefined,
      safeModeAvailable: controller.safeModeAvailable,
    } : null,
    energyAvailable,
    energyCapacityAvailable,
    spawns: countAll('spawn'),
    ownSpawns: countOwn('spawn'),
    spawning: owned.filter(item => item.type === 'spawn' && item.spawning).map(item => item.spawning.name),
    spawningDetails,
    storageEnergy: storage?.store?.energy,
    storageStore: nonEmptyStore(storage?.store),
    terminalEnergy: terminal?.store?.energy,
    terminalStore: nonEmptyStore(terminal?.store),
    towers: countAll('tower'),
    ownTowers: countOwn('tower'),
    labs: countAll('lab'),
    ownLabs: countOwn('lab'),
    labDetails,
    factories: countAll('factory'),
    ownFactories: countOwn('factory'),
    factoryDetails,
    nuker: nukerDetails,
    constructionSites: objects.filter(item => item.type === 'constructionSite' && item.user === userId).length,
    sources,
    mineral,
    structures,
    portals: objects.filter(item => item.type === 'portal').map(item => ({x: item.x, y: item.y, destination: item.destination})),
    ownCreeps: creeps.filter(item => item.user === userId).map(item => ({
      name: item.name,
      x: item.x,
      y: item.y,
      hits: item.hits,
      hitsMax: item.hitsMax,
      ttl: ttlOf(item),
      body: item.body?.map(part => part.type || part),
    })),
    hostileCreeps: creeps.filter(item => item.user !== userId && item.user != null).map(item => ({
      name: item.name,
      user: item.user,
      username: usernameOf(item.user),
      x: item.x,
      y: item.y,
      hits: item.hits,
      hitsMax: item.hitsMax,
      ttl: ttlOf(item),
      body: item.body?.map(part => part.type || part),
    })),
  };
}

async function readSummary(options = {}) {
  const {target, config, shard, api, account} = await context({...options, freshAccount: true});
  // 代码分支可用命令表里的 branch 覆盖（查小号的 default 分支时用）；codeBranch 是旧调用方的写法，一并认。
  const codeBranch = options.branch || options.codeBranch || config.codeBranch;
  const [time, rooms, shards, code] = await Promise.all([api.gameTime(shard), api.userRooms(account._id, shard), api.gameShardsInfo(), api.userCodeGet(codeBranch)]);
  return {target, server: config.server, app: config.app, shard, codeBranch, account: accountSummary(account), gameTime: time?.time, rooms: rooms?.shards?.[shard] || [], shardInfo: shards?.shards?.find(item => item.name === shard) || null, codeModules: Object.keys(code?.modules || {})};
}

module.exports = {TARGETS, accountSummary, context, gclProgress, objectSummary, openClient, readSummary, resolveServerConfig, resolveShards, resolveTarget, targetConfig};
