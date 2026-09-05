import json, datetime

rows = []
with open('/opt/data/cache/screeps-hm-watch/journal/2026-08-19.jsonl') as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        rows.append(r)

print("=== hm.expansion history today (every 2h) ===")
for r in rows:
    dt = datetime.datetime.fromtimestamp(r['ts'])
    hm = r.get('hm') or {}
    exp = hm.get('expansion') or {}
    minecount = len(hm.get('mines') or {})
    remotes = hm.get('remotes') or []
    if dt.minute < 15 and (dt.hour % 2 == 0):
        print(dt.strftime('%H:%M'), 'target=', exp.get('roomName'), 'spawn=', exp.get('spawnRoom'),
              'score=', round(exp.get('expansionScore') or 0, 2) if exp.get('expansionScore') else None,
              'mines=', minecount, 'remotes=', remotes)

print("\n=== last 4 samples full hm ===")
for r in rows[-4:]:
    dt = datetime.datetime.fromtimestamp(r['ts']).strftime('%H:%M')
    hm = r.get('hm') or {}
    exp = hm.get('expansion') or {}
    print(dt, json.dumps(exp, ensure_ascii=False)[:300])
    print('   remotes:', hm.get('remotes'), 'mines:', list((hm.get('mines') or {}).keys()))
    cpu = (hm.get('cpu_current') or {})
    print('   cpu:', {k: cpu.get(k) for k in ('usage', 'limit', 'bucket')})
