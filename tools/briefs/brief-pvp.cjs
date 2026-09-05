// 只读：查 E43N29 / E44N28 的 PVP 事件细节（tombstone、enemy、creepsLost）
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');
const USER = '5dac32ae8cf7c431637c7567';

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};
  for (const r of ['E43N29', 'E44N28', 'E42N24']) {
    try {
      const ro = await api.gameRoomObjects(r, 'shard2');
      const objs = Object.values(ro.objects || {});
      const tbs = objs.filter(o => o.type === 'tombstone').map(t => ({
        name: t.name, deathTime: t.deathTime, creepName: t.creepName,
        user: t.user === USER ? 'me' : (t.user ? String(t.user).slice(0, 8) : 'npc'),
        decayTime: t.decayTime, x: t.x, y: t.y }));
      const enem = objs.filter(o => o.type === 'creep' && o.user && o.user !== USER)
        .map(c => ({ name: c.name, user: String(c.user).slice(0, 8), body: (c.body || []).map(b => b.type).join(''), x: c.x, y: c.y, hits: c.hits }));
      const sk = objs.filter(o => o.type === 'sourceKeeper').map(s => ({ x: s.x, y: s.y, hits: s.hits }));
      const myc = objs.filter(o => o.type === 'creep' && o.user === USER).length;
      const ruins = objs.filter(o => o.type === 'ruin').map(u => ({ x: u.x, y: u.y, user: u.user === USER ? 'me' : String(u.user || '').slice(0, 8) }));
      out[r] = { tombstoneCount: tbs.length, tombstones: tbs.slice(0, 10), enemyCreeps: enem, sourceKeepers: sk, myCreepCount: myc, ruins };
    } catch (e) { out[r] = 'ERR ' + String(e.message || e).slice(0, 200); }
    try {
      const ov = await api.gameRoomOverview(r, 8, 'shard2');
      out[r + '_creepsLost'] = ov.stats && ov.stats.creepsLost ? ov.stats.creepsLost.slice(-8) : null;
      out[r + '_creepsProduced'] = ov.stats && ov.stats.creepsProduced ? ov.stats.creepsProduced.slice(-8) : null;
    } catch (e) { out[r + '_ov'] = 'ERR ' + String(e.message || e).slice(0, 200); }
  }
  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
