// demo-basic.js — 基础示例：认证、获取用户信息、读取 Memory
const { ScreepsHttpClient } = require('screeps-api');

async function main() {
  // 从 .screeps.yml 加载 'main' 服务器配置
  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' });

  console.log('=== 我的账户信息 ===');
  const me = await api.authMe();
  console.log('用户名:', me.username);
  console.log('GCL:', me.gcl);
  console.log('CPU:', me.cpu);
  console.log('Credits:', me.credits);

  console.log('\n=== 当前游戏时间 ===');
  const time = await api.gameTime();
  console.log('Tick:', time.time);

  console.log('\n=== Memory 根键 ===');
  try {
    const memory = await api.userMemoryGet();
    console.log('Memory keys:', Object.keys(memory));
  } catch (e) {
    console.log('Memory 读取失败 (可能是空或没有权限):', e.message);
  }
}

main().catch(err => console.error('错误:', err));
