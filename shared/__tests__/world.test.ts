// Wrapping-Earth geometry, land sampling and no-damage coast collision (docs/world/WORLD_SPEC.md §2–§4).
import { describe, expect, it } from "vitest";
import {
  ICE_LAT,
  WORLD_C,
  WORLD_H,
  WORLD_R,
  Z_ICE_N,
  Z_ICE_S,
  bearingDeg,
  compassHeading,
  latOf,
  lonOf,
  metricDelta,
  metricDistSq,
  metricX,
  rotationForHeading,
  xOfLon,
  zOfLat,
} from "@shared/world/geo";
import {
  ALWAYS_WATER_TEST_FIELD,
  ArrayTileSource,
  LandField,
  PX,
  SDF_FAR,
  TILE,
  TILES_X,
  TILES_Y,
  buildSyntheticLand,
  tileOf,
} from "@shared/world/land";
import {
  FORWARD_ACCEL,
  ballHitsLand,
  normalizeAngle,
  shipPhysicsStats,
  stepShip,
  type ShipInput,
  type ShipKinematics,
} from "@shared/physics";
import { SHIP_TYPES } from "@shared/gameConstants";

const EQ = WORLD_H / 2;
const W: ShipInput = { th: 1, ru: 0, f: 0 };
const sloop = shipPhysicsStats(SHIP_TYPES.SLOOP);
const galleon = shipPhysicsStats(SHIP_TYPES.GALLEON);

describe("geo", () => {
  it("constants match the spec", () => {
    expect(WORLD_C).toBe(400_000);
    expect(WORLD_H).toBe(200_000);
    expect(WORLD_R).toBeCloseTo(63_661.98, 1);
    expect(ICE_LAT).toBe(70);
    expect(Z_ICE_N).toBeCloseTo(22_222.2, 1);
    expect(Z_ICE_S).toBeCloseTo(177_777.8, 1);
  });

  it("lon/lat round-trip; north pole is z = 0", () => {
    expect(lonOf(0)).toBe(-180);
    expect(lonOf(WORLD_C / 2)).toBe(0);
    expect(xOfLon(-76.84)).toBeCloseTo(((180 - 76.84) / 360) * WORLD_C, 6);
    expect(lonOf(xOfLon(123.4))).toBeCloseTo(123.4, 9);
    expect(latOf(0)).toBe(90);
    expect(latOf(WORLD_H)).toBe(-90);
    expect(zOfLat(0)).toBe(EQ);
    expect(latOf(zOfLat(17.94))).toBeCloseTo(17.94, 9);
  });

  it("metricX is cos(lat)", () => {
    expect(metricX(EQ)).toBeCloseTo(1, 12);
    expect(metricX(zOfLat(60))).toBeCloseTo(0.5, 12);
    expect(metricX(zOfLat(-60))).toBeCloseTo(0.5, 12);
    expect(metricX(Z_ICE_N)).toBeCloseTo(Math.cos((70 * Math.PI) / 180), 12);
    expect(metricX(0)).toBeGreaterThan(0); // clamped, never 0
  });

  it("metric distance scales x by cos(mid lat) and is seam-aware", () => {
    const z60 = zOfLat(60);
    expect(metricDistSq(1000, z60, 1100, z60)).toBeCloseTo(50 * 50, 6);
    expect(metricDistSq(WORLD_C - 30, EQ, 10, EQ)).toBeCloseTo(40 * 40, 6);
    const d = metricDelta(WORLD_C - 30, EQ, 10, EQ + 5);
    expect(d.dx).toBeCloseTo(40, 6);
    expect(d.dz).toBe(5);
  });

  it("compass heading: rotationY 0 = north, −π/2 = east, clockwise", () => {
    expect(compassHeading(0)).toBe(0);
    expect(compassHeading(-Math.PI / 2)).toBeCloseTo(90, 9);
    expect(compassHeading(Math.PI)).toBeCloseTo(180, 9);
    expect(compassHeading(Math.PI / 2)).toBeCloseTo(270, 9);
    for (const h of [0, 10, 90, 179, 270, 359]) expect(compassHeading(rotationForHeading(h))).toBeCloseTo(h, 9);
    // forward motion actually goes that way: heading 90 → +x
    const s = stepShip({ x: 1000, z: EQ, rotationY: rotationForHeading(90), velocity: -4 }, W, sloop);
    expect(s.x).toBeGreaterThan(1000);
    expect(s.z).toBeCloseTo(EQ, 6);
  });

  it("bearing a→b uses the metric delta", () => {
    expect(bearingDeg(1000, EQ, 1000, EQ - 100)).toBeCloseTo(0, 9); // north
    expect(bearingDeg(1000, EQ, 1100, EQ)).toBeCloseTo(90, 9);
    expect(bearingDeg(10, EQ, WORLD_C - 10, EQ)).toBeCloseTo(270, 9); // west across the seam
  });
});

describe("LandField", () => {
  it("open ocean reads as far water; the ice is land", () => {
    const f = ALWAYS_WATER_TEST_FIELD;
    expect(f.distance(1234, EQ)).toBe(SDF_FAR);
    expect(f.distance(1234, Z_ICE_N + 100)).toBeCloseTo(100, 9);
    expect(f.distance(1234, Z_ICE_N - 50)).toBeCloseTo(-50, 9);
    expect(f.distance(1234, Z_ICE_S - 30)).toBeCloseTo(30, 9);
    expect(f.distance(1234, 10)).toBeLessThan(-20000);
    const nN = f.normal(5000, Z_ICE_N + 100);
    expect(nN.nz).toBeCloseTo(1, 6); // toward water = south (+z)
    const nS = f.normal(5000, Z_ICE_S - 100);
    expect(nS.nz).toBeCloseTo(-1, 6);
    expect(f.normal(5000, EQ)).toEqual({ nx: 0, nz: 0 }); // flat open sea
    expect(ballHitsLand(f, 5000, Z_ICE_N - 1)).toBe(true);
    expect(ballHitsLand(f, 5000, EQ)).toBe(false);
  });

  it("samples a synthetic island bilinearly with a metric outward normal", () => {
    const cx = 150_000;
    const r = 2000;
    const { field } = buildSyntheticLand([{ kind: "circle", x: cx, z: EQ, r }]);
    expect(field.distance(cx, EQ)).toBe(-SDF_FAR); // saturated deep inland
    for (const d of [-200, -50, 0, 50, 200, 400]) {
      expect(field.distance(cx + r + d, EQ)).toBeGreaterThan(d - PX / 4);
      expect(field.distance(cx + r + d, EQ)).toBeLessThan(d + PX / 4);
      expect(field.distance(cx, EQ - r - d)).toBeCloseTo(d, -1);
    }
    expect(field.distance(cx + r + 2000, EQ)).toBe(SDF_FAR);
    const n = field.normal(cx + r + 30, EQ);
    expect(n.nx).toBeGreaterThan(0.99);
    const m = field.normal(cx, EQ + r + 30);
    expect(m.nz).toBeGreaterThan(0.99);
  });

  it("metric: an island at lat 60 is twice as wide in x coordinates", () => {
    const z60 = zOfLat(60);
    const { field } = buildSyntheticLand([{ kind: "circle", x: 50_000, z: z60, r: 1000 }]);
    // metric radius 1000 → 2000 coordinate units east, 1000 south
    expect(Math.abs(field.distance(52_000, z60))).toBeLessThan(PX / 2);
    expect(Math.abs(field.distance(50_000, z60 + 1000))).toBeLessThan(PX / 2);
  });

  it("x wraps across the seam; missing tiles read as water and ready() is false", () => {
    const { field } = buildSyntheticLand([{ kind: "circle", x: 100, z: EQ, r: 1000 }]);
    expect(field.distance(WORLD_C - 500, EQ)).toBeCloseTo(-400, -1);
    expect(field.distance(WORLD_C - 1500, EQ)).toBe(SDF_FAR); // 600 from the coast: saturated
    const src = new ArrayTileSource();
    const f = new LandField(src);
    expect(f.distance(5000, EQ)).toBe(SDF_FAR);
    expect(f.ready(5000, EQ, 100)).toBe(false);
    const { tx, ty } = tileOf(5000, EQ);
    src.set(tx, ty, "land");
    expect(f.distance((tx + 0.5) * TILE * PX, (ty + 0.5) * TILE * PX)).toBe(-SDF_FAR);
    // a radius spanning the seam needs the tiles on both sides
    for (let y = 0; y < TILES_Y; y++) for (let x = 0; x < TILES_X; x++) src.set(x, y, "water");
    expect(f.ready(5, EQ, 3000)).toBe(true);
    src.set(TILES_X - 1, ty, undefined);
    expect(f.ready(5, EQ, 3000)).toBe(false);
    expect(f.ready(TILE * PX * 5, EQ, 3000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Collision (WORLD_SPEC §4.3)
// ---------------------------------------------------------------------------------------------

// A straight north-south coast: land for x in [COAST_X, COAST_X + 10000], z within ±20000 of EQ.
const COAST_X = 100_000;
const coast = buildSyntheticLand([{ kind: "rect", x0: COAST_X, z0: EQ - 20_000, x1: COAST_X + 10_000, z1: EQ + 20_000 }]).field;

function runTicks(s: ShipKinematics, n: number, input: ShipInput | ((s: ShipKinematics, i: number) => ShipInput), stats = sloop, land = coast, each?: (s: ShipKinematics) => void) {
  for (let i = 0; i < n; i++) {
    s = stepShip(s, typeof input === "function" ? input(s, i) : input, stats, land);
    each?.(s);
  }
  return s;
}

describe("coast collision (no damage)", () => {
  it("head-on: the ship stops at the coast and never enters it", () => {
    let minD = Infinity;
    const s = runTicks({ x: COAST_X - 1000, z: EQ, rotationY: rotationForHeading(90), velocity: 0 }, 300, W, sloop, coast, (st) => {
      minD = Math.min(minD, coast.distance(st.x, st.z));
    });
    expect(Math.abs(s.velocity)).toBeLessThanOrEqual(FORWARD_ACCEL + 1e-9);
    expect(minD).toBeGreaterThan(sloop.hullRadius - 2);
    expect(s.x).toBeLessThan(COAST_X - sloop.hullRadius + 2);
    expect(s.x).toBeGreaterThan(COAST_X - sloop.hullRadius - 10);
    expect(s.rotationY).toBeCloseTo(rotationForHeading(90), 12); // heading unchanged
  });

  it("glancing: a ship 10° off the coast slides along it keeping its speed", () => {
    const start: ShipKinematics = { x: COAST_X - 100, z: EQ + 5000, rotationY: rotationForHeading(10), velocity: -sloop.maxSpeed };
    let touched = 0;
    let minV = Infinity;
    const s = runTicks(start, 400, W, sloop, coast, (st) => {
      const d = coast.distance(st.x, st.z);
      expect(d).toBeGreaterThan(0);
      if (d < sloop.hullRadius + 1) {
        touched++;
        minV = Math.min(minV, Math.abs(st.velocity));
      }
    });
    expect(touched).toBeGreaterThan(100); // spent most of the run against the coast
    expect(minV).toBeGreaterThan(0.9 * sloop.maxSpeed);
    // made good progress north along the coast (≥ 80% of full speed · cos 10°)
    expect(start.z - s.z).toBeGreaterThan(0.8 * 400 * 3 * sloop.maxSpeed * Math.cos((10 * Math.PI) / 180));
  });

  it("the polar ice blocks ships (north and south)", () => {
    const north = runTicks({ x: 5000, z: Z_ICE_N + 2000, rotationY: 0, velocity: 0 }, 1000, W, galleon, ALWAYS_WATER_TEST_FIELD, (st) => {
      expect(st.z).toBeGreaterThan(Z_ICE_N + galleon.hullRadius - 2);
    });
    expect(north.z).toBeLessThan(Z_ICE_N + galleon.hullRadius + 2);
    const south = runTicks({ x: 5000, z: Z_ICE_S - 2000, rotationY: Math.PI, velocity: 0 }, 1000, W, galleon, ALWAYS_WATER_TEST_FIELD, (st) => {
      expect(st.z).toBeLessThan(Z_ICE_S - galleon.hullRadius + 2);
    });
    expect(south.z).toBeGreaterThan(Z_ICE_S - galleon.hullRadius - 2);
  });

  it("no penetration over 1000 steps of a ship ramming an island from all sides (deterministic)", () => {
    const cx = 150_000;
    const { field: island } = buildSyntheticLand([
      { kind: "circle", x: cx, z: EQ, r: 1500 },
      { kind: "circle", x: cx + 1800, z: EQ + 900, r: 700 }, // concave notch where the circles meet
    ]);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    // Steer toward the island centre with noise: keeps hitting the coast at varied angles.
    const pilot = (st: ShipKinematics): ShipInput => {
      const want = Math.atan2(-(cx - st.x), -(EQ - st.z)); // rotationY whose forward motion points at the centre
      const err = normalizeAngle(want - st.rotationY);
      const noise = rnd();
      const ru = noise < 0.2 ? -1 : noise < 0.4 ? 1 : err > 0.05 ? 1 : err < -0.05 ? -1 : 0;
      return { th: rnd() < 0.9 ? 1 : 0, ru: ru as -1 | 0 | 1, f: 0 };
    };
    for (const stats of [sloop, galleon, shipPhysicsStats(SHIP_TYPES.DREADNAUGHT)]) {
      seed = 7;
      let minD = Infinity;
      let contacts = 0;
      const run = () =>
        runTicks({ x: cx - 1700, z: EQ, rotationY: rotationForHeading(90), velocity: 0 }, 1000, pilot, stats, island, (st) => {
          const d = island.distance(st.x, st.z);
          minD = Math.min(minD, d);
          if (d < stats.hullRadius + 1) contacts++;
        });
      const a = run();
      expect(minD).toBeGreaterThan(stats.hullRadius - 2);
      expect(contacts).toBeGreaterThan(50);
      seed = 7;
      expect(run()).toEqual(a); // deterministic with land
    }
  });

  it("without a land argument there is no collision (pure kinematics)", () => {
    const s = stepShip({ x: COAST_X + 10, z: EQ, rotationY: rotationForHeading(90), velocity: -4 }, W, sloop);
    expect(s.x).toBeCloseTo(COAST_X + 22, 6);
  });
});
