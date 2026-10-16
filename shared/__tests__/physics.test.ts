import { describe, expect, it } from "vitest";
import {
  BALL_LIFETIME_MS,
  BALL_SPAWN_OFFSET,
  BALL_SPEED,
  BALL_SPREAD,
  NEUTRAL_INPUT,
  SHIP_HIT_RADIUS,
  SUBSTEPS,
  TICK_DT,
  TICK_HZ,
  TURN_SPEED,
  ballPositionAt,
  lerpAngle,
  lerpWrapped,
  normalizeAngle,
  physicsStatsFromMaxSpeed,
  segmentHitsCircle,
  shipPhysicsStats,
  spawnBroadside,
  stepBall,
  stepShip,
  wrap,
  wrappedDelta,
  wrappedDistSq,
  type ShipInput,
  type ShipKinematics,
} from "@shared/physics";
import { MAP_WIDTH, SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";
import { WORLD_C, WORLD_H, metricX, zOfLat } from "@shared/world/geo";

const W: ShipInput = { th: 1, ru: 0, f: 0 };
const S: ShipInput = { th: -1, ru: 0, f: 0 };
const LEFT: ShipInput = { th: 0, ru: 1, f: 0 };
const RIGHT: ShipInput = { th: 0, ru: -1, f: 0 };
const sloop = shipPhysicsStats(SHIP_TYPES.SLOOP);
// On the equator (metricX = 1), mid-ocean.
const EQ = WORLD_H / 2;
const start: ShipKinematics = { x: 200000, z: EQ, rotationY: 0, velocity: 0 };

function run(state: ShipKinematics, inputs: ShipInput[], stats = sloop): ShipKinematics {
  return inputs.reduce((s, i) => stepShip(s, i, stats), state);
}
const repeat = (i: ShipInput, n: number) => Array.from({ length: n }, () => i);

/** Deterministic pseudo-random input sequence (LCG). */
function randomInputs(n: number, seed = 42): ShipInput[] {
  let x = seed;
  const next = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x);
  const pick = () => ((next() % 3) - 1) as -1 | 0 | 1;
  return Array.from({ length: n }, () => ({ th: pick(), ru: pick(), f: (next() % 2) as 0 | 1 }));
}

describe("timing constants", () => {
  it("20 Hz with 3 sub-steps of 1/60 s", () => {
    expect(TICK_HZ).toBe(20);
    expect(TICK_DT).toBeCloseTo(0.05, 12);
    expect(SUBSTEPS).toBe(3);
  });
});

describe("shipPhysicsStats", () => {
  it("derives maxSpeed from SHIP_STATS and falls back to sloop", () => {
    expect(shipPhysicsStats(SHIP_TYPES.DREADNAUGHT).maxSpeed).toBe(SHIP_STATS[SHIP_TYPES.DREADNAUGHT].speed);
    expect(shipPhysicsStats("nope").maxSpeed).toBe(SHIP_STATS[SHIP_TYPES.SLOOP].speed);
  });
});

describe("stepShip", () => {
  it("is pure (does not mutate input state)", () => {
    const s = { ...start };
    const out = stepShip(s, W, sloop);
    expect(s).toEqual(start);
    expect(out).not.toBe(s);
  });

  it("is deterministic: same inputs → identical states", () => {
    const inputs = randomInputs(2000);
    const a = run(start, inputs);
    const b = run(start, inputs);
    expect(a).toEqual(b);
    expect(Object.is(a.x, b.x) && Object.is(a.z, b.z) && Object.is(a.rotationY, b.rotationY)).toBe(true);
  });

  it("W (th=1) reaches exactly -maxSpeed and stays there", () => {
    for (const type of Object.values(SHIP_TYPES)) {
      const stats = shipPhysicsStats(type);
      const s = run(start, repeat(W, 40), stats);
      expect(s.velocity).toBe(-stats.maxSpeed);
    }
  });

  it("W accelerates at 0.15/frame (0.45 per tick)", () => {
    expect(stepShip(start, W, sloop).velocity).toBeCloseTo(-0.45, 10);
  });

  it("S (th=-1) reaches exactly +0.5 * maxSpeed", () => {
    const s = run(start, repeat(S, 40));
    expect(s.velocity).toBe(sloop.maxSpeed * 0.5);
    // and S from full ahead also ends at +0.5*max (never overshoots)
    const s2 = run({ ...start, velocity: -sloop.maxSpeed }, repeat(S, 80));
    expect(s2.velocity).toBe(sloop.maxSpeed * 0.5);
  });

  it("coasting decays monotonically to exactly 0 (forward and reverse)", () => {
    for (const v0 of [-sloop.maxSpeed, sloop.maxSpeed * 0.5, -9, 0.01]) {
      let s: ShipKinematics = { ...start, velocity: v0 };
      let ticks = 0;
      while (s.velocity !== 0 && ticks < 500) {
        const next = stepShip(s, NEUTRAL_INPUT, sloop);
        expect(Math.abs(next.velocity)).toBeLessThan(Math.abs(s.velocity));
        expect(Math.sign(next.velocity) * Math.sign(v0)).toBeGreaterThanOrEqual(0); // no sign flip
        s = next;
        ticks++;
      }
      expect(s.velocity).toBe(0);
      expect(ticks).toBeLessThan(100);
    }
  });

  it("a stopped ship with no input does not move", () => {
    expect(run(start, repeat(NEUTRAL_INPUT, 10))).toEqual(start);
  });

  it("turn rate: 0.05 rad per frame = 0.15 rad per tick = 3 rad/s; left +, right -", () => {
    expect(stepShip(start, LEFT, sloop).rotationY).toBeCloseTo(3 * TURN_SPEED, 12);
    expect(stepShip(start, RIGHT, sloop).rotationY).toBeCloseTo(-3 * TURN_SPEED, 12);
    expect(run(start, repeat(LEFT, TICK_HZ)).rotationY).toBeCloseTo(3, 9); // 1 s
  });

  it("rotation stays normalized to [-π, π)", () => {
    const s = run(start, repeat(LEFT, 500));
    expect(s.rotationY).toBeGreaterThanOrEqual(-Math.PI);
    expect(s.rotationY).toBeLessThan(Math.PI);
  });

  it("forward (negative velocity) at rotationY=0 moves toward -z by |v| per frame", () => {
    const s = stepShip({ ...start, velocity: -4 }, W, sloop);
    expect(s.x).toBeCloseTo(200000, 9);
    expect(s.z).toBeCloseTo(EQ - 12, 9);
  });

  it("wraps x across the seam; z does not wrap", () => {
    expect(MAP_WIDTH).toBe(WORLD_C);
    // heading (sin(-π/2), cos(-π/2)) = (-1, 0); negative velocity → +x (east)
    const s = stepShip({ x: WORLD_C - 5, z: EQ, rotationY: -Math.PI / 2, velocity: -4 }, W, sloop);
    expect(s.x).toBeCloseTo(7, 6);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(WORLD_C);
    // west across the seam the other way
    const w = stepShip({ x: 3, z: EQ, rotationY: Math.PI / 2, velocity: -4 }, W, sloop);
    expect(w.x).toBeCloseTo(WORLD_C - 9, 6);
    // z is clamped, never wrapped (only reachable without a land field; the ice stops ships)
    const n = stepShip({ x: 50, z: 3, rotationY: 0, velocity: -4 }, W, sloop);
    expect(n.z).toBe(0);
  });

  it("metric motion: heading east at lat 60 advances x twice as fast in coordinates", () => {
    const z60 = zOfLat(60);
    expect(metricX(z60)).toBeCloseTo(0.5, 12);
    const east = { rotationY: -Math.PI / 2, velocity: -4 };
    const eq = run({ x: 1000, z: EQ, ...east }, repeat(W, 20));
    const hi = run({ x: 1000, z: z60, ...east }, repeat(W, 20));
    expect(eq.z).toBeCloseTo(EQ, 9);
    expect(hi.z).toBeCloseTo(z60, 9);
    expect(hi.x - 1000).toBeCloseTo(2 * (eq.x - 1000), 6);
    // north/south speed is unchanged by latitude
    const nEq = run({ x: 1000, z: EQ, rotationY: 0, velocity: -4 }, repeat(W, 20));
    const nHi = run({ x: 1000, z: z60, rotationY: 0, velocity: -4 }, repeat(W, 20));
    expect(EQ - nEq.z).toBeCloseTo(z60 - nHi.z, 9);
  });

  it("clamps malformed input values", () => {
    const bad = { th: 7, ru: -99, f: 1 } as unknown as ShipInput;
    expect(stepShip(start, bad, sloop)).toEqual(stepShip(start, { th: 1, ru: -1, f: 1 }, sloop));
    const nan = { th: NaN, ru: NaN, f: 0 } as unknown as ShipInput;
    expect(stepShip(start, nan, sloop)).toEqual(start);
  });

  it("respects explicit stats (e.g. after an upgrade lowers maxSpeed)", () => {
    const slow = physicsStatsFromMaxSpeed(2);
    const s = run({ ...start, velocity: -9 }, repeat(W, 30), slow);
    expect(s.velocity).toBe(-2);
  });
});

describe("wrap helpers", () => {
  it("wrap keeps values in [0, size)", () => {
    expect(wrap(10005, 10000)).toBe(5);
    expect(wrap(-5, 10000)).toBe(9995);
    expect(wrap(10000, 10000)).toBe(0);
    expect(wrap(-1e-17, 10000)).toBeLessThan(10000);
  });

  it("wrappedDelta takes the shortest signed path", () => {
    expect(wrappedDelta(100, 200, 10000)).toBe(100);
    expect(wrappedDelta(200, 100, 10000)).toBe(-100);
    expect(wrappedDelta(9990, 10, 10000)).toBe(20);
    expect(wrappedDelta(10, 9990, 10000)).toBe(-20);
    expect(Math.abs(wrappedDelta(0, 5000, 10000))).toBe(5000);
  });

  it("wrappedDistSq (deprecated) is the metric, x-seam-aware distance", () => {
    expect(wrappedDistSq(WORLD_C - 5, EQ, 5, EQ + 10)).toBeCloseTo(200, 4);
    expect(wrappedDistSq(0, EQ, 3, EQ + 4)).toBeCloseTo(25, 6);
  });

  it("lerpWrapped interpolates across the seam", () => {
    expect(lerpWrapped(9990, 10, 0.5, 10000)).toBeCloseTo(0, 9);
    expect(lerpWrapped(9990, 10, 0.25, 10000)).toBeCloseTo(9995, 9);
    expect(lerpWrapped(10, 9990, 0.75, 10000)).toBeCloseTo(9995, 9);
    expect(lerpWrapped(100, 200, 0.5, 10000)).toBe(150);
  });

  it("normalizeAngle / lerpAngle use the shortest arc", () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2, 9);
    // from 170° to -170° should pass through 180°, not 0°
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    expect(Math.abs(lerpAngle(a, b, 0.5))).toBeCloseTo(Math.PI, 9);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("cannonballs", () => {
  it("constants match the old server", () => {
    expect(BALL_SPEED).toBe(15);
    expect(BALL_LIFETIME_MS).toBe(3000);
    expect(SHIP_HIT_RADIUS).toBe(20);
  });

  it("spawnBroadside: count, spread and offset identical to old fireCannonBall", () => {
    const ship = { x: 1000, z: EQ, rotationY: 0.3 }; // equator: metric offsets == coordinate offsets
    for (let n = 1; n <= 5; n++) {
      const balls = spawnBroadside(ship, n);
      expect(balls).toHaveLength(n);
      balls.forEach((b, i) => {
        const angle = ship.rotationY + Math.PI / 2 + (i - (n - 1) / 2) * BALL_SPREAD;
        expect(b.dx).toBeCloseTo(Math.sin(angle), 12);
        expect(b.dz).toBeCloseTo(Math.cos(angle), 12);
        expect(b.x).toBeCloseTo(ship.x + Math.sin(angle) * BALL_SPAWN_OFFSET, 6);
        expect(b.z).toBeCloseTo(ship.z + Math.cos(angle) * BALL_SPAWN_OFFSET, 9);
      });
      if (n > 1) {
        const first = Math.atan2(balls[0].dx, balls[0].dz);
        const last = Math.atan2(balls[n - 1].dx, balls[n - 1].dz);
        expect(normalizeAngle(last - first)).toBeCloseTo((n - 1) * BALL_SPREAD, 9);
      }
    }
    expect(spawnBroadside(ship, 0)).toHaveLength(0);
  });

  it("spawn positions wrap", () => {
    const [b] = spawnBroadside({ x: WORLD_C - 5, z: EQ, rotationY: 0 }, 1); // broadside points +x
    expect(b.x).toBeCloseTo(5, 9);
  });

  it("spawn offset is metric (x offset doubles at lat 60)", () => {
    const [b] = spawnBroadside({ x: 1000, z: zOfLat(60), rotationY: 0 }, 1);
    expect(b.x).toBeCloseTo(1000 + 2 * BALL_SPAWN_OFFSET, 6);
  });

  it("ballPositionAt is analytic and matches stepBall (also on a diagonal across latitudes)", () => {
    const ball = { x: 100, z: EQ, dx: 1, dz: 0 };
    expect(ballPositionAt(ball, 1).x).toBeCloseTo(100 + 900, 9);
    for (const b of [ball, { x: 5000, z: zOfLat(55), dx: Math.SQRT1_2, dz: -Math.SQRT1_2 }]) {
      let pos = { x: b.x, z: b.z };
      for (let i = 0; i < 60; i++) pos = stepBall(pos, b, TICK_DT);
      const analytic = ballPositionAt(b, 60 * TICK_DT);
      expect(pos.x).toBeCloseTo(analytic.x, 4);
      expect(pos.z).toBeCloseTo(analytic.z, 6);
    }
    // wraps
    expect(ballPositionAt({ x: WORLD_C - 100, z: EQ, dx: 1, dz: 0 }, 1).x).toBeCloseTo(800, 6);
    // metric: due east at lat 60 covers 2x the coordinates
    expect(ballPositionAt({ x: 0, z: zOfLat(60), dx: 1, dz: 0 }, 1).x).toBeCloseTo(1800, 6);
  });
});

describe("segmentHitsCircle (metric)", () => {
  const Z = EQ; // equator: metric == coordinates
  it("hits when the segment passes through the circle", () => {
    expect(segmentHitsCircle(0, Z, 200, Z, 100, Z + 10, 20)).toBe(true);
  });
  it("misses when the segment passes beside it", () => {
    expect(segmentHitsCircle(0, Z, 200, Z, 100, Z + 30, 20)).toBe(false);
  });
  it("misses when the circle is beyond the segment end", () => {
    expect(segmentHitsCircle(0, Z, 50, Z, 100, Z, 20)).toBe(false);
  });
  it("hits when the whole segment is inside the circle", () => {
    expect(segmentHitsCircle(98, Z, 102, Z, 100, Z, 20)).toBe(true);
  });
  it("hits a zero-length segment inside the circle", () => {
    expect(segmentHitsCircle(105, Z, 105, Z, 100, Z, 20)).toBe(true);
  });
  it("hits across the seam (segment wraps)", () => {
    // ball moves from x=C-10 to x=15 (wrapped), ship sits at x=2
    expect(segmentHitsCircle(WORLD_C - 10, Z, 15, Z, 2, Z + 5, 20)).toBe(true);
  });
  it("hits across the seam (ship on the other side)", () => {
    expect(segmentHitsCircle(5, Z, 40, Z, WORLD_C - 5, Z, 20)).toBe(true);
  });
  it("does not hit a far-away mirror image", () => {
    expect(segmentHitsCircle(5, Z, 40, Z, 5000, Z, 20)).toBe(false);
  });
  it("uses metric x: at lat 60 a 30-coordinate x gap is only 15 metric units", () => {
    const z60 = zOfLat(60);
    expect(segmentHitsCircle(100, z60 - 50, 100, z60 + 50, 130, z60, 20)).toBe(true);
    expect(segmentHitsCircle(100, z60 - 50, 100, z60 + 50, 145, z60, 20)).toBe(false);
  });
});
