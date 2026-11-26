'use strict';

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isObjectCollection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(item => item !== null && typeof item === 'object');
}

function readPath(value, path) {
  return String(path).split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    return current[key];
  }, value);
}

const FILTER_OPS = ['!=', '^=', '*=', '>=', '<=', '>', '<', '='];

function parseConditions(spec) {
  return String(spec).split(',').map(item => {
    let op = null;
    let at = -1;
    for (const candidate of FILTER_OPS) {
      const idx = item.indexOf(candidate);
      if (idx >= 0 && (at < 0 || idx < at || (idx === at && candidate.length > op.length))) {
        at = idx;
        op = candidate;
      }
    }
    if (!op) {
      throw new Error(`--filter 条件必须是 路径=值 或 路径!=值：${item}（多值 OR 请用 | 分隔，例如 type=spawn|creep；还支持 ^= 前缀、*= 包含、< <= > >= 数值比较）`);
    }
    const path = item.slice(0, at);
    const value = item.slice(at + op.length);
    if (!path || path.endsWith('.')) throw new Error(`--filter 路径无效：${item}`);
    return {path, op, value, negate: op === '!='};
  });
}

function matchCondition(actual, {op, value}) {
  const alternatives = value.split('|');
  if (op === '=') {
    const text = String(actual);
    return alternatives.some(expected => text === expected);
  }
  if (op === '!=') {
    const text = String(actual);
    return alternatives.every(expected => text !== expected);
  }
  if (op === '^=') {
    if (actual === undefined || actual === null) return false;
    const text = String(actual);
    return alternatives.some(prefix => text.startsWith(prefix));
  }
  if (op === '*=') {
    if (actual === undefined || actual === null) return false;
    const text = String(actual).toLowerCase();
    return alternatives.some(sub => text.includes(sub.toLowerCase()));
  }
  const left = Number(actual);
  const right = Number(value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (op === '>') return left > right;
  if (op === '>=') return left >= right;
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  return false;
}

function filterCollection(value, conditions) {
  const keep = item => conditions.every(cond => matchCondition(readPath(item, cond.path), cond));
  if (Array.isArray(value)) return value.filter(keep);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (keep(item)) result[key] = item;
  }
  return result;
}

function assertCollection(value, option) {
  if (Array.isArray(value)) return;
  if (isObjectCollection(value)) return;
  throw new Error(`--${option} 只适用于数组或对象集合，当前结果是 ${typeName(value)}`);
}

function pickFields(value, fields) {
  const pick = item => {
    const result = {};
    for (const field of fields) result[field] = readPath(item, field);
    return result;
  };
  if (Array.isArray(value)) return value.map(pick);
  if (isObjectCollection(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = pick(item);
    return result;
  }
  // 普通单对象也支持按字段路径裁剪（例如 summary --fields target,shard,gameTime）。
  if (value !== null && typeof value === 'object') return pick(value);
  throw new Error(`--fields 只适用于数组或对象集合，当前结果是 ${typeName(value)}`);
}

function limitCollection(value, rawLimit) {
  const n = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit.trim()) ? Number(rawLimit.trim()) : Number(rawLimit);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit 必须是正整数，收到：${rawLimit}`);
  }
  if (Array.isArray(value)) return value.slice(0, n);
  if (isObjectCollection(value)) {
    const result = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (count >= n) break;
      result[key] = item;
      count += 1;
    }
    return result;
  }
  return value;
}

function consoleEnvelope(result, value) {
  const envelope = {shard: result.shard, id: result.id, tick: result.tick, attempts: result.attempts, value};
  if (value === undefined) {
    envelope.value = null;
    envelope.valueKind = 'undefined';
  }
  return envelope;
}

function applyOutputOptions(value, args = {}) {
  let result = value;
  if (args.pick !== undefined) {
    const spec = String(args.pick);
    if (spec.includes(',')) {
      const paths = spec.split(',').map(p => p.trim()).filter(Boolean);
      if (!paths.length) throw new Error(`--pick 路径不存在：${args.pick}`);
      const picked = {};
      let foundAny = false;
      for (const p of paths) {
        const sub = readPath(result, p);
        if (sub !== undefined) foundAny = true;
        picked[p] = sub;
      }
      if (!foundAny) throw new Error(`--pick 路径不存在：${args.pick}`);
      result = picked;
    } else {
      // 先取子路径，再对它套 --filter / --fields，例如 overview 的 --pick stats --fields total。
      result = readPath(result, spec);
      if (result === undefined) throw new Error(`--pick 路径不存在：${args.pick}`);
    }
  }
  if (args.filter !== undefined) {
    assertCollection(result, 'filter');
    result = filterCollection(result, parseConditions(args.filter));
  }
  if (args.fields !== undefined) {
    const fields = String(args.fields).split(',').map(field => field.trim()).filter(Boolean);
    if (!fields.length) throw new Error('--fields 至少需要一个路径');
    result = pickFields(result, fields);
  }
  if (args.limit !== undefined && !args.skipOutputLimit) {
    result = limitCollection(result, args.limit);
  }
  return result;
}

function printResult(value, args = {}, io = {}) {
  const write = io.write || (text => process.stdout.write(text));
  const result = applyOutputOptions(value, args);
  const json = JSON.stringify(result, null, args.compact ? 0 : 2);
  write(json === undefined ? String(result) : json);
  write('\n');
}

module.exports = {applyOutputOptions, consoleEnvelope, isObjectCollection, matchCondition, parseConditions, printResult, readPath};
