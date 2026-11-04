'use strict';

const client = require('./client');
const {accountSummary, objectSummary, readSummary} = client;

function decodeMemoryValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function getAccount(options = {}) {
  const {target, shard, account} = await client.context(options);
  return {target, shard, account: accountSummary(account)};
}

async function listShards(options = {}) {
  const {api} = await client.context(options);
  return await api.gameShardsInfo();
}

async function listRooms(options = {}) {
  const {api, account, target, shard} = await client.context(options);
  const rooms = await api.userRooms(account._id, shard);
  return {target, shard, rooms: rooms?.shards?.[shard] || []};
}

async function getRoom(options = {}) {
  if (!options.room) throw new Error('room 查询需要 room');
  const {api, account, target, shard} = await client.context(options);
  const data = await api.gameRoomObjects(options.room, shard);
  return {target, shard, room: options.room, summary: objectSummary(data.objects || [], account._id)};
}

async function getMemory(options = {}) {
  if (options.path === undefined || options.path === '') throw new Error('memory 查询需要非空 path，避免无意读取整个 Memory');
  const {api, target, shard} = await client.context(options);
  const result = await api.userMemoryGet(options.path, shard);
  return {target, shard, path: options.path, value: decodeMemoryValue(result?.data)};
}

async function getSegment(options = {}) {
  if (options.id === undefined || options.id === '') throw new Error('segment 查询需要 id');
  const {api, target, shard} = await client.context(options);
  return {target, shard, segments: await api.userMemorySegmentGet(options.id, shard)};
}

function getStatus(options = {}) {
  const {target, config, shard} = client.resolveTarget(options);
  try {
    client.resolveServerConfig(target, options.account);
    return {ok: true, target, shard, app: config.app, account: options.account || 'default'};
  } catch {
    return {ok: false, target, shard, app: config.app, account: options.account || 'default', hint: '检查 screeps-assistant 根目录的 .screeps.yml 及目标账号配置'};
  }
}

module.exports = {decodeMemoryValue, getAccount, getMemory, getRoom, getSegment, getStatus, listRooms, listShards, readSummary};
