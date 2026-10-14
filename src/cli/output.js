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

function parseConditions(spec) {
  return String(spec).split(',').map(item => {
    const notEqual = item.indexOf('!=');
    const equal = item.indexOf('=');
    let path;
    let value;
    let negate = false;
    if (notEqual >= 0 && (equal < 0 || notEqual < equal)) {
      path = item.slice(0, notEqual);
      value = item.slice(notEqual + 2);
      negate = true;
    } else if (equal >= 0) {
      path = item.slice(0, equal);
      value = item.slice(equal + 1);
    } else {
      throw new Error(`--filter 条件必须是 路径=值 或 路径!=值：${item}`);
    }
    if (!path || path.endsWith('.')) throw new Error(`--filter 路径无效：${item}`);
    return {path, value, negate};
  });
}

function filterCollection(value, conditions) {
  const keep = item => conditions.every(({path, value: expected, negate}) => {
    const equal = String(readPath(item, path)) === expected;
    return negate ? !equal : equal;
  });
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
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = pick(item);
  return result;
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
  if (args.filter !== undefined) {
    assertCollection(result, 'filter');
    result = filterCollection(result, parseConditions(args.filter));
  }
  if (args.fields !== undefined) {
    assertCollection(result, 'fields');
    const fields = String(args.fields).split(',').map(field => field.trim()).filter(Boolean);
    if (!fields.length) throw new Error('--fields 至少需要一个路径');
    result = pickFields(result, fields);
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

module.exports = {applyOutputOptions, consoleEnvelope, isObjectCollection, parseConditions, printResult, readPath};
