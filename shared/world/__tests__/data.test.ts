// Checks the committed world data (card W2, spec §4.1, §5, §6) without the runtime LandField:
// a tiny tile reader below decodes the tiles straight from client/public/world/land/.
// Regenerate the data with `npm run world:build` (docs/world/DATA_PIPELINE.md).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import ports from "../ports.json";
import lanes from "../lanes.json";
import versions from "../versions.json";

const ROOT = path.resolve(__dirname, "../../..");
const LAND = path.join(ROOT, "client/public/world/land");
const manifest = JSON.parse(fs.readFileSync(path.join(LAND, "manifest.json"), "utf8"));

const C = 400_000;
const H_UNITS = 200_000;
const W = 8192;
const H = 4096;
const TILE = 256;
const PX = C / W;
const z_ICE_N = (H_UNITS * 20) / 180;
const z_ICE_S = (H_UNITS * 160) / 180;
const x = (lon: number) => ((lon + 180) / 360) * C;
const z = (lat: number) => ((90 - lat) / 180) * H_UNITS;
const wrap = (v: number, m: number) => ((v % m) + m) % m;
const metricX = (zz: number) => Math.cos(((90 - (zz / H_UNITS) * 180) * Math.PI) / 180);
function metricDist(ax: number, az: number, bx: number, bz: number) {
  let dx = (bx - ax) % C;
  if (dx > C / 2) dx -= C;
  if (dx < -C / 2) dx += C;
  dx *= metricX((az + bz) / 2);
  return Math.hypot(dx, bz - az);
}

// ---- tiny tile reader (bilinear over pixel centres, i wraps, j clamps; spec §4.2) ----
const allWater = new Set<string>(manifest.allWater);
const allLand = new Set<string>(manifest.allLand);
const tileCache = new Map<string, Int8Array>();
function tileFile(key: string) {
  return path.join(LAND, manifest.version, `t_${key}.bin${manifest.encoding === "gzip" ? ".gz" : ""}`);
}
function tile(key: string): Int8Array {
  let t = tileCache.get(key);
  if (!t) {
    let buf = fs.readFileSync(tileFile(key));
    if (manifest.encoding === "gzip") buf = gunzipSync(buf);
    t = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
    tileCache.set(key, t);
  }
  return t;
}
function pixel(i: number, j: number): number {
  i = wrap(i, W);
  j = Math.min(H - 1, Math.max(0, j));
  const key = `${Math.floor(i / TILE)}_${Math.floor(j / TILE)}`;
  if (allWater.has(key)) return 127;
  if (allLand.has(key)) return -127;
  return tile(key)[(j % TILE) * TILE + (i % TILE)];
}
function sdf(xx: number, zz: number): number {
  const fx = xx / PX - 0.5;
  const fz = zz / PX - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  const top = pixel(i0, j0) + (pixel(i0 + 1, j0) - pixel(i0, j0)) * tx;
  const bot = pixel(i0, j0 + 1) + (pixel(i0 + 1, j0 + 1) - pixel(i0, j0 + 1)) * tx;
  return (top + (bot - top) * tz) * manifest.sdfUnit;
}
const at = (lat: number, lon: number) => sdf(x(lon), z(lat));

describe("land manifest and tiles", () => {
  it("manifest matches the spec constants", () => {
    expect(manifest).toMatchObject({ width: 8192, height: 4096, tile: 256, px: 48.828125, sdfUnit: 4, iceLat: 70 });
    expect(manifest.version).toMatch(/^[0-9a-f]{6,}$/);
    expect(versions.land).toBe(manifest.version);
  });

  it("every tile is exactly one of: allWater, allLand, or a file of 65536 bytes", () => {
    const dir = path.join(LAND, manifest.version);
    const files = new Set(fs.readdirSync(dir));
    let stored = 0;
    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const key = `${tx}_${ty}`;
        const n = Number(allWater.has(key)) + Number(allLand.has(key)) + Number(files.has(path.basename(tileFile(key))));
        expect(n, key).toBe(1);
        if (files.has(path.basename(tileFile(key)))) {
          stored++;
          expect(tile(key).length, key).toBe(65536);
        }
      }
    }
    expect(files.size).toBe(stored);
    // only the current version directory is published
    expect(fs.readdirSync(LAND).sort()).toEqual([manifest.version, "manifest.json"].sort());
  });

  it("known places are land or water", () => {
    expect(at(30, -40)).toBeGreaterThan(400); // mid-Atlantic
    expect(at(0, -140)).toBeGreaterThan(400); // Pacific
    expect(at(40.42, -3.7)).toBeLessThan(-400); // Madrid
    expect(at(18.15, -77.3)).toBeLessThan(0); // Jamaica
    expect(at(22.0, -79.5)).toBeLessThan(0); // Cuba
    expect(at(50.2, -1.5)).toBeGreaterThan(100); // English Channel
    expect(at(35.97, -5.55)).toBeGreaterThan(0); // Strait of Gibraltar
  });

  it("the Panama isthmus is closed (every meridian crossing it hits land)", () => {
    for (let lon = -80.0; lon <= -77.6; lon += 0.2) {
      let minD = Infinity;
      for (let lat = 7.0; lat <= 10.0; lat += 0.02) minD = Math.min(minD, at(lat, lon));
      expect(minD, `lon ${lon}`).toBeLessThan(0);
    }
  });

  it("is continuous across the antimeridian", () => {
    for (const lat of [-40, -16, 0, 52, 65]) {
      const a = sdf(C - 1, z(lat));
      const b = sdf(1, z(lat));
      expect(Math.abs(a - b), `lat ${lat}`).toBeLessThan(20);
    }
  });
});

describe("ports.json", () => {
  it("has ~25 ports with the required names, ≥10 in the Caribbean", () => {
    expect(ports.length).toBeGreaterThanOrEqual(20);
    const names = new Set(ports.map((p) => p.id));
    for (const id of ["port_royal", "havana", "cartagena", "veracruz", "nassau", "tortuga", "bridgetown",
      "charleston", "boston", "lisbon", "cadiz", "seville", "london", "bristol", "amsterdam",
      "cape_town", "goa", "batavia", "macau"]) expect(names.has(id), id).toBe(true);
    expect(names.size).toBe(ports.length);
    expect(ports.filter((p) => p.region === "caribbean").length).toBeGreaterThanOrEqual(10);
  });

  it("town on land, dock and spawn in water with the spec distances", () => {
    for (const p of ports) {
      expect(sdf(p.x, p.z), `${p.id} town`).toBeLessThan(0);
      const d = sdf(p.dock.x, p.dock.z);
      expect(d, `${p.id} dock`).toBeGreaterThan(80);
      expect(d, `${p.id} dock`).toBeLessThanOrEqual(400);
      expect(sdf(p.spawn.x, p.spawn.z), `${p.id} spawn`).toBeGreaterThan(150);
      expect(metricDist(p.x, p.z, p.dock.x, p.dock.z), `${p.id} town->dock`).toBeLessThan(800);
      expect(p.safeRadius).toBe(600);
      for (const v of [p.x, p.dock.x, p.spawn.x]) expect(v >= 0 && v < C).toBe(true);
      for (const v of [p.z, p.dock.z, p.spawn.z]) expect(v > z_ICE_N && v < z_ICE_S).toBe(true);
      // town sits near its real-world coordinates (snapped at most ~50 km for inland river ports)
      expect(metricDist(p.x, p.z, x(p.lon), z(p.lat)), `${p.id} snap`).toBeLessThan(500);
    }
  });
});

describe("lanes.json", () => {
  const byId = new Map(ports.map((p) => [p.id, p]));

  it("every port has lanes and all are reachable from Port Royal", () => {
    const adj = new Map<string, string[]>();
    for (const l of lanes) {
      expect(byId.has(l.from) && byId.has(l.to)).toBe(true);
      adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
      adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
    }
    const seen = new Set(["port_royal"]);
    const stack = ["port_royal"];
    while (stack.length) {
      for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
    }
    expect([...seen].sort()).toEqual(ports.map((p) => p.id).sort());
    for (const p of ports) expect((adj.get(p.id) ?? []).length, p.id).toBeGreaterThanOrEqual(4);
  });

  it("includes the named long-haul lanes", () => {
    const has = (a: string, b: string) => lanes.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
    for (const [a, b] of [["london", "boston"], ["cadiz", "cape_town"], ["cape_town", "goa"], ["goa", "batavia"],
      ["batavia", "macau"], ["cartagena", "havana"], ["havana", "seville"]]) expect(has(a, b), `${a}-${b}`).toBe(true);
  });

  it("starts and ends at docks, x is unwrapped, and every segment avoids land", () => {
    for (const l of lanes) {
      const pts = l.points as number[][];
      const f = byId.get(l.from)!;
      const t = byId.get(l.to)!;
      expect(pts[0]).toEqual([f.dock.x, f.dock.z]);
      expect(wrap(pts[pts.length - 1][0], C)).toBeCloseTo(t.dock.x, 3);
      expect(pts[pts.length - 1][1]).toBe(t.dock.z);
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[k + 1];
        expect(Math.abs(bx - ax)).toBeLessThan(C / 2);
        const n = Math.max(1, Math.ceil(metricDist(wrap(ax, C), az, wrap(bx, C), bz) / 25));
        for (let s = 0; s <= n; s++) {
          const zz = az + ((bz - az) * s) / n;
          const d = sdf(wrap(ax + ((bx - ax) * s) / n, C), zz);
          if (d < 60) throw new Error(`lane ${l.from}-${l.to} seg ${k}: clearance ${d.toFixed(0)}`);
          expect(zz > z_ICE_N && zz < z_ICE_S).toBe(true);
        }
      }
    }
  });
});
