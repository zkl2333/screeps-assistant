'use strict';

const {
  buildChunkExpressions,
  buildRelayBootstrapExpression,
  createRequestId,
  fitsOfficialConsole,
  wrapExpression,
} = require('./console-protocol');

const DEFAULT_MEMORY_BOOT_KEY = '__sa_boot';
const DEFAULT_MEMORY_INBOX_PREFIX = '__sa_inbox_';
const MAX_MEMORY_RELAY_CHARS = 1024 * 1024;
const DEFAULT_TOOLKIT_VERSION = 1;

/**
 * 通用只读辅助工具包（挂载到 global.__sa.t），不依赖任何具体 Bot 框架，不修改 Bot 自身状态。
 */
const DEFAULT_TOOLKIT_SOURCE = `(function(g){
  var sa = g.__sa || (g.__sa = {});
  sa.v = ${DEFAULT_TOOLKIT_VERSION};
  sa.q = sa.q || [];
  sa.t = {
    cpu: function(){
      var h = Game.cpu.getHeapStatistics ? Game.cpu.getHeapStatistics() : null;
      return {
        tick: Game.time,
        limit: Game.cpu.limit,
        tickLimit: Game.cpu.tickLimit,
        bucket: Game.cpu.bucket,
        used: Math.round(Game.cpu.getUsed() * 1000) / 1000,
        heapUsedMB: h ? Math.round((h.used_heap_size / 1048576) * 100) / 100 : null,
        heapLimitMB: h ? Math.round((h.heap_size_limit / 1048576) * 100) / 100 : null
      };
    },
    rooms: function(){
      var out = {};
      for (var name in Game.rooms) {
        var r = Game.rooms[name];
        out[name] = {
          rcl: r.controller ? r.controller.level : 0,
          my: Boolean(r.controller && r.controller.my),
          energy: r.energyAvailable,
          energyCap: r.energyCapacityAvailable,
          storageEnergy: r.storage ? r.storage.store.energy : 0,
          terminalEnergy: r.terminal ? r.terminal.store.energy : 0,
          creeps: r.find(FIND_MY_CREEPS).length,
          hostiles: r.find(FIND_HOSTILE_CREEPS).length
        };
      }
      return out;
    },
    room: function(name){
      var r = Game.rooms[name];
      if (!r) return null;
      return {
        name: r.name,
        tick: Game.time,
        controller: r.controller ? {
          level: r.controller.level,
          my: r.controller.my,
          progress: r.controller.progress,
          progressTotal: r.controller.progressTotal,
          ticksToDowngrade: r.controller.ticksToDowngrade,
          safeMode: r.controller.safeMode || 0
        } : null,
        energy: r.energyAvailable,
        energyCap: r.energyCapacityAvailable,
        sources: r.find(FIND_SOURCES).map(function(s){ return {id: s.id, energy: s.energy, cap: s.energyCapacity}; }),
        storage: r.storage ? {energy: r.storage.store.energy, used: r.storage.store.getUsedCapacity()} : null,
        terminal: r.terminal ? {energy: r.terminal.store.energy, used: r.terminal.store.getUsedCapacity()} : null,
        spawns: r.find(FIND_MY_SPAWNS).map(function(s){ return {name: s.name, spawning: s.spawning ? s.spawning.name : null}; }),
        towers: r.find(FIND_MY_STRUCTURES, {filter: function(s){ return s.structureType === STRUCTURE_TOWER; }}).length,
        creeps: r.find(FIND_MY_CREEPS).length,
        hostiles: r.find(FIND_HOSTILE_CREEPS).length
      };
    },
    creeps: function(filter){
      var list = [];
      for (var name in Game.creeps) {
        var c = Game.creeps[name];
        if (typeof filter === 'string') {
          if (c.room.name !== filter && name.indexOf(filter) !== 0) continue;
        } else if (typeof filter === 'function' && !filter(c)) {
          continue;
        }
        list.push({
          name: c.name,
          room: c.room.name,
          ttl: c.ticksToLive,
          body: c.body.length,
          role: c.memory && c.memory.role !== undefined ? c.memory.role : null
        });
      }
      return list;
    },
    memKeys: function(){
      var sizes = {};
      for (var k in Memory) {
        try { sizes[k] = JSON.stringify(Memory[k]).length; }
        catch (e) { sizes[k] = -1; }
      }
      return sizes;
    },
    qPush: function(item){ sa.q.push({ts: Game.time, item: item}); return sa.q.length; },
    qList: function(){ return sa.q.slice(); },
    qClear: function(){ var n = sa.q.length; sa.q = []; return n; }
  };
  return {version: sa.v, tools: Object.keys(sa.t)};
})(global)`;

function assertSafeKey(key, label = 'key') {
  if (!/^[a-zA-Z0-9_]+$/.test(String(key))) {
    throw new TypeError(`非法 ${label}：${key}（只允许字母、数字和下划线）`);
  }
}

/**
 * 通过临时缓冲执行任意长度的 console 脚本。
 * - transport='memory'（默认）：先用 POST /api/user/memory 写入临时键，再用 1 次 console 调用 eval 后立即删除。
 * - transport='chunk'：纯 global 分片拼接，不触碰 Memory。
 */
async function runLargeConsole(session, code, opts = {}) {
  if (!session || typeof session.run !== 'function') throw new TypeError('session 必须包含 run 方法');
  if (typeof code !== 'string' || !code.trim()) throw new TypeError('code 必须是非空字符串');
  const transport = opts.transport || 'memory';
  if (transport !== 'memory' && transport !== 'chunk') {
    throw new TypeError(`不支持的 transport：${transport}（可选：memory, chunk）`);
  }

  // 若本身就能直接走常规包装通道，直接执行即可，省去额外请求。
  if (fitsOfficialConsole(wrapExpression(code, 'aaaaaaaa'))) {
    const res = await session.run(code, {timeoutMs: opts.timeoutMs, retries: opts.retries});
    return {...res, transport: 'direct', chunks: 1};
  }

  if (transport === 'memory') {
    if (!session.api || typeof session.api.userMemorySet !== 'function') {
      throw new Error('memory 中转模式需要 session.api.userMemorySet 方法');
    }
    if (code.length > MAX_MEMORY_RELAY_CHARS) {
      throw new Error(`代码长度 ${code.length} 超过 /api/user/memory 上限 ${MAX_MEMORY_RELAY_CHARS}`);
    }
    const memoryKey = opts.memoryKey || DEFAULT_MEMORY_BOOT_KEY;
    assertSafeKey(memoryKey, 'memoryKey');
    await session.api.userMemorySet(memoryKey, code, session.shard);
    const bootstrap = buildRelayBootstrapExpression(memoryKey);
    const res = await session.run(bootstrap, {timeoutMs: opts.timeoutMs, retries: opts.retries ?? 0});
    return {...res, transport: 'memory', chunks: 1, memoryKey};
  }

  const {bufId, expressions} = buildChunkExpressions(code);
  let lastResult = null;
  for (const expr of expressions) {
    lastResult = await session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries});
  }
  return {...lastResult, transport: 'chunk', bufId, chunks: expressions.length};
}

/** 将通用辅助工具包或自定义脚本注入到游戏内 global.__sa 临时空间。 */
async function injectToolbox(session, opts = {}) {
  const code = opts.code || DEFAULT_TOOLKIT_SOURCE;
  const result = await runLargeConsole(session, code, opts);
  return {
    injected: true,
    transport: result.transport,
    chunks: result.chunks,
    tick: result.tick,
    value: result.value,
  };
}

/** 向 Memory 临时收件箱写入一条消息（使用顶层前缀键，不依赖父对象预先存在，也不消耗 console 额度）。 */
async function pushInbox(api, shard, payload, opts = {}) {
  if (!api || typeof api.userMemorySet !== 'function') {
    throw new TypeError('api 必须包含 userMemorySet 方法');
  }
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  assertSafeKey(prefix, 'inbox prefix');
  const id = opts.id || `m_${Date.now()}_${createRequestId()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new TypeError(`非法消息 ID：${id}（只允许字母、数字、下划线和连字符）`);
  }
  const memoryKey = `${prefix}${id}`;
  const entry = {id, ts: opts.ts ?? Date.now(), payload};
  await api.userMemorySet(memoryKey, entry, shard);
  return {shard, prefix, id, path: memoryKey, entry};
}

/** 在游戏内一次性读取并清空 Memory 临时收件箱；可选传入消费函数源码。 */
async function flushInbox(session, opts = {}) {
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  assertSafeKey(prefix, 'inbox prefix');
  const handler = opts.handlerExpr ? `(${opts.handlerExpr})` : 'null';
  const expr = `(function(){var items=[];for(var k in Memory){if(k.indexOf("${prefix}")===0){items.push(Memory[k]);delete Memory[k];}}items.sort(function(a,b){return (a&&a.ts||0)-(b&&b.ts||0);});var fn=${handler};if(typeof fn==="function")return{count:items.length,result:fn(items)};return{count:items.length,items:items};})()`;
  if (fitsOfficialConsole(wrapExpression(expr, 'aaaaaaaa'))) {
    return session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries ?? 0});
  }
  return runLargeConsole(session, expr, {
    transport: opts.transport || 'memory',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries ?? 0,
  });
}

/** 查询游戏内 global.__sa 临时空间与 Memory 收件箱状态。 */
async function statusToolbox(session, opts = {}) {
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  assertSafeKey(prefix, 'inbox prefix');
  const expr = `(function(g){var sa=g.__sa||{},inbox=0;for(var k in Memory){if(k.indexOf("${prefix}")===0)inbox++;}return{tick:Game.time,version:sa.v||null,hasTools:Boolean(sa.t),tools:sa.t?Object.keys(sa.t):[],globalQueue:sa.q?sa.q.length:0,bufferKeys:g.__sa_b?Object.keys(g.__sa_b):[],memoryInbox:inbox};})(global)`;
  return session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries});
}

/** 清理游戏内临时挂载的工具、队列与 Memory 中转键。 */
async function clearToolbox(session, opts = {}) {
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  const bootKey = opts.bootKey || DEFAULT_MEMORY_BOOT_KEY;
  assertSafeKey(prefix, 'inbox prefix');
  assertSafeKey(bootKey, 'boot key');
  const expr = `(function(g){if(g.__sa){delete g.__sa.t;delete g.__sa.v;delete g.__sa.q;}delete g.__sa_b;for(var k in Memory){if(k.indexOf("${prefix}")===0)delete Memory[k];}delete Memory["${bootKey}"];return{cleared:true,tick:Game.time};})(global)`;
  return session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries ?? 0});
}

module.exports = {
  DEFAULT_MEMORY_BOOT_KEY,
  DEFAULT_MEMORY_INBOX_PREFIX,
  DEFAULT_TOOLKIT_SOURCE,
  DEFAULT_TOOLKIT_VERSION,
  MAX_MEMORY_RELAY_CHARS,
  clearToolbox,
  flushInbox,
  injectToolbox,
  pushInbox,
  runLargeConsole,
  statusToolbox,
};
