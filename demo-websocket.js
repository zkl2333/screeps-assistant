// demo-websocket.js — WebSocket 实时监控示例
const { ScreepsHttpClient } = require('screeps-api');

async function main() {
  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' });

  // 连接 WebSocket
  await api.socket.connect();
  console.log('WebSocket 已连接');

  api.socket.on('auth', (event) => {
    console.log('认证状态:', event.data.status);
  });

  // 订阅 CPU
  api.socket.subscribe('cpu', (event) => {
    const { cpu, memory } = event.data;
    console.log(`[CPU] tick:${event.data.gameTime || '?'} cpu:${cpu} memory:${Math.round(memory / 1024)}KB`);
  });

  // 订阅控制台输出
  api.socket.subscribe('console', (event) => {
    const { messages } = event.data;
    if (messages) {
      if (messages.log && messages.log.length) {
        messages.log.forEach(l => console.log(`[LOG] ${l}`));
      }
      if (messages.results && messages.results.length) {
        messages.results.forEach(r => console.log(`[RESULT] ${r}`));
      }
    }
  });

  // 运行 60 秒
  console.log('监控运行中，60 秒后退出...');
  setTimeout(() => {
    console.log('退出');
    process.exit(0);
  }, 60000);
}

main().catch(err => console.error('错误:', err));
