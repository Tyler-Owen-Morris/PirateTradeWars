// Footage helper (docs/trailer/FOOTAGE.md): is a sailing line clear of land? Uses the real land field the server uses.
//   npx tsx scripts/trailer/landcheck.ts <lat> <lon> [dist=3500]            # every heading (15 deg steps)
//   npx tsx scripts/trailer/landcheck.ts <lat> <lon> <dist> <headingRad>    # one heading
// Heading r as in the game: forward = (-sin r, -cos r) in (east, south): r = 0 north, PI south, -PI/2 east, PI/2 west.
// Prints, per heading, the closest approach to land along the line (metric units; < ~30 = aground) and where it happens.
import { loadLandSync } from "../../server/game/landLoader";

const [lat, lon, dist = "3500", head] = process.argv.slice(2);
const { field } = loadLandSync(undefined, () => {});
const C = 400000, H = 200000;
const x0 = ((Number(lon) + 180) / 360) * C, z0 = ((90 - Number(lat)) / 180) * H;
const mx = Math.cos((Number(lat) * Math.PI) / 180);
const heads = head !== undefined ? [Number(head)] : Array.from({ length: 24 }, (_, i) => -Math.PI + (i * Math.PI) / 12);
console.log(`start land distance ${field.distance(x0, z0).toFixed(0)}`);
for (const r of heads) {
  let min = Infinity, at = 0;
  for (let s = 0; s <= Number(dist); s += 20) {
    const d = field.distance(x0 + (-Math.sin(r) * s) / mx, z0 - Math.cos(r) * s);
    if (d < min) { min = d; at = s; }
  }
  const compass = (((-r * 180) / Math.PI) % 360 + 360) % 360; // 0 = north, 90 = east (r = 0 sails north)
  console.log(`r ${r.toFixed(3).padStart(7)} (bearing ${compass.toFixed(0).padStart(3)})  closest land ${min.toFixed(0).padStart(5)} at ${at}`);
}
