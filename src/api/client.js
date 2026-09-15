'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('yaml');
const {ScreepsConfigManager, ScreepsHttpClient} = require('screeps-api');

const CONFIG_FILE = path.join(__dirname, '..', '..', '.screeps.yml');

const TARGETS = Object.freeze({
  main: Object.freeze({server: 'main', app: 'default', shards: ['shard0', 'shard1', 'shard2', 'shard3', 'shardX'], defaultShard: 'shard2', codeBranch: 'main'}),
  season: Object.freeze({server: 'season', app: 'season11', shards: ['shardSeason'], defaultShard: 'shardSeason', codeBranch: 'default'}),
});

function targetConfig(target = 'main') {
  const config = TARGETS[target];
  if (!config) throw new Error(`不支持目标：${target}。可选：${Object.keys(TARGETS).join(', ')}`);
  return config;
}

function resolveTarget({target = 'main', shard} = {}) {
  const config = targetConfig(target);
  const resolvedShard = shard || config.defaultShard;
  if (!config.shards.includes(resolvedShard)) throw new Error(`${target} 不支持分片 ${resolvedShard}。可选：${config.shards.join(', ')}`);
  return {target, config, shard: resolvedShard};
}

/** 读取并解析本地 .screeps.yml；不存在时报错提示。 */
function loadRawConfig(file = CONFIG_FILE) {
  if (!fs.existsSync(file)) throw new Error(`找不到配置文件：${file}`);
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !parsed.servers) throw new Error(`配置缺少 servers 对象：${file}`);
  return parsed;
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
 *         yachiyo: { token: "..." }  # --account yachiyo 时使用
 *
 * account 省略 → 用服务器块自身的 token；给出 → 用 accounts[account].token。
 */
function resolveServerConfig(target, account, file = CONFIG_FILE) {
  const parsed = loadRawConfig(file);
  const serverBlock = parsed.servers[targetConfig(target).server];
  if (!serverBlock) {
    const defined = Object.keys(parsed.servers).join(', ');
    throw new Error(`配置里找不到服务器 "${targetConfig(target).server}"；已定义：${defined}`);
  }

  // 浅拷贝，避免污染原始配置；账号 token 覆盖默认 token。
  const merged = {...serverBlock};
  delete merged.accounts;
  const serverName = targetConfig(target).server;
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
  return {server: manager.normalizeServerConfig(merged), app: {name: targetConfig(target).app}};
}

async function openClient(target = 'main', account) {
  const config = resolveServerConfig(target, account);
  return new ScreepsHttpClient(config);
}

async function context(options = {}) {
  const resolved = resolveTarget(options);
  const api = await openClient(resolved.target, options.account);
  const account = await api.authMe();
  return {...resolved, accountAlias: options.account || null, api, account};
}

function accountSummary(account) {
  return {id: account?._id, username: account?.username, cpu: account?.cpu, gcl: account?.gcl, money: account?.money, credits: account?.credits, pixels: account?.resources?.pixel};
}

function objectSummary(objects, userId) {
  const owned = objects.filter(item => item.user === userId);
  const count = type => owned.filter(item => item.type === type).length;
  const controller = objects.find(item => item.type === 'controller');
  const storage = owned.find(item => item.type === 'storage');
  const terminal = owned.find(item => item.type === 'terminal');
  const creeps = objects.filter(item => item.type === 'creep');
  return {
    rcl: controller?.level,
    controller: controller ? {x: controller.x, y: controller.y, owner: controller.user, reservation: controller.reservation} : null,
    spawns: count('spawn'),
    spawning: owned.filter(item => item.type === 'spawn' && item.spawning).map(item => item.spawning.name),
    storageEnergy: storage?.store?.energy,
    terminalEnergy: terminal?.store?.energy,
    towers: count('tower'),
    labs: count('lab'),
    factories: count('factory'),
    constructionSites: objects.filter(item => item.type === 'constructionSite' && item.user === userId).length,
    portals: objects.filter(item => item.type === 'portal').map(item => ({x: item.x, y: item.y, destination: item.destination})),
    ownCreeps: creeps.filter(item => item.user === userId).map(item => ({name: item.name, x: item.x, y: item.y, role: item.role, squadName: item.squadName, body: item.body?.map(part => part.type || part)})),
    hostileCreeps: creeps.filter(item => item.user !== userId && item.user != null).map(item => ({name: item.name, user: item.user, x: item.x, y: item.y, body: item.body?.map(part => part.type || part)})),
  };
}

async function readSummary(options = {}) {
  const {target, config, shard, api, account} = await context(options);
  const [time, rooms, shards, code] = await Promise.all([api.gameTime(shard), api.userRooms(account._id, shard), api.gameShardsInfo(), api.userCodeGet(config.codeBranch)]);
  return {target, server: config.server, app: config.app, shard, codeBranch: config.codeBranch, account: accountSummary(account), gameTime: time?.time, rooms: rooms?.shards?.[shard] || [], shardInfo: shards?.shards?.find(item => item.name === shard) || null, codeModules: Object.keys(code?.modules || {})};
}

module.exports = {TARGETS, accountSummary, context, objectSummary, openClient, readSummary, resolveServerConfig, resolveTarget, targetConfig};
