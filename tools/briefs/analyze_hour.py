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

last_hour = [r for r in rows if datetime.datetime.fromtimestamp(r['ts']).hour >= 18]
print("samples:", len(last_hour))
for r in last_hour:
    t = datetime.datetime.fromtimestamp(r['ts']).strftime('%H:%M')
    rooms = r.get('official_rooms') or {}
    parts = [t]
    for name in ['E41N23', 'E42N24', 'E43N29', 'E44N28', 'E42N26']:
        v = rooms.get(name) or {}
        spawn = (v.get('spawning') or [])
        tw = v.get('towerEnergy') or 0
        parts.append(
            "%s: dt=%s st=%s tw=%s sp=%s h=%s" % (
                name, v.get('downgradeTicks'), v.get('storageEnergy'), tw,
                ','.join(spawn) or '-', len(v.get('hostiles') or {}))
        )
    print(' | '.join(parts))

base = [r for r in rows if 17 <= datetime.datetime.fromtimestamp(r['ts']).hour < 18][-1]
print("\nbaseline 17:5x:")
t = datetime.datetime.fromtimestamp(base['ts']).strftime('%H:%M')
rooms = base.get('official_rooms') or {}
for name in ['E41N23', 'E42N24', 'E43N29', 'E44N28', 'E42N26']:
    v = rooms.get(name) or {}
    print(name, 'dt=%s st=%s tw=%s sp=%s' % (v.get('downgradeTicks'), v.get('storageEnergy'), v.get('towerEnergy'), ','.join(v.get('spawning') or [])))
