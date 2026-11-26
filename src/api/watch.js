'use strict';

const {spawn} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const {context} = require('./client');
const {isErrorEntry, stripHtml} = require('./logs');
const {applyDiff} = require('./replay');
const {matchCondition, parseConditions, readPath} = require('../cli/output');

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 7200;
const DEFAULT_LOW_HP_RATIO = 0.5;

const ROOM_EVENT_TYPES = Object.freeze([
  'creep-enter',
  'creep-leave',
  'creep-die',
  'hostile-enter',
  'hostile-cleared',
  'structure-destroyed',
  'damage',
  'low-hp',
  'nuke',
  'controller',
]);

const DEFAULT_ROOM_EVENTS = Object.freeze([
  'creep-enter',
  'creep-die',
  'hostile-enter',
  'hostile-cleared',
  'structure-destroyed',
  'nuke',
]);

const NON_STRUCTURE_TYPES = new Set([
  'creep', 'powerCreep', 'source', 'mineral', 'deposit', 'energy', 'resource',
  'tombstone', 'ruin', 'constructionSite', 'nuke', 'flag',
]);

const HOSTILE_DEFENSE_TYPES = new Set(['spawn', 'tower']);

/** 解析时长：支持纯秒数，或带 s/m/h 后缀（如 30s、15m、1h）。 */
function parseDurationSeconds(value, {fallback, min = 1, max = MAX_TIMEOUT_SECONDS, name = '--timeout'} = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  let parsed = value;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)([smh]?)$/i);
    if (!match) parsed = NaN;
    else {
      const n = Number(match[1]);
      const unit = match[2].toLowerCase();
      parsed = unit === 'h' ? n * 3600 : (unit === 'm' ? n * 60 : n);
    }
  }
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} 必须是 ${min}～${max} 秒的整数（支持 s/m/h 后缀），收到：${value}`);
  }
  return parsed;
}

function splitCsv(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(v => splitCsv(v));
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function parseRoomEvents(onSpec) {
  const list = splitCsv(onSpec);
  if (!list.length) return new Set(DEFAULT_ROOM_EVENTS);
  const valid = new Set(ROOM_EVENT_TYPES);
  for (const name of list) {
    if (name === 'all') return new Set(ROOM_EVENT_TYPES);
    if (!valid.has(name)) {
      throw new Error(`未知房间事件类型：${name}。可选：${ROOM_EVENT_TYPES.join(', ')}, all`);
    }
  }
  return new Set(list);
}

/** 支持在 --match 中用 `|` 把多个 OR 分支写在一起（如 `name^=Assault_|type=spawn|type=tower`）或用 `,` 表示 AND。 */
function parseMatchSpec(spec) {
  if (spec === undefined || spec === null || spec === '') return null;
  const text = String(spec).trim();
  if (!text) return null;
  // 若包含跨字段 OR（形如 `a=1|b=2`，右侧也有操作符），拆成多组 AND 条件，组间 OR。
  const hasOp = part => /!=|\^=|\*=|>=|<=|[=><]/.test(part);
  const groups = [];
  let current = '';
  for (const token of text.split('|')) {
    if (current && hasOp(token)) {
      groups.push(parseConditions(current));
      current = token;
    } else {
      current = current ? `${current}|${token}` : token;
    }
  }
  if (current) groups.push(parseConditions(current));
  return groups;
}

function matchesEvent(event, matchGroups) {
  if (!matchGroups || !matchGroups.length) return true;
  return matchGroups.some(andGroup =>
    andGroup.every(cond => matchCondition(readPath(event, cond.path), cond)));
}

function parseMemoryJson(raw) {
  if (raw === 'undefined' || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isHostileObject(obj, userId) {
  return Boolean(obj && obj.user && obj.user !== userId);
}

function isStructureObject(obj) {
  return Boolean(obj && obj.type && !NON_STRUCTURE_TYPES.has(obj.type));
}

function countHostiles(state, userId) {
  let creeps = 0;
  let defenseStructures = 0;
  for (const obj of Object.values(state)) {
    if (!isHostileObject(obj, userId)) continue;
    if (obj.type === 'creep' || obj.type === 'powerCreep') creeps += 1;
    else if (HOSTILE_DEFENSE_TYPES.has(obj.type)) defenseStructures += 1;
  }
  return {creeps, defenseStructures, total: creeps + defenseStructures};
}

function ownerTag(obj, userId) {
  if (!obj || !obj.user) return 'neutral';
  return obj.user === userId ? 'own' : 'hostile';
}

/**
 * 房间实时状态差分引擎（纯函数状态机，便于离线测试）。
 * 接收 RoomEventData（首帧完整快照 + 后续逐 tick 增量对象），输出标准化语义事件列表。
 */
function createRoomWatcher({room, shard, userId, events, checkInitial = false, hpBelow}) {
  const wanted = events instanceof Set ? events : parseRoomEvents(events);
  const hpThreshold = hpBelow !== undefined && hpBelow !== null && hpBelow !== '' ? Number(hpBelow) : DEFAULT_LOW_HP_RATIO;
  let state = null;
  let prevHostiles = null;
  const alertedLowHp = new Set();

  function makeEvent(kind, tick, obj, extra = {}) {
    const ev = {
      source: 'room',
      event: kind,
      shard,
      room,
      tick: tick ?? null,
    };
    if (obj) {
      ev.id = obj._id;
      ev.type = obj.type;
      ev.owner = ownerTag(obj, userId);
      if (obj.user) ev.user = obj.user;
      if (obj.name || obj.creepName) ev.name = obj.name || obj.creepName;
      if (obj.x !== undefined) ev.x = obj.x;
      if (obj.y !== undefined) ev.y = obj.y;
      if (obj.hits !== undefined) ev.hits = obj.hits;
      if (obj.hitsMax !== undefined) ev.hitsMax = obj.hitsMax;
    }
    return {...ev, ...extra};
  }

  function isLowHp(obj) {
    if (!obj || typeof obj.hits !== 'number' || typeof obj.hitsMax !== 'number' || obj.hitsMax <= 0) return false;
    if (hpThreshold > 1) return obj.hits <= hpThreshold;
    return (obj.hits / obj.hitsMax) <= hpThreshold;
  }

  return function onRoomData(data) {
    const diff = data?.objects;
    if (!diff || typeof diff !== 'object') return [];
    const tick = data.gameTime ?? null;
    const emitted = [];

    if (state === null) {
      state = {};
      for (const [id, obj] of Object.entries(diff)) {
        if (obj && typeof obj === 'object') {
          state[id] = structuredClone({_id: id, ...obj});
        }
      }
      prevHostiles = countHostiles(state, userId);
      if (checkInitial) {
        for (const obj of Object.values(state)) {
          if (obj.type === 'creep') {
            if (wanted.has('creep-enter')) emitted.push(makeEvent('creep-enter', tick, obj, {initial: true}));
            if (wanted.has('hostile-enter') && isHostileObject(obj, userId)) {
              emitted.push(makeEvent('hostile-enter', tick, obj, {initial: true}));
            }
          }
          if (wanted.has('nuke') && obj.type === 'nuke') {
            emitted.push(makeEvent('nuke', tick, obj, {initial: true, landTime: obj.landTime, launchRoomName: obj.launchRoomName}));
          }
          if (wanted.has('low-hp') && isLowHp(obj)) {
            alertedLowHp.add(obj._id);
            emitted.push(makeEvent('low-hp', tick, obj, {initial: true}));
          }
        }
        if (wanted.has('hostile-cleared') && prevHostiles.total === 0) {
          emitted.push(makeEvent('hostile-cleared', tick, null, {initial: true}));
        }
      }
      return emitted;
    }

    // 收集本 tick 新出现的墓碑，用于准确判断消失的 creep 是阵亡还是跨房离开。
    const newTombstoneNames = new Set();
    for (const [id, change] of Object.entries(diff)) {
      if (change && !Object.hasOwn(state, id) && change.type === 'tombstone' && change.creepName) {
        newTombstoneNames.add(change.creepName);
      }
    }

    for (const [id, change] of Object.entries(diff)) {
      const prev = state[id];
      if (change === null) {
        if (!prev) continue;
        alertedLowHp.delete(id);
        if (prev.type === 'creep') {
          const died = prev.name && newTombstoneNames.has(prev.name);
          if (wanted.has('creep-die') && died) {
            emitted.push(makeEvent('creep-die', tick, prev, {reason: 'tombstone'}));
          } else if (wanted.has('creep-leave')) {
            emitted.push(makeEvent('creep-leave', tick, prev));
          }
        } else if (isStructureObject(prev) && wanted.has('structure-destroyed')) {
          emitted.push(makeEvent('structure-destroyed', tick, prev));
        }
        delete state[id];
        continue;
      }

      if (!prev) {
        const added = structuredClone({_id: id, ...change});
        state[id] = added;
        if (added.type === 'creep') {
          if (wanted.has('creep-enter')) emitted.push(makeEvent('creep-enter', tick, added));
          if (wanted.has('hostile-enter') && isHostileObject(added, userId)) {
            emitted.push(makeEvent('hostile-enter', tick, added));
          }
        } else if (added.type === 'tombstone' && wanted.has('creep-die')) {
          // 如果 creep 消失在前一帧、墓碑晚一帧出现，补发一条 creep-die。
          if (!emitted.some(e => e.event === 'creep-die' && e.name && e.name === added.creepName)) {
            emitted.push(makeEvent('creep-die', tick, added, {reason: 'tombstone', deathTime: added.deathTime}));
          }
        } else if (added.type === 'nuke' && wanted.has('nuke')) {
          emitted.push(makeEvent('nuke', tick, added, {landTime: added.landTime, launchRoomName: added.launchRoomName}));
        } else if (added.type === 'ruin' && wanted.has('structure-destroyed')) {
          const structType = added.structure?.type || added.structure?.structureType;
          if (!emitted.some(e => e.event === 'structure-destroyed' && e.x === added.x && e.y === added.y)) {
            emitted.push(makeEvent('structure-destroyed', tick, added, {structureType: structType}));
          }
        }
        continue;
      }

      const prevHits = prev.hits;
      const prevLevel = prev.level;
      const prevUser = prev.user;
      const prevSafeMode = prev.safeMode;
      const prevReservation = prev.reservation;

      applyDiff(state, {[id]: change});
      const next = state[id];

      if (wanted.has('damage') && typeof prevHits === 'number' && typeof next.hits === 'number' && next.hits < prevHits) {
        emitted.push(makeEvent('damage', tick, next, {prevHits, delta: next.hits - prevHits}));
      }
      if (wanted.has('low-hp') && isLowHp(next) && !alertedLowHp.has(id)) {
        alertedLowHp.add(id);
        emitted.push(makeEvent('low-hp', tick, next));
      } else if (alertedLowHp.has(id) && !isLowHp(next)) {
        alertedLowHp.delete(id);
      }
      if (wanted.has('controller') && next.type === 'controller') {
        const changed = {};
        if (next.level !== prevLevel) changed.level = {from: prevLevel, to: next.level};
        if (next.user !== prevUser) changed.user = {from: prevUser, to: next.user};
        if (next.safeMode !== prevSafeMode) changed.safeMode = {from: prevSafeMode, to: next.safeMode};
        if (!isDeepStrictEqual(next.reservation, prevReservation)) changed.reservation = next.reservation;
        if (Object.keys(changed).length) {
          emitted.push(makeEvent('controller', tick, next, {changes: changed}));
        }
      }
    }

    const nextHostiles = countHostiles(state, userId);
    if (wanted.has('hostile-cleared') && prevHostiles.total > 0 && nextHostiles.total === 0) {
      emitted.push(makeEvent('hostile-cleared', tick, null, {prevHostiles}));
    }
    prevHostiles = nextHostiles;
    return emitted;
  };
}

/**
 * Memory 路径变化检测器（纯函数状态机）。
 */
function createMemoryWatcher({path: memPath, shard, until, checkInitial = false}) {
  const untilGroups = parseMatchSpec(until);
  let initialized = false;
  let prevValue;

  const matchesUntil = value => {
    if (!untilGroups) return true;
    const envelope = value && typeof value === 'object' ? {...value, value} : {value};
    return matchesEvent(envelope, untilGroups);
  };

  return function onMemoryRaw(rawData) {
    const nextValue = parseMemoryJson(rawData);
    if (!initialized) {
      initialized = true;
      prevValue = nextValue;
      if (checkInitial && untilGroups && matchesUntil(nextValue)) {
        return [{
          source: 'memory',
          event: 'memory-match',
          shard,
          path: memPath,
          initial: true,
          value: nextValue,
        }];
      }
      return [];
    }
    if (isDeepStrictEqual(prevValue, nextValue)) return [];
    const oldVal = prevValue;
    prevValue = nextValue;
    if (untilGroups && !matchesUntil(nextValue)) return [];
    return [{
      source: 'memory',
      event: untilGroups ? 'memory-match' : 'memory-change',
      shard,
      path: memPath,
      prev: oldVal,
      value: nextValue,
    }];
  };
}

/** 执行外部回调命令（仅 CLI `--exec` 启用，事件 JSON 经 stdin 和环境变量传入）。 */
function runEventCallback(command, event, log = message => console.error(message)) {
  const payload = JSON.stringify(event);
  const child = spawn(command, {
    shell: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    env: {...process.env, SCREEPS_WATCH_EVENT: payload},
  });
  let errText = '';
  child.stderr?.on('data', chunk => { errText += String(chunk); });
  child.on('error', err => log(`--exec 启动失败：${err.message}`));
  child.on('close', code => {
    if (code !== 0) log(`--exec 退出码 ${code}${errText ? `：${errText.trim().slice(0, 200)}` : ''}`);
  });
  child.stdin?.end(payload);
}

function cooldownKeyOf(event) {
  return [event.source, event.event, event.shard || '', event.room || event.path || '', event.id || event.name || ''].join(':');
}

/**
 * 实时事件订阅与唤醒引擎（全走 WebSocket，0 轮询、0 console 额度）。
 * 支持组合订阅：room / memory / console / code / messages / cpuAbove。
 */
async function watchEvents(options = {}, deps = {}) {
  const rooms = splitCsv(options.room);
  const memoryPaths = splitCsv(options.memory);
  const watchConsole = Boolean(options.console || options.errors || (options.grep !== undefined && options.grep !== ''));
  const watchCode = Boolean(options.code);
  const watchMessages = Boolean(options.messages);
  const cpuAbove = options.cpuAbove !== undefined && options.cpuAbove !== '' ? Number(options.cpuAbove) : undefined;
  if (cpuAbove !== undefined && (!Number.isFinite(cpuAbove) || cpuAbove < 0)) {
    throw new Error(`--cpu-above 必须是非负数，收到：${options.cpuAbove}`);
  }
  if (!rooms.length && !memoryPaths.length && !watchConsole && !watchCode && !watchMessages && cpuAbove === undefined) {
    throw new Error('watch 至少需要指定一种订阅源：--room、--memory、--console（或 --errors/--grep）、--code、--messages 或 --cpu-above');
  }

  const maxTimeout = deps.timeoutMax ?? MAX_TIMEOUT_SECONDS;
  const timeoutSec = parseDurationSeconds(options.timeout, {
    fallback: Math.min(DEFAULT_TIMEOUT_SECONDS, maxTimeout),
    min: 1,
    max: maxTimeout,
    name: '--timeout',
  });
  const cooldownSec = parseDurationSeconds(options.cooldown, {
    fallback: 0,
    min: 0,
    max: 3600,
    name: '--cooldown',
  });
  const stream = Boolean(options.stream);
  const rawCount = options.count;
  let targetCount = stream ? Infinity : 1;
  if (rawCount !== undefined && rawCount !== '') {
    const n = Number(rawCount);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      throw new Error(`--count 必须是 1～10000 的整数，收到：${rawCount}`);
    }
    targetCount = n;
  }

  const roomEvents = parseRoomEvents(options.on);
  const matchGroups = parseMatchSpec(options.match);
  const grepLower = options.grep !== undefined && options.grep !== '' ? String(options.grep).toLowerCase() : undefined;
  const checkInitial = Boolean(options.checkInitial);
  const allShards = Boolean(options.allShards);
  const execCmd = options.exec;

  const resolveContext = deps.context || context;
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const log = deps.log || (message => console.error(message));
  const onEvent = deps.onEvent;
  const signal = deps.signal;

  const {api, account, target, shard} = await resolveContext(options);
  const socket = api.socket;
  const userId = account?._id;
  socket.on?.('error', () => {});
  socket.off?.('error', console.error);
  await socket.connect();

  const startedAt = now();
  const collected = [];
  const lastFired = new Map();
  let ended = false;
  let reason = 'timeout';
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });

  const finish = why => {
    if (ended) return;
    ended = true;
    reason = why;
    resolveDone();
  };

  const emitEvent = rawEv => {
    if (ended) return;
    if (!matchesEvent(rawEv, matchGroups)) return;
    const tNow = now();
    if (cooldownSec > 0) {
      const key = cooldownKeyOf(rawEv);
      const prev = lastFired.get(key);
      if (prev !== undefined && tNow - prev < cooldownSec * 1000) return;
      lastFired.set(key, tNow);
    }
    const event = {at: new Date(tNow).toISOString(), ...rawEv};
    collected.push(event);
    if (onEvent) onEvent(event);
    if (execCmd) runEventCallback(execCmd, event, log);
    if (collected.length >= targetCount) finish('matched');
  };

  const subscriptions = [];
  let timer;
  const onAbort = () => finish('abort');
  const stopWaiting = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    signal?.removeEventListener('abort', onAbort);
  };

  try {
    // 1. 房间订阅
    for (const room of rooms) {
      const watcher = createRoomWatcher({room, shard, userId, events: roomEvents, checkInitial, hpBelow: options.hpBelow});
      const cb = event => {
        for (const ev of watcher(event?.data)) emitEvent(ev);
      };
      if (typeof socket.subscribeRoom === 'function') {
        await socket.subscribeRoom(room, shard, cb);
        subscriptions.push(() => socket.unsubscribeRoom?.(room, shard, cb));
      } else {
        const spec = `room:${shard}/${room}`;
        await socket.subscribe(spec, cb);
        subscriptions.push(() => socket.unsubscribe?.(spec, cb));
      }
    }

    // 2. Memory 路径订阅
    for (const memPath of memoryPaths) {
      const watcher = createMemoryWatcher({path: memPath, shard, until: options.until, checkInitial});
      const cb = event => {
        for (const ev of watcher(event?.data)) emitEvent(ev);
      };
      if (typeof socket.subscribeUserMemory === 'function') {
        await socket.subscribeUserMemory(memPath, shard, cb);
        subscriptions.push(() => socket.unsubscribeUserMemory?.(memPath, shard, cb));
      } else {
        const spec = `memory/${shard}/${memPath}`;
        await socket.subscribe(spec, cb);
        subscriptions.push(() => socket.unsubscribe?.(spec, cb));
      }
    }

    // 3. Console 日志与报错订阅
    if (watchConsole) {
      const cb = event => {
        const data = event?.data;
        if (!data) return;
        const evShard = data.shard ?? shard;
        if (!allShards && data.shard !== undefined && data.shard !== shard) return;
        const lines = [];
        for (const l of data.messages?.log || []) {
          if (typeof l !== 'string') continue;
          const text = stripHtml(l);
          if (text) lines.push({text, error: false});
        }
        if (data.error !== undefined && data.error !== null) {
          const text = stripHtml(String(data.error));
          if (text) lines.push({text, error: true});
        }
        for (const item of lines) {
          const entry = {shard: evShard, text: item.text, ...(item.error ? {error: true} : {})};
          if (options.errors && !isErrorEntry(entry)) continue;
          if (grepLower !== undefined && !item.text.toLowerCase().includes(grepLower)) continue;
          emitEvent({
            source: 'console',
            event: isErrorEntry(entry) ? 'console-error' : 'console-log',
            shard: evShard,
            text: item.text,
            ...(item.error ? {error: true} : {}),
          });
        }
      };
      await socket.subscribe('console', cb);
      subscriptions.push(() => socket.unsubscribe?.('console', cb));
    }

    // 4. 代码更新订阅（CI 部署落地瞬间唤醒）
    if (watchCode) {
      const cb = event => {
        const data = event?.data;
        if (!data) return;
        emitEvent({
          source: 'code',
          event: 'code-updated',
          branch: data.branch || null,
          timestamp: data.timestamp || null,
          hash: data.hash ?? null,
          modules: Object.keys(data.modules || {}),
        });
      };
      if (typeof socket.subscribeUserCode === 'function') {
        await socket.subscribeUserCode(cb);
        subscriptions.push(() => socket.unsubscribeUserCode?.(cb));
      } else {
        await socket.subscribe('code', cb);
        subscriptions.push(() => socket.unsubscribe?.('code', cb));
      }
    }

    // 5. 游戏内私信到达订阅
    if (watchMessages) {
      const cb = event => {
        const data = event?.data;
        if (!data) return;
        emitEvent({
          source: 'messages',
          event: 'new-message',
          data,
        });
      };
      await socket.subscribe('newMessage', cb);
      subscriptions.push(() => socket.unsubscribe?.('newMessage', cb));
    }

    // 6. CPU 阈值订阅
    if (cpuAbove !== undefined) {
      let initialized = false;
      const cb = event => {
        if (!initialized) {
          initialized = true;
          return;
        }
        const data = event?.data;
        if (!data || !Number.isFinite(data.cpu)) return;
        if (data.cpu >= cpuAbove) {
          emitEvent({
            source: 'cpu',
            event: 'cpu-high',
            shard,
            cpu: data.cpu,
            memory: data.memory ?? null,
            threshold: cpuAbove,
          });
        }
      };
      await socket.subscribe('cpu', cb);
      subscriptions.push(() => socket.unsubscribe?.('cpu', cb));
    }

    if (!ended) {
      timer = setTimer(() => finish('timeout'), timeoutSec * 1000);
      if (signal?.aborted) finish('abort');
      else signal?.addEventListener('abort', onAbort, {once: true});
      await done;
    }
  } finally {
    ended = true;
    stopWaiting();
    for (const unsub of subscriptions) {
      try { await unsub(); } catch {}
    }
    try { socket.disconnect?.(); } catch {}
  }

  const elapsedSec = Math.round((now() - startedAt) / 100) / 10;
  return {
    triggered: collected.length > 0,
    reason,
    target,
    shard,
    elapsedSec,
    count: collected.length,
    events: collected,
  };
}

module.exports = {
  DEFAULT_LOW_HP_RATIO,
  DEFAULT_ROOM_EVENTS,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  ROOM_EVENT_TYPES,
  createMemoryWatcher,
  createRoomWatcher,
  matchesEvent,
  parseDurationSeconds,
  parseMatchSpec,
  parseRoomEvents,
  watchEvents,
};
