'use strict';

const {isDeepStrictEqual} = require('node:util');

/** 官方每块回放覆盖 100 个 tick。 */
const HISTORY_CHUNK = 100;

/** 对象或数组（不含 null）。 */
const isContainer = value => value !== null && typeof value === 'object';

/** null 和缺键是同一回事：引擎的差异里 null 既表示“键被删”也表示“值变成 null”，回放分不开。 */
const isNil = value => value === undefined || value === null;

/** 前后两个值是否等价（null 与缺键等价）。 */
const isSame = (a, b) => (isNil(a) && isNil(b)) || isDeepStrictEqual(a, b);

/** tick 所在回放块的起始 tick。 */
const chunkBase = tick => Math.floor(tick / HISTORY_CHUNK) * HISTORY_CHUNK;

/** 合并同一个对象的一帧差异：只含变化的键，数组以下标为键。 */
function mergeChange(target, change) {
  for (const [key, value] of Object.entries(change)) {
    const prev = target[key];
    if (value === null) {
      // 引擎把“键被删”也写成 null，两者分不开；置 null 对显示等价。
      target[key] = null;
    } else if (isContainer(prev) && isContainer(value) && !Array.isArray(value)) {
      // 旧值和新值都是容器：新值是只列变化子键的子差异（数组的子键是下标）。
      const indexed = Array.isArray(prev);
      for (const [sub, subValue] of Object.entries(value)) prev[indexed ? Number(sub) : sub] = structuredClone(subValue);
    } else {
      target[key] = structuredClone(value);
    }
  }
}

/**
 * 把一帧差异就地应用到 state（{[id]: 对象}），格式与引擎 getDiff 一致：
 * 值为 null 表示对象消失；state 里没有这个 id 时差异就是完整的新对象；否则只含变化的键。
 * 子键被删时引擎写 undefined，JSON 序列化会丢掉，回放里看不到，所以空子差异 {} 不改任何东西。
 * 放进 state 的内容都是克隆：diff 不会被改动，也不和 state 共享引用。
 */
function applyDiff(state, diff) {
  for (const [id, change] of Object.entries(diff)) {
    if (change === null) {
      delete state[id];
    } else if (!Object.hasOwn(state, id)) {
      state[id] = structuredClone(change);
    } else {
      mergeChange(state[id], change);
    }
  }
}

/**
 * 同一个对象前后两个状态的差异（引擎同款形状）：删掉的键为 null，容器只列变化的子键，其余给新值。
 * null 与缺键视为相同：回放里键被删后留着 null，而官方快照直接没有这个键，不能因此报一条没发生过的变化。
 */
function diffObject(a, b) {
  const diff = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const before = a[key];
    const after = b[key];
    if (isSame(before, after)) continue;
    if (isNil(after)) {
      diff[key] = null;
    } else if (isContainer(before) && isContainer(after) && Array.isArray(before) === Array.isArray(after)) {
      const sub = {};
      for (const subKey of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (isSame(before[subKey], after[subKey])) continue;
        sub[subKey] = isNil(after[subKey]) ? null : after[subKey];
      }
      if (Object.keys(sub).length) diff[key] = sub;
    } else {
      diff[key] = after;
    }
  }
  return diff;
}

/**
 * 两个状态之间的差异，用于跨块那一格（块的第一帧是完整快照，不是差异）。
 * 新增对象给完整对象（引用 next 里的，调用方不能改它），消失的对象为 null，没变化的对象不出现。
 */
function diffStates(prev, next) {
  const diff = {};
  for (const id of Object.keys(prev)) {
    if (!Object.hasOwn(next, id)) diff[id] = null;
  }
  for (const [id, object] of Object.entries(next)) {
    if (!Object.hasOwn(prev, id)) {
      diff[id] = object;
      continue;
    }
    const changes = diffObject(prev[id], object);
    if (Object.keys(changes).length) diff[id] = changes;
  }
  return diff;
}

/** 变化记录里用的对象简述；值为 undefined 的键不出现。墓碑上的名字叫 creepName。 */
function describeObject(object) {
  const source = object ?? {};
  const brief = {
    type: source.type,
    structureType: source.structureType,
    name: source.name ?? source.creepName,
    user: source.user,
    x: source.x,
    y: source.y,
  };
  return Object.fromEntries(Object.entries(brief).filter(([, value]) => value !== undefined));
}

/** 块的起始 tick；防御 base 被序列化成字符串。 */
const baseOf = chunk => Number(chunk.base);

/** 官方没记录的 tick 可能是缺键，也可能是值为 null 的占位帧（实测见于块开头，推测是写入中断后补写的块）。 */
const recordedFrame = (chunk, tick) => (isNil(chunk.ticks?.[tick]) ? undefined : chunk.ticks[tick]);

/** 一块里记录到的第一个和最后一个 tick（占位的 null 帧不算）。 */
function chunkRange(chunk) {
  const ticks = Object.keys(chunk.ticks ?? {}).map(Number).filter(tick => recordedFrame(chunk, tick) !== undefined);
  return {first: Math.min(...ticks), last: Math.max(...ticks)};
}

/** 块的起始帧：每块的 base 帧是完整快照；没有就无法还原这一块。 */
function startFrame(chunk) {
  const base = baseOf(chunk);
  const frame = recordedFrame(chunk, base);
  if (frame !== undefined) return frame;
  const {first} = chunkRange(chunk);
  const hint = Number.isFinite(first) ? `；这一块从 tick ${first} 才开始有记录（官方只记录活跃房间）` : '';
  throw new Error(`回放块缺少起始帧 ${base}${hint}`);
}

/**
 * 取块内某一帧。块内的 tick 从 base 起连续，遇到第一个没记录的 tick 就断（房间不活跃时官方不记录）；
 * 缺帧不能悄悄当成“没变化”。
 */
function frameAt(chunk, tick) {
  const frame = recordedFrame(chunk, tick);
  if (frame !== undefined) return frame;
  const {first, last} = chunkRange(chunk);
  if (tick > last) throw new Error(`回放块 ${first}～${last} 只记录到 tick ${last}，tick ${tick} 之后没有记录（官方只记录活跃房间）`);
  throw new Error(`回放块 ${first}～${last} 缺少 tick ${tick} 的记录`);
}

/**
 * 从块的起始帧还原到 tick，返回新的 {[id]: 对象}（和 chunk 不共享引用，chunk 原样不变）。
 * 每块自带完整快照，所以只取一块就能还原块内任意 tick。
 */
function replayState(chunk, tick) {
  const start = startFrame(chunk);
  const {first, last} = chunkRange(chunk);
  if (tick < first || tick > last) {
    throw new Error(`回放块 ${first}～${last} 里没有 tick ${tick}（官方只记录活跃房间，遇到不活跃的 tick 就断）`);
  }
  const state = structuredClone(start);
  for (let t = baseOf(chunk) + 1; t <= tick; t += 1) applyDiff(state, frameAt(chunk, t));
  return state;
}

/**
 * tick ∈ (from, to] 内所有对象的变化记录，按 tick 升序，同一 tick 内按差异里的对象顺序。
 * chunks 要覆盖 [chunkBase(from), chunkBase(to)] 的每一块。
 * 记录：removed / added 只带简述（removed 取消失前的样子），changed 带该对象这一帧的差异 changes 和变化后的简述。
 * 跨块那一格没有差异可用，改拿上一帧状态和下一块的起始快照比出差异，之后状态直接换成官方快照。
 */
function replayChanges(chunks, from, to) {
  const byBase = new Map(chunks.map(chunk => [baseOf(chunk), chunk]));
  const startChunk = byBase.get(chunkBase(from));
  if (!startChunk) throw new Error(`缺少回放块 ${chunkBase(from)}`);
  let state = replayState(startChunk, from);
  const records = [];
  for (let tick = from + 1; tick <= to; tick += 1) {
    const base = chunkBase(tick);
    const chunk = byBase.get(base);
    if (!chunk) throw new Error(`缺少回放块 ${base}`);
    let snapshot;
    let diff;
    if (tick === base) {
      snapshot = structuredClone(startFrame(chunk));
      diff = diffStates(state, snapshot);
    } else {
      diff = frameAt(chunk, tick);
    }
    for (const [id, change] of Object.entries(diff)) {
      // 简述要在改 state 之前取：removed 用消失前的对象，added / changed 用变化后的对象。
      if (change === null) {
        records.push({tick, op: 'removed', id, ...describeObject(state[id])});
        delete state[id];
      } else if (!Object.hasOwn(state, id)) {
        records.push({tick, op: 'added', id, ...describeObject(change)});
        applyDiff(state, {[id]: change});
      } else {
        applyDiff(state, {[id]: change});
        records.push({tick, op: 'changed', id, ...describeObject(state[id]), changes: structuredClone(change)});
      }
    }
    if (snapshot) state = snapshot;
  }
  return records;
}

module.exports = {HISTORY_CHUNK, applyDiff, chunkBase, chunkRange, describeObject, diffStates, replayChanges, replayState};
