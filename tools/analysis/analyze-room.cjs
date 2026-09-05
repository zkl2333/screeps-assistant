const fs = require("fs");
const p = process.argv[2] || "C:/Users/zkl23/AppData/Local/Temp/e42n24-room.json";
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const objs = d.objects || [];
const creeps = objs.filter(o => o.type === "creep");
console.log("=== Creeps (" + creeps.length + ") ===");
for (const c of creeps) {
  const parts = {};
  for (const b of c.body || []) parts[b.type] = (parts[b.type] || 0) + 1;
  const task = c.memory && c.memory.task ? c.memory.task.name + ">" + (c.memory.task._target ? c.memory.task._target.ref : "") : "-";
  console.log(
    c.name, "| role:" + (c.memory ? c.memory.role : "?"),
    "| pos(" + c.x + "," + c.y + ")",
    "| ttl:" + c.ticksToLive, "| fatigue:" + c.fatigue,
    "| store:" + JSON.stringify(c.store || {}),
    "| task:" + task,
    "| sourceId:" + (c.memory ? c.memory.sourceId || "-" : "-"),
    "| parts: W" + parts.work + " C" + parts.carry + " M" + parts.move
  );
}
console.log("=== Sources ===");
for (const s of objs.filter(o => o.type === "source"))
  console.log("source", (s._id || s.id).slice(0, 12), "pos(" + s.x + "," + s.y + ")", "energy:" + s.energy + "/" + s.energyCapacity, "regen in:" + s.ticksToRegeneration);
console.log("=== Containers ===");
for (const c of objs.filter(o => o.type === "container"))
  console.log("container", (c._id || c.id).slice(0, 12), "pos(" + c.x + "," + c.y + ")", JSON.stringify(c.store || {}));
console.log("=== Dropped ===");
for (const r of objs.filter(o => o.type === "dropped"))
  console.log("dropped", r.resourceType, "pos(" + r.x + "," + r.y + ")", "amount:" + r.amount);
console.log("=== Spawn/Ext/Link/Storage/Tower ===");
for (const s of objs.filter(o => ["spawn", "extension", "link", "storage", "tower"].includes(o.type)))
  console.log(s.type, (s._id || s.id).slice(0, 12), "pos(" + s.x + "," + s.y + ")", "store:" + JSON.stringify(s.store || {}));
