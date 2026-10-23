import { describe, expect, it } from "vitest";
import { normalizeAngle, shipPhysicsStats, spawnBroadside, stepShip, type ShipInput, type ShipKinematics } from "@shared/physics";
import { geoMetric, torusMetric } from "../metric";
import { toInput } from "../steering";
import {
  BALL_SPEED_PER_SEC,
  DEFAULT_CANNON_RANGE,
  FIRE_RANGE_FACTOR,
  GUN_SIDES,
  beamError,
  chooseSide,
  engage,
  fireTolerance,
  firepower,
  gunAngle,
  inBroadsidePosition,
  leadPoint,
  shouldDisengage,
  type Side,
} from "../tactics";
import { bearingOf, headingForDir, mulberry32 } from "../util";

const W = 10000;
const m = torusMetric(W, W);
const range = DEFAULT_CANNON_RANGE;
/** sim() runs real (metric, wrapping-Earth) physics, so it uses the geo metric near the equator
 *  (z = Z0 + scenario z) where an x unit is ~1 metric unit; the pure tests keep a flat torus. */
const Z0 = 95_000;
const gm = geoMetric;

/** Pure sim: NPC runs engage() → toInput() → stepShip(); target follows `targetInput`. Returns the
 *  first tick at which the NPC is in broadside position, plus fire count. */
function sim(
  npcType: string,
  npc0: ShipKinematics,
  tgtType: string,
  tgt0: ShipKinematics,
  targetInput: (t: ShipKinematics, i: number) => ShipInput,
  ticks: number,
) {
  const ns = shipPhysicsStats(npcType);
  const ts = shipPhysicsStats(tgtType);
  let npc = { ...npc0, z: npc0.z + Z0 };
  let tgt = { ...tgt0, z: tgt0.z + Z0 };
  let first = -1;
  let inPos = 0;
  let fires = 0;
  const rng = mulberry32(3);
  let prevSide: Side | undefined;
  for (let i = 0; i < ticks; i++) {
    const order = engage({ ...npc, maxSpeed: ns.maxSpeed }, tgt, { range, aimError: 0, prevSide }, false, gm, rng);
    prevSide = order.side;
    const inp = toInput(npc, order.heading, order.speed, ns);
    if (order.fire) fires++;
    npc = stepShip(npc, inp, ns);
    tgt = stepShip(tgt, targetInput(tgt, i), ts);
    if (inBroadsidePosition(npc, tgt, range, gm)) {
      inPos++;
      if (first < 0) first = i;
    }
  }
  return { first, inPos, fires, npc, tgt };
}

describe("broadside geometry", () => {
  it("guns point starboard (rotationY + π/2) and port (rotationY − π/2), matching spawnBroadside", () => {
    const r = 0.4;
    const b = spawnBroadside({ x: 0, z: 0, rotationY: r }, 1)[0];
    expect(bearingOf(b.dx, b.dz)).toBeCloseTo(gunAngle(r, "starboard"));
    const pb = spawnBroadside({ x: 0, z: 0, rotationY: r }, 1, "port")[0];
    expect(normalizeAngle(bearingOf(pb.dx, pb.dz) - gunAngle(r, "port"))).toBeCloseTo(0);
    expect(GUN_SIDES).toEqual(["port", "starboard"]);
  });

  it("chooseSide picks the side facing the target, with hysteresis near the bow", () => {
    const self = { x: 5000, z: 5000, rotationY: 0, velocity: 0 };
    // r = 0: bow points −z (north), starboard (+π/2) is +x (east), port is −x (west).
    expect(chooseSide(self, { x: 5400, z: 5000, rotationY: 0, velocity: 0 }, m)).toBe("starboard");
    expect(chooseSide(self, { x: 4600, z: 5000, rotationY: 0, velocity: 0 }, m)).toBe("port");
    // Target almost dead ahead, slightly to port: without history → port; engaged starboard → stay.
    const nearBow = { x: 4990, z: 4600, rotationY: 0, velocity: 0 };
    expect(chooseSide(self, nearBow, m)).toBe("port");
    expect(chooseSide(self, nearBow, m, GUN_SIDES, "starboard")).toBe("starboard");
    // Clearly on the port beam: switch even with history.
    expect(chooseSide(self, { x: 4600, z: 4900, rotationY: 0, velocity: 0 }, m, GUN_SIDES, "starboard")).toBe("port");
  });

  it("per-side reload: the engaged side's reload gates the shot", () => {
    const self = { x: 5000, z: 5000, rotationY: 0, velocity: 0, maxSpeed: 5 };
    const onPort = { x: 4600, z: 5000, rotationY: 0, velocity: 0 };
    expect(engage(self, onPort, { range, aimError: 0 }, { port: false, starboard: true }, m).fire).toBe(true);
    expect(engage(self, onPort, { range, aimError: 0 }, { port: true, starboard: false }, m).fire).toBe(false);
  });

  it("leadPoint leads a moving target by the ball flight time", () => {
    const self = { x: 5000, z: 5000 };
    const still = { x: 5000, z: 4400, rotationY: 0, velocity: 0 };
    const lp0 = leadPoint(self, still, m);
    expect(lp0.dx).toBeCloseTo(0);
    expect(lp0.t).toBeCloseTo(600 / BALL_SPEED_PER_SEC);
    const moving = { ...still, rotationY: headingForDir(1, 0), velocity: -4 }; // east at 240 u/s
    const lp = leadPoint(self, moving, m);
    expect(lp.dx).toBeGreaterThan(100);
    expect(lp.dx).toBeLessThan(240);
  });
});

describe("engage", () => {
  it("reaches broadside position vs a stationary target and fires", () => {
    const r = sim(
      "brigantine",
      { x: 5000, z: 6500, rotationY: 0, velocity: 0 },
      "sloop",
      { x: 5000, z: 5000, rotationY: 1, velocity: 0 },
      () => ({ th: 0, ru: 0, f: 0 }),
      600,
    );
    expect(r.first).toBeGreaterThanOrEqual(0);
    expect(r.first).toBeLessThan(200); // within 10 s
    expect(r.fires).toBeGreaterThan(5);
    // It keeps the target on the beam a good share of the time once there.
    expect(r.inPos / (600 - r.first)).toBeGreaterThan(0.3);
    const d = Math.sqrt(gm.distSq(r.npc.x, r.npc.z, r.tgt.x, r.tgt.z));
    expect(d).toBeGreaterThan(range * 0.4);
    expect(d).toBeLessThan(range * 1.1);
  });

  it("reaches broadside position vs a moving (straight-sailing) target", () => {
    const r = sim(
      "brigantine",
      { x: 5000, z: 6500, rotationY: 0, velocity: 0 },
      "sloop",
      { x: 5000, z: 5000, rotationY: headingForDir(1, 0), velocity: -4 },
      () => ({ th: 1, ru: 0, f: 0 }),
      800,
    );
    expect(r.first).toBeGreaterThanOrEqual(0);
    expect(r.first).toBeLessThan(500); // within 25 s (only 1 unit/frame faster than its prey)
    expect(r.inPos / (800 - r.first)).toBeGreaterThan(0.4); // then holds it abeam on a parallel course
    expect(r.fires).toBeGreaterThan(3);
  });

  it("reaches broadside position vs a circling target", () => {
    const r = sim(
      "galleon",
      { x: 3000, z: 3000, rotationY: 2, velocity: 0 },
      "sloop",
      { x: 4000, z: 4000, rotationY: 0, velocity: -4 },
      (_t, i) => ({ th: 1, ru: i % 40 < 20 ? 1 : 0, f: 0 }),
      800,
    );
    expect(r.first).toBeGreaterThanOrEqual(0);
    expect(r.first).toBeLessThan(500);
  });

  it("F1: fires only when the lead point is inside the hit tolerance (aimError 0) and within fire range", () => {
    const self = { x: 5000, z: 5000, rotationY: 0, velocity: 0, maxSpeed: 5 };
    // Starboard of r=0 is +x (east).
    const onBeam = { x: 5400, z: 5000, rotationY: 0, velocity: 0 };
    expect(Math.abs(beamError(self, onBeam, m))).toBeLessThan(1e-9);
    expect(engage(self, onBeam, { range, aimError: 0 }, false, m).fire).toBe(true);
    expect(engage(self, onBeam, { range, aimError: 0 }, true, m).fire).toBe(false); // reloading
    // A sloop (1 gun) at 400 tolerates atan(16/400) ≈ 2.3°; 5° off the beam is a miss: hold fire.
    const tol = fireTolerance(400, 1);
    expect(tol).toBeCloseTo(Math.atan2(16, 400), 6);
    const offBeam = { x: 5400, z: 5000 - Math.tan(tol * 2) * 400, rotationY: 0, velocity: 0 };
    expect(engage(self, offBeam, { range, aimError: 0 }, false, m).fire).toBe(false);
    // ...but a 4-gun broadside fans ±0.15 rad, so it covers that.
    expect(engage(self, offBeam, { range, aimError: 0, cannonCount: 4 }, false, m).fire).toBe(true);
    // Aim slack (sloppy gunners) widens it too.
    expect(engage(self, offBeam, { range, aimError: 0.2, aimSlack: 0.1 }, false, m).fire).toBe(true);
    // Beyond the hold band but within FIRE_RANGE_FACTOR × range: still a shot.
    const mid = { x: 5000 + range * 1.2, z: 5000, rotationY: 0, velocity: 0 };
    expect(engage(self, mid, { range, aimError: 0 }, false, m).fire).toBe(true);
    const far = { x: 5000 + range * (FIRE_RANGE_FACTOR + 0.1), z: 5000, rotationY: 0, velocity: 0 };
    expect(engage(self, far, { range, aimError: 0 }, false, m).fire).toBe(false);
    const port = { x: 4600, z: 5000, rotationY: 0, velocity: 0 }; // broadsides: port guns since 2026-10-23
    const po = engage(self, port, { range, aimError: 0 }, false, m);
    expect(po.side).toBe("port");
    expect(po.fire).toBe(true);
  });

  it("F1: leads a turning target along its arc", () => {
    const self = { x: 5000, z: 5000 };
    // Target 500 east, sailing north at 4/frame while turning left at full rudder (0.05 rad/frame).
    const straight = { x: 5500, z: 5000, rotationY: 0, velocity: -4 };
    const turning = { ...straight, turnRate: 0.05 };
    const ls = leadPoint(self, straight, m);
    const lt = leadPoint(self, turning, m);
    // Straight: lead purely north. Turning (rotationY increasing = turning toward −x/west): the arc
    // curls west, so the turning lead point is west of (and less far north than) the straight one.
    expect(ls.dx).toBeCloseTo(500, 6);
    expect(lt.dx).toBeLessThan(ls.dx - 20);
    expect(lt.dz).toBeGreaterThan(ls.dz);
    // Exact arc check against stepping the physics one frame at a time.
    const frames = lt.t * 60;
    let x = 0, z = 0, r = 0;
    for (let i = 0; i < Math.round(frames * 100); i++) {
      const f = 1 / 100;
      x += -Math.sin(r) * 4 * f;
      z += -Math.cos(r) * 4 * f;
      r += 0.05 * f;
    }
    expect(lt.dx).toBeCloseTo(500 + x, 0);
    expect(lt.dz).toBeCloseTo(z, 0);
  });

  it("kites: holds a longer range while reloading", () => {
    const self = { x: 5000, z: 5000, rotationY: 0, velocity: -4, maxSpeed: 5 };
    const t = { x: 5000 + range * 0.75, z: 5000, rotationY: 0, velocity: 0 };
    const ready = engage(self, t, { range, aimError: 0 }, false, m);
    const reloading = engage(self, t, { range, aimError: 0 }, true, m);
    // While reloading at 0.75 range the course turns away (opens) relative to the ready course.
    const away = (h: number) => {
      const d = { x: -Math.sin(h), z: -Math.cos(h) };
      return -(d.x * 1 + d.z * 0); // component away from the target (target is +x)
    };
    expect(away(reloading.heading)).toBeGreaterThan(away(ready.heading));
  });
});

describe("disengage rules", () => {
  it("brave ships stay, hurt or outgunned timid ones leave", () => {
    const sloop = firepower("sloop");
    const mow = firepower("man-o-war");
    expect(mow).toBeGreaterThan(sloop * 3);
    expect(shouldDisengage(0.8, 0.9, firepower("galleon"), firepower("galleon"))).toBe(false);
    expect(shouldDisengage(0.2, 0.2, sloop, sloop)).toBe(true); // hurt + timid
    expect(shouldDisengage(1, 0.5, sloop, mow)).toBe(true); // outgunned
    expect(shouldDisengage(0.05, 0.9, mow, mow)).toBe(true);
  });
});
