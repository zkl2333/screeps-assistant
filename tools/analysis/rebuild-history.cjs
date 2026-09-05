// Reconstruct room state timeline from room-history (base snapshot + per-tick deltas)
const fs = require("fs");

function load(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("usage: node rebuild-history.cjs <history.json> [more...]");
  process.exit(1);
}

// Merge base windows in chronological order. Files must be ordered oldest first.
let merged = {}; // tick -> {id: obj}
let mergedTicks = [];
let order = [];
for (const file of files) {
  const d = load(file);
  const ticks = d.ticks || {};
  const base = d.base;
  const tickNums = Object.keys(ticks).map(Number).sort((a, b) => a - b);
  for (const tick of tickNums) {
    if (!merged[tick]) {
      merged[tick] = JSON.parse(JSON.stringify(merged[tick - 1] || {})); // carry previous state
      mergedTicks.push(tick);
      order.push(tick);
    }
    for (const [id, obj] of Object.entries(ticks[tick])) {
      if (obj === null || obj === undefined) delete merged[tick][id];
      else merged[tick][id] = obj;
    }
  }
}

console.log("===== RAW SAMPLES =====");
const d0 = load(files[0]);
for (const tick of ["76245001", "76245002", "76245066", "76245099"]) {
  const objs = d0.ticks[tick] || {};
  const ids = Object.keys(objs);
  console.log(tick, "->", ids.length, "objs:", JSON.stringify(ids.slice(0, 8)));
  if (ids.length > 0 && tick !== "76245000") console.log("   sample:", JSON.stringify(objs[ids[0]]).slice(0, 220));
}

console.log("===== RECONSTRUCTED TIMELINE (every 10 ticks) =====");
for (const tick of order) {
  if (tick % 10 !== 0) continue;
  const objs = merged[tick];
  const src = Object.values(objs).filter(o => o.type === "source");
  const con = Object.values(objs).filter(o => o.type === "container");
  const creeps = Object.values(objs).filter(o => o.type === "creep");
  console.log("tick " + tick);
  console.log("  sources:   " + src.map(o => o._id.slice(0, 8) + "@(" + o.x + "," + o.y + ")=" + o.energy).join(" | "));
  console.log("  containers:" + con.map(o => o._id.slice(0, 8) + "@(" + o.x + "," + o.y + ")=" + (o.store && o.store.energy)).join(" | "));
  console.log(
    "  creeps:    " + creeps
      .map(o => o.name + "(" + o.x + "," + o.y + ")" + (o.store && o.store.energy !== undefined ? "E" + o.store.energy : ""))
      .join(" ")
  );
}
