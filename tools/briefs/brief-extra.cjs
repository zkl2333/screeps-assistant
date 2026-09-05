// 只读补充查询：PVP / 核弹 / 外房归属 / creepsLost 明细
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};
  try { out.pvp = await api.experimentalPvp(3600); } catch (e) { out.pvp = 'ERR ' + String(e.message || e).slice(0, 200); }
  try { out.nukes = await api.experimentalNukes(); } catch (e) { out.nukes = 'ERR ' + String(e.message || e).slice(0, 200); }
  try { out.e48n18 = await api.gameMapStats(['E48N18'], 'owner0', 'shard2'); } catch (e) { out.e48n18 = 'ERR ' + String(e.message || e).slice(0, 200); }
  try {
    const ov = await api.gameRoomOverview('E42N24', 8, 'shard2');
    out.overviewStatsKeys = ov.stats ? Object.keys(ov.stats) : [];
    out.creepsLost = ov.stats && ov.stats.creepsLost ? ov.stats.creepsLost.slice(-8) : null;
  } catch (e) { out.overview = 'ERR ' + String(e.message || e).slice(0, 200); }
  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
