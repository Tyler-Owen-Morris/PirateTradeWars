import { describe, expect, it } from "vitest";
import { normalizeAngle, shipPhysicsStats, stepShip, type ShipKinematics } from "@shared/physics";
import { torusMetric } from "../metric";
import {
  arbitrate,
  arrive,
  avoidLand,
  evade,
  flee,
  pursue,
  seek,
  toInput,
  toSteer,
  wander,
  withAvoidance,
  type LandQuery,
} from "../steering";
import { headingForDir, moveDir, mulberry32 } from "../util";

const W = 10000;
const m = torusMetric(W, W);
const sloop = shipPhysicsStats("sloop");

function ship(k: ShipKinematics) {
  return { ...k, maxSpeed: sloop.maxSpeed };
}

describe("heading conventions", () => {
  it("rotationY 0 sails north (−z); headingForDir inverts moveDir", () => {
    const d = moveDir(0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-1);
    for (const r of [-3, -1.2, 0, 0.7, 2.5]) {
      const v = moveDir(r);
      expect(normalizeAngle(headingForDir(v.x, v.z) - r)).toBeCloseTo(0, 9);
    }
    // stepShip agrees: full ahead with r = headingForDir(east) moves +x.
    const r = headingForDir(1, 0);
    let s: ShipKinematics = { x: 5000, z: 5000, rotationY: r, velocity: 0 };
    for (let i = 0; i < 20; i++) s = stepShip(s, { th: 1, ru: 0, f: 0 }, sloop);
    expect(s.x).toBeGreaterThan(5100);
    expect(Math.abs(s.z - 5000)).toBeLessThan(1e-6);
  });
});

describe("toInput", () => {
  it("closes a heading error without oscillating, for many start errors", () => {
    for (const target of [Math.PI * 0.9, -2, 1, 0.3, -0.12, 0.05]) {
      let s: ShipKinematics = { x: 5000, z: 5000, rotationY: 0, velocity: 0 };
      let flips = 0;
      let lastRu = 0;
      let settledAt = -1;
      for (let i = 0; i < 100; i++) {
        const inp = toInput(s, target, sloop.maxSpeed, sloop);
        if (inp.ru !== 0 && lastRu !== 0 && inp.ru !== lastRu) flips++;
        if (inp.ru !== 0) lastRu = inp.ru;
        s = stepShip(s, inp, sloop);
        if (settledAt < 0 && Math.abs(normalizeAngle(target - s.rotationY)) <= 0.075 + 1e-9) settledAt = i;
      }
      expect(flips).toBe(0);
      expect(settledAt).toBeGreaterThanOrEqual(0);
      // 3 rad/s → at most ~π/0.15 ≈ 21 ticks for a half turn.
      expect(settledAt).toBeLessThanOrEqual(22);
      expect(Math.abs(normalizeAngle(target - s.rotationY))).toBeLessThanOrEqual(0.075 + 1e-9);
    }
  });

  it("deadband: tiny errors give ru = 0; shortest arc across ±π", () => {
    expect(toInput({ rotationY: 0, velocity: 0 }, 0.05, 0, sloop).ru).toBe(0);
    expect(toInput({ rotationY: 0, velocity: 0 }, 0.2, 0, sloop).ru).toBe(1);
    expect(toInput({ rotationY: 0, velocity: 0 }, -0.2, 0, sloop).ru).toBe(-1);
    expect(toInput({ rotationY: 3.1, velocity: 0 }, -3.1, 0, sloop).ru).toBe(1);
  });

  it("throttle reaches and holds the desired speed band", () => {
    let s: ShipKinematics = { x: 0, z: 0, rotationY: 0, velocity: 0 };
    for (let i = 0; i < 60; i++) s = stepShip(s, toInput(s, 0, sloop.maxSpeed, sloop), sloop);
    expect(-s.velocity).toBeCloseTo(sloop.maxSpeed, 5);
    // ask for 2: speed settles around 2 (± band + one tick of decel)
    const speeds: number[] = [];
    for (let i = 0; i < 100; i++) {
      s = stepShip(s, toInput(s, 0, 2, sloop), sloop);
      if (i > 40) speeds.push(-s.velocity);
    }
    for (const v of speeds) expect(Math.abs(v - 2)).toBeLessThan(0.8);
    // ask for 0: coasts to a stop
    for (let i = 0; i < 100; i++) s = stepShip(s, toInput(s, 0, 0, sloop), sloop);
    expect(s.velocity).toBe(0);
  });
});

describe("behaviours", () => {
  const me = ship({ x: 5000, z: 5000, rotationY: 0, velocity: -2 });

  it("seek / flee point toward / away from the target at max speed, wrap-aware", () => {
    const v = seek(me, 5000, 4000, m);
    expect(v.z).toBeCloseTo(-sloop.maxSpeed);
    const f = flee(me, 5000, 4000, m);
    expect(f.z).toBeCloseTo(sloop.maxSpeed);
    // across the seam: target at x=100 from x=9900 is +200 east
    const edge = ship({ x: 9900, z: 5000, rotationY: 0, velocity: 0 });
    expect(seek(edge, 100, 5000, m).x).toBeGreaterThan(0);
  });

  it("arrive slows down near the target and stops inside the stop radius", () => {
    expect(Math.hypot(arrive(me, 5000, 4000, m).x, arrive(me, 5000, 4000, m).z)).toBeCloseTo(sloop.maxSpeed);
    const near = arrive(me, 5000, 4850, m, 300, 30);
    expect(Math.hypot(near.x, near.z)).toBeLessThan(sloop.maxSpeed * 0.6);
    const stop = arrive(me, 5000, 4990, m, 300, 30);
    expect(Math.hypot(stop.x, stop.z)).toBe(0);
  });

  it("pursue leads a crossing target; evade runs from its future position", () => {
    // Target 1000 north, sailing east at 4.
    const target = { x: 5000, z: 4000, rotationY: headingForDir(1, 0), velocity: -4 };
    const v = pursue(me, target, m);
    expect(v.x).toBeGreaterThan(0); // aims ahead (east) of it
    expect(v.z).toBeLessThan(0);
    const e = evade(me, target, m);
    expect(e.x).toBeLessThan(0);
    expect(e.z).toBeGreaterThan(0);
  });

  it("wander is deterministic for a seeded rng and stays bounded", () => {
    const a = { angle: 0 };
    const b = { angle: 0 };
    const ra = mulberry32(7);
    const rb = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const va = wander(me, a, ra);
      const vb = wander(me, b, rb);
      expect(va).toEqual(vb);
      expect(Math.abs(a.angle)).toBeLessThanOrEqual(1.2);
    }
  });

  it("arbitrate spends the magnitude budget in priority order", () => {
    const out = arbitrate(
      [
        { v: { x: 3, z: 0 }, weight: 1 },
        { v: { x: 0, z: 3 }, weight: 1 },
      ],
      4,
    );
    expect(out.x).toBeCloseTo(3);
    expect(out.z).toBeCloseTo(1);
    expect(arbitrate([{ v: null, weight: 1 }], 4)).toEqual({ x: 0, z: 0 });
  });

  it("toSteer keeps heading for a zero vector", () => {
    expect(toSteer(me, { x: 0, z: 0 })).toEqual({ heading: me.rotationY, speed: 0 });
  });
});

describe("land avoidance", () => {
  // A straight coast: land for z < 4000 (north), water south of it. normal points to water (+z).
  const coast: LandQuery = {
    distance: (_x, z) => z - 4000,
    normal: () => ({ nx: 0, nz: 1 }),
  };

  it("is silent in open water", () => {
    const s = ship({ x: 5000, z: 5000, rotationY: 0, velocity: -4 });
    expect(avoidLand(s, coast, m)).toBeNull();
  });

  it("feelers turn a ship heading at the coast along it, and the ship never runs aground", () => {
    let s: ShipKinematics = { x: 5000, z: 4400, rotationY: 0.2, velocity: -4 }; // heading north-ish, at the coast
    let minD = Infinity;
    for (let i = 0; i < 200; i++) {
      const st = ship(s);
      const desired = seek(st, 5000, 0, m); // wants to sail through the land
      const v = withAvoidance(desired, avoidLand(st, coast, m));
      const steer = toSteer(st, v);
      s = stepShip(s, toInput(s, steer.heading, steer.speed, sloop), sloop);
      minD = Math.min(minD, coast.distance(s.x, s.z));
    }
    expect(minD).toBeGreaterThan(0);
  });
});
