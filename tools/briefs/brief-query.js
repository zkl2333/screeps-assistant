// 小时简报只读查询脚本：输出 JSON 供后续分析
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};
  out.authMe = await api.authMe();
  out.userRooms = await api.userRooms('5dac32ae8cf7c431637c7567');
  out.mapStats = await api.gameMapStats(['E42N24','E42N26','E44N28','E41N23','E43N29'], 'owner0', 'shard2');
  const rooms = ['E42N24','E42N26','E44N28','E41N23','E43N29'];
  out.overview = {};
  for (const r of rooms) {
    try { out.overview[r] = await api.gameRoomOverview(r, 8, 'shard2'); }
    catch (e) { out.overview[r] = { error: String(e.message || e) }; }
  }
  out.myOrders = await api.gameMarketMyOrders('shard2');
  out.moneyHistory = await api.userMoneyHistory(0);
  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
