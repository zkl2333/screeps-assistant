// 小时简报补充：市场价格、挂单、房间内存意图（只读）
const { ScreepsHttpClient } = require('/opt/data/workspace/screeps-assistant/node_modules/screeps-api');

(async () => {
  const api = await ScreepsHttpClient.fromConfig('main');
  const out = {};

  // 持仓资源当前市场价格（取各资源最低卖价 / 最高买价）
  out.prices = {};
  for (const rt of ['H', 'O', 'U', 'L', 'K', 'Z', 'X', 'energy']) {
    try {
      const r = await api.gameMarketOrders(rt, 'shard2');
      if (r && r.list) {
        const sells = r.list.filter(o => o.type === 'sell' && o.active !== false);
        const buys = r.list.filter(o => o.type === 'buy' && o.active !== false);
        const bestSell = sells.length ? Math.min(...sells.map(o => o.price)) : null;
        const bestBuy = buys.length ? Math.max(...buys.map(o => o.price)) : null;
        out.prices[rt] = { bestSell, bestBuy, sellOrders: sells.length, buyOrders: buys.length };
      } else out.prices[rt] = { error: 'no list' };
    } catch (e) { out.prices[rt] = { error: String(e.message || e) }; }
  }

  try { out.myOrders = await api.gameMarketMyOrders('shard2'); } catch (e) { out.myOrders = { error: String(e.message || e) }; }

  // 房间内存：lab/factory 意图
  const rooms = ['E42N24', 'E42N26', 'E44N28', 'E41N23', 'E43N29'];
  out.roomMemory = {};
  for (const r of rooms) {
    try { out.roomMemory[r] = await api.userMemoryGet('rooms.' + r, 'shard2'); }
    catch (e) { out.roomMemory[r] = { error: String(e.message || e) }; }
  }
  try { out.stats = await api.userMemoryGet('stats', 'shard2'); } catch (e) { out.stats = { error: String(e.message || e) }; }
  try { out.market = await api.userMemoryGet('strategy.market', 'shard2'); } catch (e) { out.market = { error: String(e.message || e) }; }

  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
