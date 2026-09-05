// 简报分析：从两份查询 JSON 提取紧凑关键事实（只读本地）
const fs = require('fs');
const dir = '/opt/data/workspace/screeps-assistant/scripts/';
const s = JSON.parse(fs.readFileSync(dir + '.brief-new-summary.json', 'utf8'));
const s2 = JSON.parse(fs.readFileSync(dir + '.brief-new-summary2.json', 'utf8'));

const USER = '5dac32ae8cf7c431637c7567';
const ROOMS = ['E42N24', 'E42N26', 'E44N28', 'E41N23', 'E43N29'];

const fmt = n => (n === undefined || n === null) ? 'null' : n.toLocaleString('en-US');
const sum = a => (a || []).reduce((x, v) => x + (v && v.value ? v.value : 0), 0);

// 1. tick / GCL
console.log('== 全局 ==');
console.log('tick:', s.gameTime, '| GCL:', s.auth && s.auth.gcl, '| money(authMe.money):', s.auth && s.auth.money,
  '| credits:', s.auth && s.auth.credits, '| cpu:', s.auth && s.auth.cpu, '| cpuShard:', s.auth && s.auth.cpuShard,
  '| pixels:', s.auth && s.auth.pixels);
console.log('mapStats:', JSON.stringify(s.mapStats));

// 2/3. rooms: controller + storage/terminal + spawns + creeps + hostile
for (const r of ROOMS) {
  const rm = s.rooms && s.rooms[r];
  if (!rm) { console.log(r, ': 无数据'); continue; }
  const c = rm.controller || {};
  const st = rm.storage || {};
  const te = rm.terminal || {};
  const ov = (s.overview && s.overview[r]) || {};
  const mine = (rm.myCreeps || []).map(x => x.name).filter(n => /^HM_/.test(n));
  const plain = (rm.myCreeps || []).map(x => x.name).filter(n => !/^HM_/.test(n));
  console.log(`== ${r} ==`);
  console.log('RCL:', c.level, '| progress:', fmt(c.progress), '/', fmt(c.progressTotal),
    '| downgrade:', c.ticksToDowngrade, '| upgradeBlocked:', !!c.upgradeBlocked);
  console.log('storageE:', fmt(st.energy), '/', st.capacity, '| terminalE:', fmt(te.energy), '/', te.capacity);
  const fx = rm.factory || {};
  console.log('factory:', fx.level !== undefined ? 'L' + fx.level + ' cd=' + fx.cooldown + ' store=' + JSON.stringify(fx.store || {}) : '无');
  console.log('labs:', (rm.labs || []).map(l => `${l.mineralType||'-'}:${l.mineralAmount}`).join(' '), '| cd:', (rm.labs||[]).map(l=>l.cooldown).join(','));
  console.log('spawns:', (rm.spawns || []).map(sp => `${sp.name.split(' ')[0]}[${sp.energy}/${sp.capacity}${sp.spawning?'*':''}]`).join(' '));
  console.log('myCreeps:', (rm.myCreeps || []).length, 'HM:', mine.length, '非HM:', plain.length,
    '| enemyCreeps:', JSON.stringify((rm.enemyCreeps || []).map(e => ({ n: e.name, b: e.body, x: e.x, y: e.y }))),
    '| hostileStruct:', JSON.stringify(rm.hostileStructures));
  console.log('overview:', JSON.stringify(ov));
}

// 4. roomMemory intents (lab/factory)
console.log('== 房间内存意图 ==');
for (const r of ROOMS) {
  const m = (s.roomMemory && s.roomMemory[r]) || {};
  if (m.error) { console.log(r, 'memory error:', m.error); continue; }
  const lf = m.lab || m.labs || m.factory || {};
  // 挑 lab 配方相关字段
  const keys = Object.keys(m).filter(k => /lab|factory|boost|reaction|mineral|terminal|trade/i.test(k));
  console.log(r, 'keys:', keys.join(','));
  if (m.lab) console.log(r, 'lab:', JSON.stringify(m.lab));
  if (m.factory) console.log(r, 'factory:', JSON.stringify(m.factory));
}

// 5. market ledger
console.log('== 市场账本 ==');
const mt = s.marketTrade || {};
if (mt.error) console.log('marketTrade error:', mt.error);
else {
  console.log('marketTrade keys:', Object.keys(mt).join(','));
  for (const k of ['netMarketProfit', 'cashflow', 'realizedProfit', 'orderFees']) {
    console.log(k + ':', mt[k]);
  }
  console.log('positions:', JSON.stringify(mt.positions || mt.position || null));
}
const mk = s2.market || {};
console.log('strategy.market:', mk.error ? 'error ' + mk.error : JSON.stringify(mk).slice(0, 600));

// 当前挂单
const mo = (s.myOrders && s.myOrders.list) || (s2.myOrders && s2.myOrders.list) || [];
console.log('myOrders:', mo.length ? JSON.stringify(mo.map(o => ({ t: o.type, r: o.resourceType, p: o.price, amt: o.amount, total: o.totalAmount, active: o.active !== false }))) : '无挂单');

// 6. prices
console.log('== 市场价格 ==');
for (const [rt, p] of Object.entries(s2.prices || {})) {
  console.log(rt, JSON.stringify(p));
}

// 7. money history
console.log('== money history ==');
const mh = s.moneyHistory || [];
for (const h of mh.slice(0, 40)) {
  if (h.error) { console.log('err:', h.error); continue; }
  console.log(JSON.stringify(h));
}
console.log('moneyHistory 条数:', mh.length);

// 8. stats memory (可选)
const st = s.stats || {};
if (st.error) console.log('stats memory error:', st.error);
else if (st && Object.keys(st).length) console.log('stats memory keys:', Object.keys(st).slice(0, 30).join(','));
