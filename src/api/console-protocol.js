'use strict';

const {randomBytes} = require('node:crypto');
const {Buffer} = require('node:buffer');

const MAX_EXPRESSION_BYTES = 1000;
const OFFICIAL_EXPRESSION_LIMIT = 1024;
const RESPONSE_PREFIX = '@@sa:';
const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'await', 'arguments', 'eval',
]);

/** 解析单条 `--arg 名=值`：值优先按 JSON 解析，解析失败则保留原字符串。 */
function parseArgEntry(spec) {
  const raw = String(spec ?? '');
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new Error(`--arg 格式必须是 名=值，收到：${raw}`);
  const name = raw.slice(0, eq).trim();
  const valueText = raw.slice(eq + 1);
  if (!IDENTIFIER_PATTERN.test(name) || RESERVED_WORDS.has(name)) {
    throw new Error(`--arg 参数名不是合法 JS 标识符：${name}`);
  }
  let value = valueText;
  if (valueText !== '') {
    try {
      value = JSON.parse(valueText);
    } catch {
      value = valueText;
    }
  }
  return [name, value];
}

/** 将 CLI 传入的 `--arg` 列表或对象整理为键值对。 */
function normalizeExpressionArgs(input) {
  if (input === undefined || input === null) return null;
  if (Array.isArray(input)) {
    if (!input.length) return null;
    const out = {};
    for (const item of input) {
      const [name, value] = parseArgEntry(item);
      out[name] = value;
    }
    return out;
  }
  if (typeof input === 'string') {
    const [name, value] = parseArgEntry(input);
    return {[name]: value};
  }
  if (typeof input === 'object') {
    const entries = Object.entries(input);
    if (!entries.length) return null;
    const out = {};
    for (const [name, value] of entries) {
      if (!IDENTIFIER_PATTERN.test(name) || RESERVED_WORDS.has(name)) {
        throw new Error(`参数名不是合法 JS 标识符：${name}`);
      }
      out[name] = value;
    }
    return out;
  }
  throw new TypeError('args 必须是字符串、字符串数组或键值对对象');
}

/** 将参数键值对注入到表达式作用域（保持多语句与 IIFE 均合法，返回值语义与直接 eval 一致）。 */
function bindExpressionArgs(code, argsInput) {
  if (typeof code !== 'string') throw new TypeError('code 必须是字符串');
  const args = normalizeExpressionArgs(argsInput);
  if (!args) return code;
  const entries = Object.entries(args);
  const names = entries.map(([name]) => name).join(',');
  const values = entries.map(([, value]) => {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'undefined' : serialized;
  }).join(',');
  return `(function(${names}){return eval(${JSON.stringify(code)})})(${values})`;
}

/** 8 位小写字母数字请求 ID，用于把 console 回包和本次发送精确匹配起来。 */
function createRequestId() {
  return randomBytes(8).toString('hex').slice(0, 8);
}

/**
 * 包装用户表达式。同 ID 重发命中 global.__sa 缓存时不再执行用户代码，
 * 100 tick 之外的缓存条目会被顺带清理。
 */
function wrapExpression(code, id) {
  if (typeof code !== 'string') throw new TypeError('code 必须是字符串');
  if (!/^[a-z0-9]{8}$/.test(id)) throw new TypeError('id 必须是 8 位小写字母数字');
  return `(function(c,n){var g=global.__sa||(global.__sa={}),t=Game.time,r,v,k;if(g[n])return g[n].r;try{v=Function('c','return eval(c)')(c);try{r='j:'+JSON.stringify(v)}catch(x){r='s:'+String(v)}}catch(e){r='e:'+(e&&e.stack||e)}r='@@sa:'+n+':'+t+':'+r;g[n]={t:t,r:r};for(k in g)if(t-g[k].t>100)delete g[k];return r})(${JSON.stringify(code)},"${id}")`;
}

function decodeHtmlEntities(text) {
  return String(text)
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** 解析包装协议回包；不是本请求 ID 的文本返回 null。 */
function parseResponse(text, id) {
  const match = typeof text === 'string' ? text.match(new RegExp(`^${RESPONSE_PREFIX}${id}:(\\d+):([jse]):([\\s\\S]*)$`)) : null;
  if (!match) return null;
  const tick = Number(match[1]);
  const kind = match[2];
  const payload = match[3];
  if (!Number.isSafeInteger(tick) || tick < 0) return null;
  if (kind === 'e') return {id, tick, kind, error: payload};
  if (kind === 's') return {id, tick, kind, value: payload};
  if (payload === 'undefined') return {id, tick, kind, value: undefined};
  try {
    return {id, tick, kind, value: JSON.parse(payload)};
  } catch {
    try {
      return {id, tick, kind, value: JSON.parse(decodeHtmlEntities(payload))};
    } catch {
      throw new Error(`console 回包 JSON 解析失败：${payload.slice(0, 300)}`);
    }
  }
}

/** 兼容用户自己 JSON.stringify 的表达式：像 JSON 的字符串自动解开。 */
function unwrapValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function jsonExpressionLength(expr) {
  return JSON.stringify(String(expr)).length;
}

function fitsOfficialConsole(expr) {
  return jsonExpressionLength(expr) <= OFFICIAL_EXPRESSION_LIMIT;
}

/** 生成从 Memory 临时键读取并执行、随后立即删除该键的引导表达式。 */
function buildRelayBootstrapExpression(memoryKey = '__sa_boot') {
  if (!/^[a-zA-Z0-9_]+$/.test(memoryKey)) {
    throw new TypeError(`非法 Memory 临时键：${memoryKey}`);
  }
  return `(function(){var s=Memory["${memoryKey}"];if(s===undefined)throw new Error("missing Memory.${memoryKey}");delete Memory["${memoryKey}"];return (0,eval)(s)})()`;
}

function formatChunkStep(bufId, index, chunk, isFinal) {
  const lit = JSON.stringify(chunk);
  if (!isFinal) {
    return `(function(g){var b=g.__sa_b||(g.__sa_b={}),a=b["${bufId}"]||(b["${bufId}"]=[]);a[${index}]=${lit};return a.length})(global)`;
  }
  return `(function(g){var b=g.__sa_b,a=b&&b["${bufId}"];if(!a)throw new Error("missing buffer ${bufId}");a[${index}]=${lit};var s=a.join("");delete b["${bufId}"];return (0,eval)(s)})(global)`;
}

/**
 * 将任意长度 JS 代码切分为多段 console 表达式，经 global.__sa_b[bufId] 拼接并在最后一段执行。
 * 保证每段经 wrapExpression 包装后仍满足官方 1024 字符上限。
 */
function buildChunkExpressions(code, {bufId = createRequestId(), maxJsonLength = OFFICIAL_EXPRESSION_LIMIT} = {}) {
  if (typeof code !== 'string' || !code.length) throw new TypeError('code 必须是非空字符串');
  if (!/^[a-zA-Z0-9_]+$/.test(bufId)) throw new TypeError(`非法缓冲区 ID：${bufId}`);

  const fits = (index, slice, isFinal) => {
    const wrapped = wrapExpression(formatChunkStep(bufId, index, slice, isFinal), 'aaaaaaaa');
    return jsonExpressionLength(wrapped) <= maxJsonLength;
  };

  // 若整段代码直接包装即可装下，无需经过缓冲区。
  if (jsonExpressionLength(wrapExpression(code, 'aaaaaaaa')) <= maxJsonLength) {
    return {bufId, expressions: [code]};
  }

  const chunks = [];
  let offset = 0;
  while (offset < code.length) {
    const index = chunks.length;
    let lo = 1;
    let hi = code.length - offset;
    // 用“按 final 模板能否装下”作为保守上界，这样最后一片无论如何都能装下。
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(index, code.slice(offset, offset + mid), true)) lo = mid;
      else hi = mid - 1;
    }
    const piece = code.slice(offset, offset + lo);
    if (!fits(index, piece, offset + lo >= code.length)) {
      throw new Error('单个字符转义后已超过 console 长度上限，无法分片');
    }
    chunks.push(piece);
    offset += lo;
  }

  const expressions = chunks.map((chunk, idx) =>
    formatChunkStep(bufId, idx, chunk, idx === chunks.length - 1));
  return {bufId, expressions};
}

function expressionBytes(expr) {
  return Buffer.byteLength(String(expr), 'utf8');
}

function assertExpressionSize(expr, {wrapped = false} = {}) {
  const size = jsonExpressionLength(expr);
  if (size <= OFFICIAL_EXPRESSION_LIMIT) return;
  const hint = wrapped
    ? '包装模式额外占用约 300 字符；常规单次 console 已支持自动中转，如在 --repeat 下使用请缩短表达式或减少双引号/换行转义。'
    : '请缩短或拆分表达式，或去掉 --raw 使用自动中转。';
  throw new Error(`表达式过长：JSON 序列化后 ${size} 字符，上限 ${OFFICIAL_EXPRESSION_LIMIT} 字符。${hint}`);
}

module.exports = {
  MAX_EXPRESSION_BYTES,
  OFFICIAL_EXPRESSION_LIMIT,
  assertExpressionSize,
  bindExpressionArgs,
  buildChunkExpressions,
  buildRelayBootstrapExpression,
  createRequestId,
  decodeHtmlEntities,
  expressionBytes,
  fitsOfficialConsole,
  jsonExpressionLength,
  normalizeExpressionArgs,
  parseArgEntry,
  parseResponse,
  unwrapValue,
  wrapExpression,
};