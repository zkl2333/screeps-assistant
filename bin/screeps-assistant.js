#!/usr/bin/env node
'use strict';

const {context, objectSummary, readSummary, resolveTarget} = require('../src/api/client');
const {readWorld, scanRooms} = require('../src/map/query');
const {terrainAscii} = require('../src/map/analysis');

const BOOLEAN_FLAGS = new Set(['all', 'ascii', 'no-cache', 'summary-only']);

function parseArgs(argv) {
  const [command = 'summary', ...rest] = argv;
  const args = {command, _: []};
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('--')) {
      args._.push(rest[i]);
      continue;
    }
    const key = rest[i].slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function options(args) { return {target: args.target || 'main', shard: args.shard}; }

// Memory 接口返回 {ok, data} 信封；screeps-api 已自动解 gz:，data 只剩 JSON 字符串或已解析的对象。
function decodeMemoryValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = options(args);
  if (args.command === 'summary') {
    console.log(JSON.stringify(await readSummary(opts), null, 2));
    return;
  }
  if (args.command === 'account') {
    const {account} = await context(opts);
    console.log(JSON.stringify(account, null, 2));
    return;
  }
  if (args.command === 'rooms') {
    const {api, account, shard} = await context(opts);
    const rooms = await api.userRooms(account._id, shard);
    console.log(JSON.stringify({target: opts.target, shard, rooms: rooms?.shards?.[shard] || []}, null, 2));
    return;
  }
  if (args.command === 'room') {
    if (!args.room) throw new Error('room 命令需要 --room 房间名');
    const {api, account, shard} = await context(opts);
    const data = await api.gameRoomObjects(args.room, shard);
    console.log(JSON.stringify({target: opts.target, shard, room: args.room, summary: objectSummary(data.objects || [], account._id)}, null, 2));
    return;
  }
  if (args.command === 'memory') {
    // 路径省略时查 Memory 根。
    const path = args.path !== undefined ? args.path : (args._[0] || '');
    const {api, shard} = await context(opts);
    const res = await api.userMemoryGet(path, shard);
    console.log(JSON.stringify(decodeMemoryValue(res?.data), null, 2));
    return;
  }
  if (args.command === 'segment') {
    if (args.id === undefined) throw new Error('segment 命令需要 --id，多个 Segment 用逗号分隔');
    const {api, shard} = await context(opts);
    console.log(JSON.stringify({target: opts.target, shard, segments: await api.userMemorySegmentGet(args.id, shard)}, null, 2));
    return;
  }
  if (args.command === 'code') {
    const {api, config} = await context(opts);
    const code = await api.userCodeGet(args.branch || config.codeBranch);
    console.log(JSON.stringify({branch: code.branch, modules: Object.keys(code.modules || {})}, null, 2));
    return;
  }
  if (args.command === 'market') {
    const {api, shard} = await context(opts);
    console.log(JSON.stringify({shard, orders: await api.gameMarketMyOrders(shard)}, null, 2));
    return;
  }
  if (args.command === 'messages') {
    const {api} = await context(opts);
    console.log(JSON.stringify({unread: await api.userMessagesUnreadCount(), messages: await api.userMessagesIndex()}, null, 2));
    return;
  }
  if (args.command === 'history') {
    if (!args.room || !args.stat) throw new Error('history 命令需要 --room 房间名和 --stat 统计名');
    const {api, shard} = await context(opts);
    console.log(JSON.stringify(await api.history(args.room, args.stat, args.interval || 8, args.resource, shard), null, 2));
    return;
  }
  if (args.command === 'shards') {
    const {api} = await context(opts);
    console.log(JSON.stringify(await api.gameShardsInfo(), null, 2));
    return;
  }
  if (args.command === 'world') {
    console.log(JSON.stringify(await readWorld(opts), null, 2));
    return;
  }
  if (args.command === 'map') {
    const scan = await scanRooms({
      ...opts,
      room: args.room,
      rooms: args.rooms,
      around: args.around,
      radius: args.radius,
      all: Boolean(args.all),
      concurrency: args.concurrency,
      noCache: Boolean(args['no-cache']),
    });
    if (args.ascii) {
      for (const item of scan.results) {
        if (!item.ok) continue;
        console.log(`=== ${item.value.room} ===`);
        console.log(terrainAscii(item.value.terrainCells || []));
      }
      return;
    }
    if (args['summary-only']) {
      console.log(JSON.stringify({target: scan.target, shard: scan.shard, summary: scan.summary}, null, 2));
      return;
    }
    console.log(JSON.stringify(scan, null, 2));
    return;
  }
  resolveTarget(opts);
  throw new Error(`暂不支持命令：${args.command}`);
}

main().catch(error => { console.error(`查询失败：${error.message}`); process.exitCode = 1; });
