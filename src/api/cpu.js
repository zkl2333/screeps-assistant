'use strict';

const client = require('./client');

const DEFAULT_DURATION = 20;
const MAX_DURATION = 600;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 5000;

function parseDurationInt(value, fallback, max, name) {
  if (value === undefined) return fallback;
  let parsed = value;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)([sm]?)$/i);
    parsed = match ? (match[2].toLowerCase() === 'm' ? Number(match[1]) * 60 : Number(match[1])) : NaN;
  }
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} 必须是 1～${max} 的整数，收到：${value}`);
  }
  return parsed;
}

function parseBoundedInt(value, fallback, max, name) {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} 必须是 1～${max} 的整数，收到：${value}`);
  }
  return parsed;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** 聚合 WebSocket cpu 采样样本，计算均值、P50/P95/Max 与 Memory 占用。 */
function summarizeCpuSamples(samples = [], cpuLimit) {
  const valid = samples.filter(s => Number.isFinite(s?.cpu));
  if (!valid.length) {
    return {count: 0, avg: null, min: null, p50: null, p95: null, max: null, memoryAvg: null, memoryMax: null, overLimitCount: 0};
  }
  const cpus = valid.map(s => s.cpu).sort((a, b) => a - b);
  const mems = valid.map(s => s.memory).filter(Number.isFinite);
  const sum = cpus.reduce((a, b) => a + b, 0);
  const avg = round2(sum / cpus.length);
  const overLimitCount = Number.isFinite(cpuLimit) ? cpus.filter(v => v > cpuLimit).length : 0;
  return {
    count: valid.length,
    avg,
    min: round2(cpus[0]),
    p50: round2(percentile(cpus, 50)),
    p95: round2(percentile(cpus, 95)),
    max: round2(cpus[cpus.length - 1]),
    headroomAvg: Number.isFinite(cpuLimit) ? round2(cpuLimit - avg) : null,
    overLimitCount,
    memoryAvg: mems.length ? Math.round(mems.reduce((a, b) => a + b, 0) / mems.length) : null,
    memoryMax: mems.length ? Math.max(...mems) : null,
  };
}

/** 订阅 WebSocket cpu 频道做外部无侵入采样（0 游戏内 CPU）。 */
async function collectCpu(options = {}, deps = {}) {
  const durationSeconds = parseDurationInt(options.duration, DEFAULT_DURATION, MAX_DURATION, '--duration');
  const limit = parseBoundedInt(options.limit, DEFAULT_LIMIT, MAX_LIMIT, '--limit');
  const {api, account, target, shard} = await (deps.context || client.context)(options);
  const samples = [];
  let initialized = false;

  await api.socket.connect();
  try {
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (deps.onSignalOff) deps.onSignalOff(finish);
        resolve();
      };
      const timer = setTimeout(finish, durationSeconds * 1000);
      if (deps.onSignal) deps.onSignal(finish);

      Promise.resolve(api.socket.subscribe('cpu', event => {
        if (!initialized) {
          initialized = true;
          return;
        }
        const data = event?.data;
        if (data && Number.isFinite(data.cpu)) {
          samples.push({cpu: data.cpu, memory: data.memory, at: Date.now()});
          if (samples.length >= limit) finish();
        }
      })).catch(() => finish());
    });
  } finally {
    try { await api.socket.disconnect(); } catch {}
  }

  const cpuLimit = account?.cpu ?? null;
  return {
    target,
    shard,
    durationSeconds,
    cpuLimit,
    ...summarizeCpuSamples(samples, cpuLimit),
    samples,
  };
}

module.exports = {
  DEFAULT_DURATION,
  DEFAULT_LIMIT,
  MAX_DURATION,
  MAX_LIMIT,
  collectCpu,
  summarizeCpuSamples,
};
