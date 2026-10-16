import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { WORLD_C, WORLD_H, Z_ICE_N, metricX, wrappedDelta, xOfLon, zOfLat } from "@shared/world/geo";
import { buildSyntheticLand, ALWAYS_WATER_TEST_FIELD, ArrayTileSource, LandField, TILES_X, TILES_Y } from "@shared/world/land";
import { WATER_Y, terrainHeight, valueNoise, fbm, BEACH_HEIGHT } from "../terrainHeight";
import { buildChunkData, CHUNK, CHUNKS_X, LOD_STEPS, TerrainManager, VIEW_DISTANCE, DISPOSE_MARGIN } from "../terrain";
import { ShoreField } from "../shoreField";
import { ICE_PERIOD, ICE_CIRCUMFERENCE, MX_ICE, iceShift, iceProfile, PolarIce } from "../ice";
import { toRenderInto } from "../renderSpace";

const EQ = WORLD_H / 2;
// An island straddling the x seam at the equator, and one at 60°N.
const Z60 = ((90 - 60) / 180) * WORLD_H;
const { field } = buildSyntheticLand([
  { kind: "circle", x: 200, z: EQ, r: 900 },
  { kind: "circle", x: 50_000, z: Z60, r: 600 },
]);

/** JS replica of RENDER_TRANSFORM_GLSL. */
function shaderToRender(fx: number, fz: number, cx: number, cz: number, lx: number, lz: number) {
  const ox = wrappedDelta(fx, cx * CHUNK, WORLD_C);
  const oz = cz * CHUNK - fz;
  const zAbs = cz * CHUNK + lz;
  const mx = Math.max(Math.sin((zAbs * Math.PI) / WORLD_H), 0.01);
  return { x: (ox + lx) * mx, z: oz + lz };
}

describe("terrain height and noise", () => {
  it("coast at the waterline, land above, sea below", () => {
    expect(terrainHeight(0, 0, 0)).toBeCloseTo(WATER_Y, 9);
    expect(terrainHeight(50, 0, 0)).toBeLessThan(WATER_Y);
    expect(terrainHeight(-40, 0, 0, 0)).toBeCloseTo(WATER_Y + BEACH_HEIGHT, 6);
    expect(terrainHeight(-400, 0, 0, 0.8)).toBeGreaterThan(terrainHeight(-100, 0, 0, 0.8));
  });

  it("noise is continuous across the x wrap", () => {
    for (const z of [EQ, EQ + 123.4, Z60]) {
      expect(Math.abs(valueNoise(WORLD_C - 0.001, z, 160, 3) - valueNoise(0.001, z, 160, 3))).toBeLessThan(1e-3);
      expect(Math.abs(fbm(WORLD_C - 0.001, z) - fbm(0.001, z))).toBeLessThan(1e-3);
    }
  });
});

describe("chunk geometry", () => {
  const cxOf = (x: number) => Math.floor((((x % WORLD_C) + WORLD_C) % WORLD_C) / CHUNK);
  const czEq = Math.floor(EQ / CHUNK);

  it("open water builds nothing; land builds a mesh", () => {
    expect(buildChunkData(ALWAYS_WATER_TEST_FIELD, 10, czEq, 9)).toBeNull();
    const d = buildChunkData(field, cxOf(200), czEq, LOD_STEPS[0])!;
    expect(d).not.toBeNull();
    expect(d.minSdf).toBeLessThan(0);
    const n = LOD_STEPS[0];
    expect(d.positions.length).toBe((n * n + 4 * n) * 3);
    for (let i = 0; i < d.normals.length; i += 3) {
      expect(Math.hypot(d.normals[i], d.normals[i + 1], d.normals[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it("adjacent chunks share edge heights, including across the x seam", () => {
    const n = LOD_STEPS[0];
    for (const [a, b] of [
      [CHUNKS_X - 1, 0],
      [0, 1],
    ]) {
      const da = buildChunkData(field, a, czEq, n)!;
      const db = buildChunkData(field, b, czEq, n)!;
      expect(da && db).toBeTruthy();
      for (let j = 0; j < n; j++) {
        const ya = da.positions[(j * n + (n - 1)) * 3 + 1]; // a's east edge
        const yb = db.positions[(j * n) * 3 + 1]; // b's west edge
        expect(ya).toBeCloseTo(yb, 3);
      }
    }
  });

  it("the shader transform equals toRender for every vertex (seam included)", () => {
    const focus = { x: WORLD_C - 300, z: EQ + 200 };
    const cx = 0;
    const d = buildChunkData(field, cx, czEq, 9)!;
    const out = { x: 0, z: 0 };
    for (let v = 0; v < 81; v++) {
      const lx = d.positions[v * 3];
      const lz = d.positions[v * 3 + 2];
      const s = shaderToRender(focus.x, focus.z, cx, czEq, lx, lz);
      toRenderInto(cx * CHUNK + lx, czEq * CHUNK + lz, focus, out);
      expect(s.x).toBeCloseTo(out.x, 4);
      expect(s.z).toBeCloseTo(out.z, 4);
      expect(Math.abs(s.x)).toBeLessThan(5000); // adjacent, not a circumference away
    }
  });

  it("LOD0 chunk build is fast enough to time-slice (< 4 ms in node)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) buildChunkData(field, cxOf(200), czEq, LOD_STEPS[0]);
    const per = (performance.now() - t0) / 5;
    console.log(`[terrain] LOD0 chunk build ${per.toFixed(2)} ms`);
    expect(per).toBeLessThan(4);
  });
});

describe("TerrainManager", () => {
  it("builds nearest-first within budget, culls water, disposes far chunks", () => {
    // a clock that advances 1 ms per read: a 0.5 ms budget allows exactly one build per update
    let t = 0;
    const tm = new TerrainManager(field, () => (t += 1));
    tm.update(100, EQ, 1, 0.5);
    expect(tm.stats.builtThisFrame).toBe(1);
    expect(tm.stats.queued).toBeGreaterThan(0);
    // a real clock: run until the queue drains
    const tm2 = new TerrainManager(field);
    let frames = 0;
    do {
      tm2.update(100, EQ, 1, 1.5);
      frames++;
    } while (tm2.stats.queued > 0 && frames < 2000);
    expect(tm2.stats.queued).toBe(0);
    expect(tm2.stats.meshes).toBeGreaterThan(0);
    expect(tm2.getChunk(0, Math.floor(EQ / CHUNK))?.hasMesh).toBe(true);
    // a water chunk is recorded without a mesh
    const water = tm2.getChunk(3, Math.floor(EQ / CHUNK) + 3);
    if (water) expect(water.hasMesh).toBe(false);
    expect(tm2.group.children.length).toBe(tm2.stats.meshes);
    // sail far away: everything gets disposed
    tm2.update(100 + (VIEW_DISTANCE + DISPOSE_MARGIN + 2 * CHUNK) * 2, EQ, 1, 0);
    expect(tm2.getChunk(0, Math.floor(EQ / CHUNK))).toBeUndefined();
    tm2.disposeAll();
    expect(tm2.group.children.length).toBe(0);
  });

  it("chunkDistance is metric and wrap-aware", () => {
    const cz = Math.floor(EQ / CHUNK);
    expect(TerrainManager.chunkDistance(5, cz * CHUNK + 10, 0, cz)).toBe(0);
    expect(TerrainManager.chunkDistance(WORLD_C - 100, cz * CHUNK + 10, 0, cz)).toBeCloseTo(100 * metricX(cz * CHUNK + 10), 3);
  });
});

describe("ShoreField", () => {
  it("time-sliced build; samples land near the island and water far away", () => {
    const sf = new ShoreField(field, 64, 3000);
    let swapped = false;
    let steps = 0;
    while (!swapped && steps < 100) {
      swapped = sf.step(200, EQ, 0, 0, 1, 8);
      steps++;
    }
    expect(steps).toBe(8);
    expect(sf.revision).toBe(1);
    expect(sf.sampleRender(0, 0, 0, 0)).toBeLessThan(-400); // island centre
    expect(sf.sampleRender(2800, 2800, 0, 0)).toBeGreaterThan(400); // open sea
    // no rebuild while close and unchanged
    expect(sf.step(210, EQ, 10, 0, 1, 8)).toBe(false);
    // tiles changed → rebuild starts
    sf.step(210, EQ, 10, 0, 2, 64);
    expect(sf.revision).toBe(2);
  });
});

describe("PolarIce", () => {
  it("period divides the ice-line circumference; pattern is anchored to the world", () => {
    expect(MX_ICE).toBeCloseTo(Math.cos((70 * Math.PI) / 180), 9);
    const k = ICE_CIRCUMFERENCE / ICE_PERIOD;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    expect(ICE_PERIOD).toBeGreaterThan(1500);
    // world arc of local s=0 is a multiple of the period, for any focus (incl. across the seam)
    for (const fx of [0, 123.4, WORLD_C / 2, WORLD_C - 0.5, WORLD_C + 3]) {
      const s0 = (((fx % WORLD_C) + WORLD_C) % WORLD_C) * MX_ICE + iceShift(fx);
      const r = s0 / ICE_PERIOD;
      expect(Math.abs(r - Math.round(r))).toBeLessThan(1e-6);
    }
    expect(iceProfile(0, 1)).toBeCloseTo(iceProfile(ICE_PERIOD, 1), 6);
  });

  it("places the shelves in render space", () => {
    const ice = new PolarIce();
    ice.update(1000, Z_ICE_N + 500);
    expect(ice.north.visible).toBe(true);
    expect(ice.north.position.z).toBeCloseTo(-500, 6);
    expect(ice.south.visible).toBe(false);
    // the wall face never protrudes onto the water side (local z ≤ 0)
    const wall = ice.north.children[0] as unknown as { geometry: { getAttribute(n: string): { count: number; getZ(i: number): number } } };
    const p = wall.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeLessThanOrEqual(1e-6);
    ice.dispose();
  });
});

describe("frame budget with the real land data (skipped if not generated)", () => {
  // Node-only: reads the generated tiles straight from client/public (no server import).
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/world/land");
  const manifestPath = path.join(dir, "manifest.json");
  const has = fs.existsSync(manifestPath);

  function loadRealLand(): LandField {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const src = new ArrayTileSource("water");
    for (const k of m.allLand ?? []) {
      const [tx, ty] = k.split("_").map(Number);
      src.set(tx, ty, "land");
    }
    for (let ty = 0; ty < TILES_Y; ty++) {
      for (let tx = 0; tx < TILES_X; tx++) {
        const f = path.join(dir, m.version, `t_${tx}_${ty}.bin${m.encoding === "gzip" ? ".gz" : ""}`);
        if (!fs.existsSync(f)) continue;
        const raw = fs.readFileSync(f);
        const buf = m.encoding === "gzip" ? zlib.gunzipSync(raw) : raw;
        src.set(tx, ty, new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      }
    }
    return new LandField(src);
  }

  it.skipIf(!has)("terrain + shore updates average < 2 ms/frame sailing along a coast", () => {
    const land = loadRealLand();
    for (const [name, lon, lat] of [
      ["Jamaica south coast", -77.2, 17.85],
      ["English Channel", -2.0, 50.2],
    ] as const) {
      const tm = new TerrainManager(land);
      const sf = new ShoreField(land);
      let x = xOfLon(lon);
      const z = zOfLat(lat);
      const times: number[] = [];
      for (let frame = 0; frame < 600; frame++) {
        x += 8 / metricX(z); // 8 u/frame ≈ fastest ship at 60 fps
        const t0 = performance.now();
        tm.update(x, z, 1);
        sf.step(x, z, frame * 8, 0, 1); // travel = rendered distance sailed
        times.push(performance.now() - t0);
      }
      const warm = times.slice(120); // initial load burst is sliced too, but skip it for the mean
      const mean = warm.reduce((a, b) => a + b, 0) / warm.length;
      const max = Math.max(...times);
      console.log(`[terrain] ${name}: mean ${mean.toFixed(3)} ms, max ${max.toFixed(2)} ms, meshes ${tm.stats.meshes}`);
      expect(tm.stats.meshes).toBeGreaterThan(0);
      expect(mean).toBeLessThan(2);
      tm.disposeAll();
    }
  });
});
