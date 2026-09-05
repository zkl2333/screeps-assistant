// 小时简报第二轮：房间对象 + 内存账本（只读）
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};
  out.gameTime = await api.gameTime('shard2');
  const rooms = ['E42N24', 'E42N26', 'E44N28', 'E41N23', 'E43N29'];
  out.roomObjects = {};
  for (const r of rooms) {
    try { out.roomObjects[r] = await api.gameRoomObjects(r, 'shard2'); }
    catch (e) { out.roomObjects[r] = { error: String(e.message || e) }; }
  }
  try { out.marketTrade = await api.userMemoryGet('strategy.marketTrade', 'shard2'); }
  catch (e) { out.marketTrade = { error: String(e.message || e) }; }
  out.roomMemory = {};
  for (const r of rooms) {
    try { out.roomMemory[r] = await api.userMemoryGet('rooms.' + r, 'shard2'); }
    catch (e) { out.roomMemory[r] = { error: String(e.message || e) }; }
  }
  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
