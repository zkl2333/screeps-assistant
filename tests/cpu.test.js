'use strict';

const assert = require('node:assert/strict');
const {collectCpu, summarizeCpuSamples} = require('../src/api/cpu');

assert.deepEqual(summarizeCpuSamples([], 20), {
  count: 0, avg: null, min: null, p50: null, p95: null, max: null, memoryAvg: null, memoryMax: null, overLimitCount: 0,
});

const summary = summarizeCpuSamples([
  {cpu: 10, memory: 1000},
  {cpu: 20, memory: 2000},
  {cpu: 30, memory: 3000},
  {cpu: 40, memory: 4000},
], 25);
assert.equal(summary.count, 4);
assert.equal(summary.avg, 25);
assert.equal(summary.min, 10);
assert.equal(summary.p50, 20);
assert.equal(summary.p95, 40);
assert.equal(summary.max, 40);
assert.equal(summary.headroomAvg, 0);
assert.equal(summary.overLimitCount, 2);
assert.equal(summary.memoryAvg, 2500);
assert.equal(summary.memoryMax, 4000);

(async () => {
  let disconnected = false;
  const mockApi = {
    socket: {
      async connect() {},
      async disconnect() { disconnected = true; },
      async subscribe(channel, handler) {
        assert.equal(channel, 'cpu');
        // 首条为订阅时的历史快照，应被跳过；后续两条正常采集并触发 limit=2 结束。
        handler({data: {cpu: 99, memory: 1}});
        handler({data: {cpu: 12, memory: 500}});
        handler({data: {cpu: 18, memory: 700}});
      },
    },
  };
  const res = await collectCpu({duration: 5, limit: 2}, {
    context: async () => ({api: mockApi, account: {cpu: 20}, target: 'main', shard: 'shard2'}),
  });
  assert.equal(disconnected, true);
  assert.equal(res.count, 2);
  assert.equal(res.avg, 15);
  assert.equal(res.max, 18);
  assert.equal(res.headroomAvg, 5);
  console.log('CPU 采样测试通过');
})();
