#!/usr/bin/env node
'use strict';

// 用法: node tools/live/sample-cpu.js [sampleCount] [timeoutMs] [--target main] [--account name]

const {openClient} = require('../../src/api/client');

function parseArgs(argv) {
  const args = {target: 'main', _: []};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--target' || item === '--account') {
      const key = item.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${item}`);
      args[key] = value;
      i += 1;
      continue;
    }
    if (item.startsWith('--')) throw new Error(`未知参数：${item}`);
    args._.push(item);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sampleCount = Number(args._[0] || 3);
  const timeoutMs = Number(args._[1] || 20000);
  const api = await openClient(args.target, args.account);
  const samples = [];

  await api.socket.connect();
  let initialized = false;
  await api.socket.subscribe('cpu', event => {
    if (!initialized) {
      initialized = true;
      return;
    }

    const {cpu, memory} = event.data;
    samples.push({cpu, memory, sampledAt: Date.now()});
    if (samples.length >= sampleCount) finish(0);
  });

  const timer = setTimeout(() => finish(samples.length ? 0 : 2), timeoutMs);

  function finish(code) {
    clearTimeout(timer);
    console.log(JSON.stringify(samples));
    process.exit(code);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
