#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小时简报本地分析：提取紧凑关键事实（只读）"""
import json, sys

BASE = '/opt/data/workspace/screeps-assistant/scripts/'
s = json.load(open(BASE + '.brief-new-summary.json'))
s2 = json.load(open(BASE + '.brief-new-summary2.json'))

ROOMS = ['E42N24', 'E42N26', 'E44N28', 'E41N23', 'E43N29']
fmt = lambda n: 'null' if n is None else f'{n:,}'

# 1. 全局
print('== 全局 ==')
a = s.get('auth', {})
print(f"tick: {s.get('gameTime')} | GCL: {fmt(a.get('gcl'))} | money(authMe): {fmt(a.get('money'))} | credits: {a.get('credits')} | cpu: {a.get('cpu')} | cpuShard: {a.get('cpuShard')} | pixels: {a.get('pixels')}")
ms = s.get('mapStats', {})
print('mapStats:', json.dumps(ms, ensure_ascii=False))

# 2/3. 房间
for r in ROOMS:
    rm = s.get('rooms', {}).get(r)
    if not rm or isinstance(rm, str):
        print(f'== {r} == 无数据 {rm}')
        continue
    c = rm.get('controller') or {}
    st = rm.get('storage') or {}
    te = rm.get('terminal') or {}
    ov = (s.get('overview') or {}).get(r) or {}
    fx = rm.get('factory') or {}
    print(f'== {r} ==')
    print(f"RCL: {c.get('level')} | progress: {fmt(c.get('progress'))} / {fmt(c.get('progressTotal'))} | downgrade: {c.get('ticksToDowngrade')} | upgradeBlocked: {c.get('upgradeBlocked')}")
    print(f"storageE: {fmt(st.get('energy'))} / {fmt(st.get('capacity'))} | terminalE: {fmt(te.get('energy'))} / {fmt(te.get('capacity'))}")
    labs = rm.get('labs') or []
    print('labs:', ' '.join(f"{l.get('mineralType') or '-'}:{l.get('mineralAmount')}" for l in labs), '| cd:', ','.join(str(l.get('cooldown')) for l in labs), '| hits:', ','.join(str(l.get('hits')) for l in labs))
    if fx.get('level') is not None:
        print(f"factory: L{fx.get('level')} cd={fx.get('cooldown')} store={json.dumps(fx.get('store') or {}, ensure_ascii=False)}")
    else:
        print('factory: 无')
    sp = rm.get('spawns') or []
    print('spawns:', ' '.join(f"{x.get('name','?').split(' ')[0]}[{x.get('energy')}/{x.get('capacity')}{'*' if x.get('spawning') else ''}]" for x in sp))
    myc = rm.get('myCreeps') or []
    enem = rm.get('enemyCreeps') or []
    print(f"myCreeps: {len(myc)} | enemyCreeps: {len(enem)} " + json.dumps(enem, ensure_ascii=False))
    hs = rm.get('hostileStructures') or []
    if hs: print('hostileStruct:', json.dumps(hs, ensure_ascii=False))
    print('overview:', json.dumps(ov))

# 4. 房间内存意图
print('== 房间内存意图 ==')
for r in ROOMS:
    m = (s.get('roomMemory') or {}).get(r) or {}
    if isinstance(m, dict) and not m.get('error'):
        keys = [k for k in m.keys() if any(x in k.lower() for x in ['lab', 'factory', 'boost', 'reaction', 'mineral', 'terminal', 'trade'])]
        if keys:
            print(r, 'keys:', ','.join(keys))
            for k in keys:
                v = json.dumps(m[k], ensure_ascii=False)
                print(' ', r, k, '=', v[:400])
    else:
        print(r, 'memory error:', m)

# 5. 市场账本
print('== 市场账本 ==')
mt = s.get('marketTrade') or {}
if mt.get('error'):
    print('marketTrade error:', mt['error'])
else:
    print('marketTrade keys:', ','.join(mt.keys()))
    for k in ['netMarketProfit', 'cashflow', 'realizedProfit', 'orderFees']:
        print(k + ':', mt.get(k))
    pos = mt.get('positions') or mt.get('position')
    print('positions:', json.dumps(pos, ensure_ascii=False)[:800] if pos else None)
mk = s2.get('market') or {}
print('strategy.market:', json.dumps(mk, ensure_ascii=False)[:600] if not mk.get('error') else ('error ' + str(mk['error'])))

# 挂单
mo = ((s.get('myOrders') or {}).get('list')) or []
if not mo and not (s2.get('myOrders') or {}).get('error'):
    mo = (s2.get('myOrders') or {}).get('list') or []
print('myOrders count:', len(mo))
for o in mo[:20]:
    print(' ', o.get('type'), o.get('resourceType'), 'price', o.get('price'), 'amount', o.get('amount'), 'total', o.get('totalAmount'), 'active', o.get('active') if 'active' in o else '?')

# 6. money history 近几页
print('== money history ==')
mh = s.get('moneyHistory') or []
print('条数:', len(mh))
for h in mh[:40]:
    print(' ', json.dumps(h, ensure_ascii=False)[:300])

# 7. 市场价格
print('== 市场价格 ==')
for rt, p in (s2.get('prices') or {}).items():
    print(rt, json.dumps(p, ensure_ascii=False))
