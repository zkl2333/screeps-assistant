// Emit per-tick time series from room-history deltas: source energy, container fills, creep positions/stores
const fs = require("fs");

function load(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const files = process.argv.slice(2);
// Merge base windows in file order (oldest first). Field-level merge of deltas.
let state = {}; // id -> full obj at current tick
let prevTick = -1;
const series = []; // {tick, state}

for (const file of files) {
  const d = load(file);
  const tickNums = Object.keys(d.ticks || {})
    .map(Number)
    .sort((a, b) => a - b);
  for (const tick of tickNums) {
    if (tick > prevTick) {
      // deep clone previous state as the new tick's starting state
      const clone = {};
      for (const [id, obj] of Object.entries(state)) clone[id] = JSON.parse(JSON.stringify(obj));
      state = clone;
      prevTick = tick;
    }
    for (const [id, delta] of Object.entries(d.ticks[tick])) {
      if (delta === null || delta === undefined) {
        delete state[id];
        continue;
      }
      const cur = state[id] || {};
      for (const [k, v] of Object.entries(delta)) {
        if (v === null || v === undefined) delete cur[k];
        else cur[k] = JSON.parse(JSON.stringify(v));
      }
      state[id] = cur;
    }
    series.push({ tick, state: JSON.parse(JSON.stringify(state)) });
  }
}

const creepsOfInterest = ["矿工_650", "矿工_65", "矿工_745", "矿工_999"];
const containersOfInterest = ["6a6b5578e96d96c56e11e057", "6a6b70eef5453261d27c9020", "6a6bd6036065ec96a282c20b"];
const sourcesOfInterest = ["59f1a5d282100e1594f3f0f1", "59f1a5d282100e1594f3f0f3"];

// Build lookups
const srcById = {};
for (const s of series) {
  for (const [id, obj] of Object.entries(s.state)) {
    if (obj.type === "source") srcById[id] = { x: obj.x, y: obj.y };
  }
}

// Compact per-tick lines: T | A=srcA B=srcB | c1=container c2=container c3 | minerName:x,y:E
const lines = [];
for (const s of series) {
  const parts = ["T" + s.tick];
  for (const id of sourcesOfInterest) {
    const o = s.state[id];
    parts.push(o ? "S" + (srcById[id] ? srcById[id].x + "," + srcById[id].y + "=" : "=") + o.energy : "S-");
  }
  for (const id of containersOfInterest) {
    const o = s.state[id];
    parts.push(o && o.store ? "C" + (o.store.energy || 0) : "C-");
  }
  for (const name of creepsOfInterest) {
    let found = null;
    for (const o of Object.values(s.state)) {
      if (o.type === "creep" && o.name === name) found = o;
    }
    if (found) parts.push("M" + name + "@" + found.x + "," + found.y + ":E" + (found.store && found.store.energy !== undefined ? found.store.energy : "-"));
  }
  // also list all creeps present
  const allCreeps = Object.values(s.state)
    .filter(o => o.type === "creep")
    .map(o => o.name + "@" + o.x + "," + o.y + (o.store && o.store.energy !== undefined ? ":E" + o.store.energy : ""))
    .join(" ");
  lines.push(parts.join("  ") + "  ||  " + allCreeps);
}
console.log(lines.join("\n"));
