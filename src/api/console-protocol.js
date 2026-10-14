'use strict';

const {randomBytes} = require('node:crypto');
const {Buffer} = require('node:buffer');

const MAX_EXPRESSION_BYTES = 1000;
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

function expressionBytes(expr) {
  return Buffer.byteLength(String(expr), 'utf8');
}

function assertExpressionSize(expr, {wrapped = false} = {}) {
  const size = expressionBytes(expr);
  if (size <= MAX_EXPRESSION_BYTES) return;
  const hint = wrapped
    ? '包装模式额外占用约 300 字节；如表达式本身必须接近 1000 字节，可用 --raw 换回，或缩短/拆分表达式；包装后双引号会被转义，尽量使用单引号。'
    : '请缩短或拆分表达式；如已使用 --raw，可改用包装模式前先减少表达式长度。';
  throw new Error(`表达式过长：实际 ${size} 字节，上限 ${MAX_EXPRESSION_BYTES} 字节。${hint}`);
}

module.exports = {
  MAX_EXPRESSION_BYTES,
  assertExpressionSize,
  createRequestId,
  expressionBytes,
  parseResponse,
  unwrapValue,
  wrapExpression,
};