// 小时简报汇总脚本（只读）：输出紧凑 JSON 供 cron 分析
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');

const USER = '5dac32ae8cf7c431637c7567';
const ROOMS = ['E42N24', 'E42N26', 'E44N28', 'E41N23', 'E43N29'];

const sum = a => (a || []).reduce((s, x) => s + (x && x.value ? x.value : 0), 0);

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};

  out.gameTime = (await api.gameTime('shard2')).time;
  const me = await api.authMe();
  out.auth = { money: me.money, gcl: me.gcl, credits: me.credits, cpu: me.cpu,
    cpuShard: me.cpuShard, pixels: me.resources && me.resources.pixel };

  const ms = await api.gameMapStats(ROOMS, 'owner0', 'shard2');
  out.mapStats = {};
  for (const [r, st] of Object.entries(ms.stats || {})) {
    out.mapStats[r] = { level: st.own && st.own.level, user: st.own && st.own.user };
  }

  // 房间对象：控制器进度、storage/terminal/lab/factory、creep 统计
  out.rooms = {};
  for (const r of ROOMS) {
    const ro = await api.gameRoomObjects(r, 'shard2');
    const objs = ro.objects || [];
    const room = { objCount: objs.length };
    let controller = null, storage = null, terminal = null, factory = null;
    const labs = [], spawns = [], myCreeps = [], enemyCreeps = [], hostileStructures = [];
    for (const o of objs) {
      switch (o.type) {
        case 'controller': controller = o; break;
        case 'storage': storage = o; break;
        case 'terminal': terminal = o; break;
        case 'factory': factory = o; break;
        case 'lab': labs.push(o); break;
        case 'spawn': spawns.push(o); break;
        case 'creep':
          if (o.user === USER) myCreeps.push(o);
          else if (o.user) enemyCreeps.push(o);
          break;
        default:
          if (o.user && o.user !== USER) hostileStructures.push({ type: o.type, hits: o.hits });
      }
    }
    if (controller) room.controller = {
      level: controller.level, progress: controller.progress,
      progressTotal: controller.progressTotal, ticksToDowngrade: controller.ticksToDowngrade,
      upgradeBlocked: !!controller.upgradeBlocked };
    if (storage) room.storage = { energy: storage.store && storage.store.energy, capacity: storage.storeCapacity };
    if (terminal) room.terminal = { energy: terminal.store && terminal.store.energy, capacity: terminal.storeCapacity };
    if (factory) room.factory = {
      level: factory.level, cooldown: factory.cooldown,
      store: factory.store ? Object.fromEntries(Object.entries(factory.store).filter(([, v]) => v > 0)) : {},
      storeCapacity: factory.storeCapacity };
    room.labs = labs.map(l => ({
      mineralType: l.mineralType || null, mineralAmount: l.mineralAmount || 0,
      energy: l.energy || 0, cooldown: l.cooldown || 0, hits: l.hits, hitsMax: l.hitsMax }));
    room.spawns = spawns.map(s => ({ name: s.name, energy: s.energy, capacity: s.energyCapacity, spawning: !!s.spawning }));
    room.myCreeps = myCreeps.map(c => ({ name: c.name, body: (c.body || []).map(b => b.type).join('') }));
    room.enemyCreeps = enemyCreeps.map(c => ({ name: c.name, body: (c.body || []).map(b => b.type).join(''), x: c.x, y: c.y }));
    room.hostileStructures = hostileStructures;
    out.rooms[r] = room;
  }

  // 64 分钟房间经济（interval=8 共 8 个槽）
  out.overview = {};
  for (const r of ROOMS) {
    const ov = await api.gameRoomOverview(r, 8, 'shard2');
    const t = ov.totals || {};
    out.overview[r] = {
      energyHarvested: t.energyHarvested, energyCreeps: t.energyCreeps,
      energyConstruction: t.energyConstruction, energyControl: t.energyControl,
      creepsProduced: t.creepsProduced, creepsLost: t.creepsLost,
      lastSlot: ov.stats && ov.stats.energyHarvested ? ov.stats.energyHarvested.slice(-1)[0] : null };
  }

  // 市场账本（Memory）
  try { out.marketTrade = await api.userMemoryGet('strategy.marketTrade', 'shard2'); } catch (e) { out.marketTrade = { error: String(e.message || e) }; }

  // 活跃挂单
  try { out.myOrders = await api.gameMarketMyOrders('shard2'); } catch (e) { out.myOrders = { error: String(e.message || e) }; }

  // 近 6 页 money history（每页 10 条）
  out.moneyHistory = [];
  for (let p = 0; p < 6; p++) {
    try {
      const h = await api.userMoneyHistory(p);
      if (h && h.list) out.moneyHistory.push(...h.list);
      if (!h || !h.list || h.list.length < 10) break;
    } catch (e) { out.moneyHistory.push({ error: String(e.message || e) }); break; }
  }

  // 房间 Memory 里的 lab/factory 意图
  out.roomMemory = {};
  for (const r of ROOMS) {
    try { out.roomMemory[r] = await api.userMemoryGet('rooms.' + r, 'shard2'); } catch (e) { out.roomMemory[r] = { error: String(e.message || e) }; }
  }
  try { out.stats = await api.userMemoryGet('stats', 'shard2'); } catch (e) { out.stats = { error: String(e.message || e) }; }

  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
