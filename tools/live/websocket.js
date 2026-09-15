// websocket.js — WebSocket 实时订阅工具（只读）
// 用法: node tools/live/websocket.js [--target main] [--account name]

'use strict';

const {openClient} = require('../../src/api/client');

function parseArgs(argv) {
  const args = {target: 'main'};
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
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const api = await openClient(args.target, args.account);

  await api.socket.connect();
  console.log(`WebSocket 已连接 (target=${args.target}${args.account ? `, account=${args.account}` : ''})`);

  api.socket.on('auth', event => {
    console.log('认证状态:', event.data.status);
  });

  api.socket.subscribe('cpu', event => {
    const {cpu, memory} = event.data;
    console.log(`[CPU] tick:${event.data.gameTime || '?'} cpu:${cpu} memory:${Math.round(memory / 1024)}KB`);
  });

  // 订阅控制台输出（只读观察，不向 Console 写入）
  api.socket.subscribe('console', event => {
    const {messages} = event.data;
    if (messages) {
      if (messages.log && messages.log.length) {
        messages.log.forEach(l => console.log(`[LOG] ${l}`));
      }
      if (messages.results && messages.results.length) {
        messages.results.forEach(r => console.log(`[RESULT] ${r}`));
      }
    }
  });

  console.log('监控运行中，60 秒后退出...');
  setTimeout(() => {
    console.log('退出');
    process.exit(0);
  }, 60000);
}

main().catch(err => console.error('错误:', err.message || err));
