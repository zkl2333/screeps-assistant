const fs = require("fs");
const file = process.argv[2] || "C:/Users/zkl23/AppData/Local/Temp/e42n24-t76245090.json";
const d = JSON.parse(fs.readFileSync(file, "utf8"));
console.log("base:", d.base, "| ticks:", JSON.stringify(Object.keys(d.ticks || {})));
for (const [tick, objs] of Object.entries(d.ticks || {})) {
  console.log("=== tick " + tick + " ===");
  for (const o of Object.values(objs)) {
    if (o.type === "source")
      console.log("source", o._id.slice(0, 12), "pos(" + o.x + "," + o.y + ")", "energy:" + o.energy + "/" + o.energyCapacity);
    if (o.type === "container")
      console.log("container", o._id.slice(0, 12), "pos(" + o.x + "," + o.y + ")", JSON.stringify(o.store || {}));
    if (o.type === "creep")
      console.log("creep", o.name, "pos(" + o.x + "," + o.y + ")", "store:" + JSON.stringify(o.store || {}));
  }
}
