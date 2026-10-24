// Offline world data pipeline (card W2, spec docs/world/WORLD_SPEC.md §4.1, §5, §6).
//
//   npm run world:build            # full rebuild of every artifact
//   npm run world:build -- --check # rebuild in memory and only validate (writes nothing)
//   npm run world:build -- --maps-only # re-render only the two map PNGs (F1)
//
// Inputs: Natural Earth land polygons (public domain), downloaded once into scripts/world/.cache/
// (gitignored) from a pinned release tag. Outputs (all committed):
//   client/public/world/land/<version>/t_<tx>_<ty>.bin  Int8 SDF tiles (256x256, row-major)
//   client/public/world/land/manifest.json
//   client/public/world/map_4096x2048.png, map_1024x512.png
//   shared/world/ports.json, shared/world/lanes.json, shared/world/versions.json
// Everything is deterministic: same inputs -> byte-identical outputs. See docs/world/DATA_PIPELINE.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  W, H, PX, TILE, TILES_X, TILES_Y, SDF_UNIT, SDF_MAX, ICE_LAT_N, ICE_LAT_S, WORLD_C, Z_ICE_N, Z_ICE_S,
  latToZ, lonToX, metricDist, sampleSdf, rowLat, wrap,
} from "./lib/common";
import { carveChannel, rasterizeGeoJson } from "./lib/raster";
import { CHANNELS } from "./channels";
import { buildSdf } from "./lib/sdf";
import { oceanMask, placePorts, type PlacedPort } from "./lib/ports";
import { LaneGrid, type Lane, LANE_CLEARANCE } from "./lib/lanes";
import { renderMap } from "./lib/map";
import { encodePngRgb } from "./lib/png";
import { PORT_DEFS, NAMED_LANES } from "./portDefs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, "scripts/world/.cache");
const LAND_DIR = path.join(ROOT, "client/public/world/land");
const PUBLIC_WORLD = path.join(ROOT, "client/public/world");
const SHARED_WORLD = path.join(ROOT, "shared/world");
const CHECK_ONLY = process.argv.includes("--check");
/** F1: `npm run world:build -- --maps-only` re-renders just the two map PNGs. */
const MAPS_ONLY = process.argv.includes("--maps-only");

/** Natural Earth 5.1.2 (pinned tag). sha256 recorded so a silent upstream change is noticed. */
const NE_TAG = "v5.1.2";
const SOURCES = {
  ne_10m_land: "1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416",
  ne_50m_land: "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b",
  ne_10m_minor_islands: "8c933ca7a4760256bdc46408355706e39764b0fa01c160c28888b90b4faec29f",
} as Record<string, string>;
const neUrl = (name: string) =>
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson/${name}.geojson`;

/** 1:10m detail boxes [lonMin, latMin, lonMax, latMax]; 1:50m everywhere else (spec §4.1). */
const DETAIL_BOXES: [number, number, number, number][] = [
  [-100, 5, -55, 33], // Caribbean and Gulf of Mexico
  [-15, 30, 45, 66], // Europe, the Mediterranean, the Baltic
  [-26, -8, 16, 30], // West Africa (Cape Verde to the Gulf of Guinea)
];

/** Gzip tiles when the raw committed tile set would exceed this (task brief: ~15 MB). */
const GZIP_THRESHOLD = 15 * 1024 * 1024;

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function loadSource(name: string): Promise<any> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${NE_TAG}_${name}.geojson`);
  if (!fs.existsSync(file)) {
    log(`downloading ${neUrl(name)}`);
    const res = await fetch(neUrl(name));
    if (!res.ok) throw new Error(`download failed ${res.status} ${neUrl(name)}`);
    fs.writeFileSync(file + ".part", Buffer.from(await res.arrayBuffer()));
    fs.renameSync(file + ".part", file);
  }
  const buf = fs.readFileSync(file);
  const sha = createHash("sha256").update(buf).digest("hex");
  log(`${name}: ${(buf.length / 1e6).toFixed(1)} MB sha256 ${sha.slice(0, 16)}`);
  if (SOURCES[name] && SOURCES[name] !== sha) {
    console.warn(`WARNING: ${name} sha256 differs from the recorded value; outputs may change.`);
  }
  return JSON.parse(buf.toString("utf8"));
}

function buildLandMask(ne10: any, ne50: any, minor: any): Uint8Array {
  const m10 = new Uint8Array(W * H);
  const m50 = new Uint8Array(W * H);
  log(`rasterized ne_10m_land: ${rasterizeGeoJson(ne10, m10)} polygons`);
  log(`rasterized ne_10m_minor_islands: ${rasterizeGeoJson(minor, m10)} polygons`);
  log(`rasterized ne_50m_land: ${rasterizeGeoJson(ne50, m50)} polygons`);
  // per-pixel box membership
  const land = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const lat = rowLat(j);
    const boxes = DETAIL_BOXES.filter((b) => lat >= b[1] && lat < b[3]);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 360 - 180;
      const idx = j * W + i;
      const inBox = boxes.some((b) => lon >= b[0] && lon < b[2]);
      land[idx] = inBox ? m10[idx] : m50[idx];
    }
  }
  // New Horizons phase 2: straits narrower than a pixel that a port sits behind (scripts/world/channels.ts)
  for (const ch of CHANNELS) log(`carved channel ${ch.name}: ${carveChannel(land, ch.points, ch.halfWidth)} pixels`);
  return land;
}

interface TileResult {
  version: string;
  allWater: string[];
  allLand: string[];
  tiles: { key: string; data: Int8Array }[];
}

function cutTiles(sdf: Int8Array): TileResult {
  const version = createHash("sha256").update(Buffer.from(sdf.buffer)).digest("hex").slice(0, 10);
  const allWater: string[] = [];
  const allLand: string[] = [];
  const tiles: { key: string; data: Int8Array }[] = [];
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const data = new Int8Array(TILE * TILE);
      let water = true;
      let land = true;
      for (let r = 0; r < TILE; r++) {
        const src = (ty * TILE + r) * W + tx * TILE;
        for (let c = 0; c < TILE; c++) {
          const v = sdf[src + c];
          data[r * TILE + c] = v;
          if (v !== SDF_MAX) water = false;
          if (v !== -SDF_MAX) land = false;
        }
      }
      const key = `${tx}_${ty}`;
      if (water) allWater.push(key);
      else if (land) allLand.push(key);
      else tiles.push({ key, data });
    }
  }
  return { version, allWater, allLand, tiles };
}

function buildLanes(ports: PlacedPort[], sdf: Int8Array): { lanes: Lane[]; grid: LaneGrid } {
  const grid = new LaneGrid(sdf, ports.map((p) => p.dock));
  const cellOfPort = new Map<string, number>();
  const portOfCell = new Map<number, number>();
  ports.forEach((p, k) => {
    const c = grid.snap(p.dock.x, p.dock.z);
    if (portOfCell.has(c)) throw new Error(`two docks share lane cell ${c}`);
    cellOfPort.set(p.id, c);
    portOfCell.set(c, k);
  });
  const byId = new Map(ports.map((p) => [p.id, p]));
  const lanes = new Map<string, Lane>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (a: PlacedPort, b: PlacedPort, cells: number[]) => {
    const key = pairKey(a.id, b.id);
    if (lanes.has(key)) return;
    // store in a canonical direction for determinism: from = the id that sorts first
    const [f, t, cs] = a.id < b.id ? [a, b, cells] : [b, a, cells.slice().reverse()];
    lanes.set(key, grid.toLane(f, t, cs));
  };

  // 4 nearest by sea per port (Dijkstra until 4 other docks are settled)
  for (const p of ports) {
    const src = cellOfPort.get(p.id)!;
    const targets = new Map(portOfCell);
    targets.delete(src);
    const found = grid.search(src, targets, 4);
    if (found.length < 4) throw new Error(`${p.id}: only ${found.length} ports reachable by sea`);
    for (const f of found) add(p, ports[portOfCell.get(f.cell)!], grid.path(f.cell));
    log(`lanes: ${p.id} -> ${found.map((f) => `${ports[portOfCell.get(f.cell)!].id}(${Math.round(f.cost)})`).join(", ")}`);
  }
  // named long-haul lanes (A*)
  for (const [a, b] of NAMED_LANES) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) throw new Error(`named lane ${a}-${b}: unknown port`);
    const goal = cellOfPort.get(b)!;
    const found = grid.search(cellOfPort.get(a)!, new Map([[goal, 0]]), 1, goal);
    if (!found.length) throw new Error(`named lane ${a}-${b}: unreachable`);
    add(pa, pb, grid.path(goal));
    log(`lanes: named ${a} -> ${b} (${Math.round(found[0].cost)})`);
  }
  const out = [...lanes.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map((e) => e[1]);
  return { lanes: out, grid };
}

// ---------------------------------------------------------------------------------------------
// Validation (also mirrored by shared/world/__tests__/data.test.ts on the committed files)
// ---------------------------------------------------------------------------------------------
function validate(sdf: Int8Array, ports: PlacedPort[], lanes: Lane[], grid: LaneGrid) {
  const errors: string[] = [];
  const at = (lat: number, lon: number) => sampleSdf(sdf, lonToX(lon), latToZ(lat));
  const samples: [string, number, number, "water" | "land"][] = [
    ["mid-Atlantic", 30, -40, "water"],
    ["Madrid", 40.42, -3.7, "land"],
    ["Strait of Gibraltar", 35.97, -5.55, "water"],
    ["Jamaica", 18.15, -77.3, "land"],
    ["Panama isthmus", 9.0, -79.5, "land"],
    ["English Channel", 50.2, -1.5, "water"],
    ["Cuba", 22.0, -79.5, "land"],
    ["Pacific", 0, -140, "water"],
  ];
  for (const [name, lat, lon, want] of samples) {
    const d = at(lat, lon);
    log(`sample ${name}: ${d.toFixed(0)}`);
    if ((want === "water") !== d > 0) errors.push(`sample ${name}: expected ${want}, sdf ${d}`);
  }
  for (const p of ports) {
    const town = sampleSdf(sdf, p.x, p.z);
    const dock = sampleSdf(sdf, p.dock.x, p.dock.z);
    const spawn = sampleSdf(sdf, p.spawn.x, p.spawn.z);
    if (!(town < 0)) errors.push(`${p.id}: town not on land (${town})`);
    if (!(dock > 80 && dock <= 400)) errors.push(`${p.id}: dock sdf ${dock}`);
    if (!(spawn > 150)) errors.push(`${p.id}: spawn sdf ${spawn}`);
    const td = metricDist(p.x, p.z, p.dock.x, p.dock.z);
    if (td > 800) errors.push(`${p.id}: town->dock ${td.toFixed(0)} > 800`);
  }
  // every port reachable by sea from Port Royal: on the lane graph
  const adj = new Map<string, string[]>();
  for (const l of lanes) {
    adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
    adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
  }
  const seen = new Set(["port_royal"]);
  const stack = ["port_royal"];
  while (stack.length) for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  for (const p of ports) if (!seen.has(p.id)) errors.push(`${p.id}: not reachable from Port Royal on the lane graph`);
  // lanes keep clearance
  let minClear = Infinity;
  for (const l of lanes) {
    for (let k = 0; k + 1 < l.points.length; k++) {
      const [ax, az] = l.points[k];
      const [bx, bz] = l.points[k + 1];
      if (Math.abs(bx - ax) >= WORLD_C / 2) errors.push(`lane ${l.from}-${l.to}: x not unwrapped`);
      const n = Math.max(1, Math.ceil(metricDist(wrap(ax, WORLD_C), az, wrap(bx, WORLD_C), bz) / 20));
      for (let s = 0; s <= n; s++) {
        const x = wrap(ax + ((bx - ax) * s) / n, WORLD_C);
        const z = az + ((bz - az) * s) / n;
        const d = sampleSdf(sdf, x, z);
        if (d < minClear) minClear = d;
        if (d < 60) {
          errors.push(`lane ${l.from}-${l.to}: clearance ${d.toFixed(0)} at ${x.toFixed(0)},${z.toFixed(0)}`);
          break;
        }
        if (z < Z_ICE_N || z > Z_ICE_S) errors.push(`lane ${l.from}-${l.to}: enters ice`);
      }
    }
  }
  log(`lanes: ${lanes.length}, min clearance along lanes ${minClear.toFixed(0)} (grid ${LANE_CLEARANCE})`);
  void grid;
  if (errors.length) {
    for (const e of errors) console.error("VALIDATION:", e);
    throw new Error(`${errors.length} validation errors`);
  }
  log("validation passed");
}

function writeJson(file: string, data: unknown, compactArrays = false) {
  let s = JSON.stringify(data, null, 2);
  if (compactArrays) s = s.replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]");
  fs.writeFileSync(file, s + "\n");
}

/** --debug: full-resolution (raster pixel = map pixel) crops with lanes (red), towns (black),
 *  docks (green) and spawns (blue), written to the gitignored cache dir for eyeballing. */
function writeDebugCrops(sdf: Int8Array, ports: PlacedPort[], lanes: Lane[]) {
  const crops: [string, number, number, number, number][] = [
    // name, lonMin, latMax, lonMax, latMin
    ["caribbean", -100, 33, -55, 5],
    ["europe", -15, 60, 10, 34],
    // New Horizons phase 2: the northern ports
    ["baltic", 4, 66, 32, 53],
    ["north_atlantic", -96, 72, 45, 44],
    ["nw_pacific", 130, 62, 180, 10],
    ["ne_pacific", -180, 62, -120, 10],
    ["world", -180, 90, 180, -90],
  ];
  const base = renderMap(sdf, W);
  for (const [name, lo0, la0, lo1, la1] of crops) {
    const step = name === "world" ? 4 : 1;
    const i0 = Math.floor(lonToX(lo0) / PX);
    const j0 = Math.floor(latToZ(la0) / PX);
    const cw = Math.floor((Math.floor(lonToX(lo1) / PX) - i0) / step);
    const ch = Math.floor((Math.floor(latToZ(la1) / PX) - j0) / step);
    const img = new Uint8Array(cw * ch * 3);
    for (let v = 0; v < ch; v++)
      for (let u = 0; u < cw; u++) {
        const s = ((j0 + v * step) * W + i0 + u * step) * 3;
        img.set(base.subarray(s, s + 3), (v * cw + u) * 3);
      }
    const dot = (x: number, z: number, c: number[], r: number) => {
      const u0 = Math.round((wrap(x, WORLD_C) / PX - i0) / step);
      const v0 = Math.round((z / PX - j0) / step);
      for (let dv = -r; dv <= r; dv++)
        for (let du = -r; du <= r; du++) {
          const u = u0 + du;
          const v = v0 + dv;
          if (u >= 0 && v >= 0 && u < cw && v < ch) img.set(c, (v * cw + u) * 3);
        }
    };
    for (const l of lanes)
      for (let k = 0; k + 1 < l.points.length; k++) {
        const [ax, az] = l.points[k];
        const [bx, bz] = l.points[k + 1];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (PX * step * 0.5)) + 1;
        for (let s = 0; s <= n; s++) dot(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, [200, 30, 30], 0);
      }
    for (const p of ports) {
      dot(p.spawn.x, p.spawn.z, [30, 60, 220], 1);
      dot(p.dock.x, p.dock.z, [20, 160, 40], 1);
      dot(p.x, p.z, [0, 0, 0], 1);
    }
    fs.writeFileSync(path.join(CACHE, `debug_${name}.png`), encodePngRgb(cw, ch, img));
  }
  log("debug crops written to scripts/world/.cache/");
}

async function main() {
  const ne10 = await loadSource("ne_10m_land");
  const ne50 = await loadSource("ne_50m_land");
  const minor = await loadSource("ne_10m_minor_islands");

  const land = buildLandMask(ne10, ne50, minor);
  log("land mask done");
  const sdf = buildSdf(land);
  log("SDF done");
  if (MAPS_ONLY) {
    // Re-render only the map PNGs (no tiles, ports, lanes or versions are touched).
    writeMaps(sdf);
    log("done (--maps-only)");
    return;
  }

  const tiles = cutTiles(sdf);
  const rawBytes = tiles.tiles.length * TILE * TILE;
  const gzip = rawBytes > GZIP_THRESHOLD;
  log(`tiles: ${tiles.tiles.length} stored, ${tiles.allWater.length} all-water, ${tiles.allLand.length} all-land, raw ${(rawBytes / 1048576).toFixed(1)} MiB, gzip=${gzip}`);

  // ocean component for dock/spawn placement (flood from the mid-Atlantic, threshold 100 units)
  const jMin = Math.ceil(Z_ICE_N / PX);
  const jMax = Math.floor(Z_ICE_S / PX) - 1;
  const ocean = oceanMask(sdf, 100, lonToX(-40), latToZ(30), jMin, jMax);
  const ports = placePorts(PORT_DEFS, sdf, ocean);
  for (const p of ports) {
    log(`port ${p.id}: town moved ${p._townMoved}, town->dock ${metricDist(p.x, p.z, p.dock.x, p.dock.z).toFixed(0)}, dock sdf ${sampleSdf(sdf, p.dock.x, p.dock.z).toFixed(0)}`);
  }
  const { lanes, grid } = buildLanes(ports, sdf);
  validate(sdf, ports, lanes, grid);
  if (process.argv.includes("--debug")) writeDebugCrops(sdf, ports, lanes);

  if (CHECK_ONLY) {
    log(`--check: land version would be ${tiles.version}; nothing written`);
    return;
  }

  // ---- write land tiles + manifest
  fs.mkdirSync(LAND_DIR, { recursive: true });
  for (const e of fs.readdirSync(LAND_DIR)) {
    if (e !== tiles.version && e !== "manifest.json") fs.rmSync(path.join(LAND_DIR, e), { recursive: true, force: true });
  }
  const vdir = path.join(LAND_DIR, tiles.version);
  fs.rmSync(vdir, { recursive: true, force: true });
  fs.mkdirSync(vdir, { recursive: true });
  let written = 0;
  for (const t of tiles.tiles) {
    const raw = Buffer.from(t.data.buffer);
    const buf = gzip ? gzipSync(raw, { level: 9 }) : raw;
    // gzip header has an mtime field; gzipSync writes 0, so output stays deterministic
    fs.writeFileSync(path.join(vdir, `t_${t.key}.bin${gzip ? ".gz" : ""}`), buf);
    written += buf.length;
  }
  const manifest: Record<string, unknown> = {
    version: tiles.version,
    width: W,
    height: H,
    tile: TILE,
    px: PX,
    sdfUnit: SDF_UNIT,
    // New Horizons phase 2: the single symmetric `iceLat` became iceLatN / iceLatS (nothing read it).
    iceLatN: ICE_LAT_N,
    iceLatS: ICE_LAT_S,
    allWater: tiles.allWater,
    allLand: tiles.allLand,
  };
  if (gzip) manifest.encoding = "gzip";
  fs.writeFileSync(path.join(LAND_DIR, "manifest.json"), JSON.stringify(manifest) + "\n");
  log(`wrote ${tiles.tiles.length} tiles, ${(written / 1048576).toFixed(2)} MiB on disk`);

  // ---- ports, lanes, versions
  fs.mkdirSync(SHARED_WORLD, { recursive: true });
  const portsOut = ports.map(({ _townMoved, ...p }) => p);
  writeJson(path.join(SHARED_WORLD, "ports.json"), portsOut);
  writeJson(path.join(SHARED_WORLD, "lanes.json"), lanes, true);
  const hashFile = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 10);
  writeJson(path.join(SHARED_WORLD, "versions.json"), {
    land: tiles.version,
    ports: hashFile(path.join(SHARED_WORLD, "ports.json")),
    lanes: hashFile(path.join(SHARED_WORLD, "lanes.json")),
  });

  writeMaps(sdf);
  log("done");
}

/** Map textures. The 4096 world map (M) keeps the 15° graticule; the 1024 one only feeds the
 *  minimap, where the grid lines showed as dark stripes (Q1 B4), so it has none. */
function writeMaps(sdf: Int8Array) {
  for (const [w, graticule] of [[4096, true], [1024, false]] as const) {
    const png = encodePngRgb(w, w / 2, renderMap(sdf, w, { graticule }));
    fs.writeFileSync(path.join(PUBLIC_WORLD, `map_${w}x${w / 2}.png`), png);
    log(`map_${w}x${w / 2}.png ${(png.length / 1048576).toFixed(2)} MiB (graticule ${graticule})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
