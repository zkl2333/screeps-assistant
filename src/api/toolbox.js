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
/**
 * auto 模式下低于此长度优先走纯 global.__sa_b 分片（2~4 次 console POST，额度 360/h），
 * 避免频繁调用限流极严的 POST /api/user/memory（超限可冷却数小时）。
 */
const AUTO_CHUNK_MAX_CHARS = 2500;
const DEFAULT_TOOLKIT_VERSION = 2;

/**
 * 通用只读辅助工具包（挂载到 global.__sa.t），不依赖任何具体 Bot 框架，不修改 Bot 自身状态。
 */
const DEFAULT_TOOLKIT_SOURCE = `(function(g){
  var sa = g.__sa || (g.__sa = {});
  sa.v = ${DEFAULT_TOOLKIT_VERSION};
  sa.q = sa.q || [];
  function sumStore(target, store){
    if (!store) return;
    for (var res in store) {
      var amt = store[res] || 0;
      if (amt > 0) target[res] = (target[res] || 0) + amt;
    }
  }
  function parseJsonSafe(raw){
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
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
    stock: function(roomName){
      var totals = {}, byRoom = {};
      for (var name in Game.rooms) {
        if (roomName && name !== roomName) continue;
        var r = Game.rooms[name];
        if (!r.controller || !r.controller.my) continue;
        var rs = {};
        if (r.storage) sumStore(rs, r.storage.store);
        if (r.terminal) sumStore(rs, r.terminal.store);
        var structs = r.find(FIND_MY_STRUCTURES);
        for (var i = 0; i < structs.length; i++) {
          var st = structs[i];
          if (st.structureType === 'lab' || st.structureType === 'factory') sumStore(rs, st.store);
        }
        sumStore(totals, rs);
        byRoom[name] = rs;
      }
      return {tick: Game.time, shard: Game.shard ? Game.shard.name : null, totals: totals, byRoom: byRoom};
    },
    labs: function(roomName){
      var r = Game.rooms[roomName];
      if (!r) return null;
      return r.find(FIND_MY_STRUCTURES, {filter: function(s){ return s.structureType === 'lab'; }}).map(function(l){
        return {
          id: l.id,
          x: l.pos.x,
          y: l.pos.y,
          mineralType: l.mineralType || null,
          mineralAmount: l.mineralType ? (l.store[l.mineralType] || 0) : 0,
          energy: l.store ? (l.store.energy || 0) : 0,
          cooldown: l.cooldown || 0
        };
      });
    },
    factory: function(roomName){
      var r = Game.rooms[roomName];
      if (!r) return null;
      var f = r.find(FIND_MY_STRUCTURES, {filter: function(s){ return s.structureType === 'factory'; }})[0];
      if (!f) return null;
      var store = {};
      sumStore(store, f.store);
      return {id: f.id, level: f.level || 0, cooldown: f.cooldown || 0, store: store};
    },
    intershard: function(shards){
      if (typeof InterShardMemory === 'undefined') return null;
      var list = shards || ['shard0', 'shard1', 'shard2', 'shard3', 'shardX'];
      var current = Game.shard ? Game.shard.name : null;
      var out = {shard: current, tick: Game.time, local: parseJsonSafe(InterShardMemory.getLocal()), remote: {}};
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (s === current) continue;
        try {
          var v = InterShardMemory.getRemote(s);
          if (v !== null && v !== undefined && v !== '') out.remote[s] = parseJsonSafe(v);
        } catch (e) {}
      }
      return out;
    },
    powerCreeps: function(){
      var out = [];
      for (var name in (Game.powerCreeps || {})) {
        var p = Game.powerCreeps[name];
        out.push({
          name: p.name,
          className: p.className,
          level: p.level,
          shard: p.shard || null,
          room: p.room ? p.room.name : null,
          ttl: p.ticksToLive || null,
          spawnCooldownTime: p.spawnCooldownTime || null,
          powers: p.powers
        });
      }
      return out;
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
 * - transport='auto'（默认）：
 *   1. 能装进单次 console 包装 → direct；
 *   2. 中长脚本（<= AUTO_CHUNK_MAX_CHARS）优先走纯 global 分片 chunk，保护限流极严的 POST /api/user/memory；
 *   3. 超长脚本（> AUTO_CHUNK_MAX_CHARS）走 memory 单次中转；若写入遇 429/错误或被 Bot 清理导致 missing Memory.* 则自动降级 chunk。
 * - transport='memory'：先用 POST /api/user/memory 写入临时键，再用 1 次 console 调用 eval 后立即删除。
 * - transport='chunk'：纯 global 分片拼接，不触碰 Memory。
 */
async function runLargeConsole(session, code, opts = {}) {
  if (!session || typeof session.run !== 'function') throw new TypeError('session 必须包含 run 方法');
  if (typeof code !== 'string' || !code.trim()) throw new TypeError('code 必须是非空字符串');
  const transport = opts.transport || 'auto';
  if (transport !== 'auto' && transport !== 'memory' && transport !== 'chunk') {
    throw new TypeError(`不支持的 transport：${transport}（可选：auto, memory, chunk）`);
  }

  // 若本身就能直接走常规包装通道，直接执行即可，省去额外请求。
  if (fitsOfficialConsole(wrapExpression(code, 'aaaaaaaa'))) {
    const res = await session.run(code, {timeoutMs: opts.timeoutMs, retries: opts.retries});
    return {...res, transport: 'direct', chunks: 1};
  }

  const runViaChunk = async () => {
    const {bufId, expressions} = buildChunkExpressions(code);
    let lastResult = null;
    for (const expr of expressions) {
      lastResult = await session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries});
    }
    return {...lastResult, transport: 'chunk', bufId, chunks: expressions.length};
  };

  if (transport === 'chunk') return runViaChunk();

  const chunkThreshold = opts.chunkThreshold ?? AUTO_CHUNK_MAX_CHARS;
  if (transport === 'auto' && code.length <= chunkThreshold) {
    return runViaChunk();
  }

  if (!session.api || typeof session.api.userMemorySet !== 'function') {
    if (transport === 'auto') return runViaChunk();
    throw new Error('memory 中转模式需要 session.api.userMemorySet 方法');
  }
  if (code.length > MAX_MEMORY_RELAY_CHARS) {
    throw new Error(`代码长度 ${code.length} 超过 /api/user/memory 上限 ${MAX_MEMORY_RELAY_CHARS}`);
  }

  const memoryKey = opts.memoryKey || `${DEFAULT_MEMORY_BOOT_KEY}_${createRequestId()}`;
  assertSafeKey(memoryKey, 'memoryKey');
  try {
    await session.api.userMemorySet(memoryKey, code, session.shard);
  } catch (error) {
    // auto 模式下 POST /api/user/memory 触发 429 或写入失败时，自动降级为纯 global chunk 分片。
    if (transport === 'auto') return runViaChunk();
    throw error;
  }
  const bootstrap = buildRelayBootstrapExpression(memoryKey);
  try {
    const res = await session.run(bootstrap, {timeoutMs: opts.timeoutMs, retries: opts.retries ?? 0});
    return {...res, transport: 'memory', chunks: 1, memoryKey};
  } catch (error) {
    if (transport === 'auto' && /missing Memory\./.test(error?.message || '')) {
      return runViaChunk();
    }
    throw error;
  }
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

/** 查询游戏内 global.__sa 临时空间与 Memory 收件箱状态（附带待消费消息 ID 与时间戳，不拉全量 Memory）。 */
async function statusToolbox(session, opts = {}) {
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  assertSafeKey(prefix, 'inbox prefix');
  const expr = `(function(g){var sa=g.__sa||{},items=[];for(var k in Memory){if(k.indexOf("${prefix}")===0){var e=Memory[k];items.push({id:e&&e.id||k.slice(${prefix.length}),ts:e&&e.ts||0});}}items.sort(function(a,b){return a.ts-b.ts;});return{tick:Game.time,version:sa.v||null,hasTools:Boolean(sa.t),tools:sa.t?Object.keys(sa.t):[],globalQueue:sa.q?sa.q.length:0,bufferKeys:g.__sa_b?Object.keys(g.__sa_b):[],memoryInbox:items.length,memoryInboxItems:items};})(global)`;
  return session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries});
}

/** 清理游戏内临时挂载的工具、队列与 Memory 中转键。 */
async function clearToolbox(session, opts = {}) {
  const prefix = opts.prefix || DEFAULT_MEMORY_INBOX_PREFIX;
  const bootKey = opts.bootKey || DEFAULT_MEMORY_BOOT_KEY;
  assertSafeKey(prefix, 'inbox prefix');
  assertSafeKey(bootKey, 'boot key');
  const expr = `(function(g){if(g.__sa){delete g.__sa.t;delete g.__sa.v;delete g.__sa.q;}delete g.__sa_b;for(var k in Memory){if(k.indexOf("${prefix}")===0||k==="${bootKey}"||k.indexOf("${bootKey}_")===0)delete Memory[k];}return{cleared:true,tick:Game.time};})(global)`;
  return session.run(expr, {timeoutMs: opts.timeoutMs, retries: opts.retries ?? 0});
}

module.exports = {
  AUTO_CHUNK_MAX_CHARS,
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
