'use strict';

const {randomBytes} = require('node:crypto');
const {Buffer} = require('node:buffer');

const MAX_EXPRESSION_BYTES = 1000;
const OFFICIAL_EXPRESSION_LIMIT = 1024;
const RESPONSE_PREFIX = '@@sa:';

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
  const size = expressionBytes(expr);
  if (size <= MAX_EXPRESSION_BYTES) return;
  const hint = wrapped
    ? '包装模式额外占用约 300 字节；如表达式本身必须接近 1000 字节，可用 --raw 换回，或用 --relay 经临时缓冲执行；包装后双引号会被转义，尽量使用单引号。'
    : '请缩短或拆分表达式，或改用 --relay 经临时缓冲执行。';
  throw new Error(`表达式过长：实际 ${size} 字节，上限 ${MAX_EXPRESSION_BYTES} 字节。${hint}`);
}

module.exports = {
  MAX_EXPRESSION_BYTES,
  OFFICIAL_EXPRESSION_LIMIT,
  assertExpressionSize,
  buildChunkExpressions,
  buildRelayBootstrapExpression,
  createRequestId,
  decodeHtmlEntities,
  expressionBytes,
  fitsOfficialConsole,
  jsonExpressionLength,
  parseResponse,
  unwrapValue,
  wrapExpression,
};