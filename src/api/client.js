'use strict';

const {ScreepsHttpClient} = require('screeps-api');

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

async function openClient(target = 'main') {
  const config = targetConfig(target);
  return ScreepsHttpClient.fromConfig(config.server, {app: config.app});
}

async function context(options = {}) {
  const resolved = resolveTarget(options);
  const api = await openClient(resolved.target);
  const account = await api.authMe();
  return {...resolved, api, account};
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

module.exports = {TARGETS, accountSummary, context, objectSummary, openClient, readSummary, resolveTarget, targetConfig};
