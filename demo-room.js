// demo-room.js — 房间相关 API 示例
//
// 用法: node demo-room.js [roomName] [shard]
// 示例: node demo-room.js E42N24 shard2
const { ScreepsHttpClient } = require('screeps-api');

async function main() {
  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' });
  const roomName = process.argv[2] || 'E1N8';
  const shard = process.argv[3]; // 缺省使用 .screeps.yml 的 configs.default.defaultShard

  // 房间统计
  console.log(`=== 房间 ${roomName} 统计 (1h) ===`);
  const overview = await api.gameRoomOverview(roomName, 8, shard);
  if (overview.owner) {
    console.log('所有者:', overview.owner.username);
  }
  console.log('统计:', JSON.stringify(overview.stats, null, 2));

  // 房间状态
  console.log(`\n=== 房间状态 ===`);
  const status = await api.gameRoomStatus(roomName, shard);
  console.log('状态:', status.status);
  if (status.novice) {
    console.log('新手保护到期:', new Date(status.novice).toISOString());
  }
}

main().catch(err => console.error('错误:', err));
