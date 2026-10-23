// Broadsides (2026-10-23): port + starboard batteries, fire flags, wire back-compat.
import { describe, expect, it } from "vitest";
import {
  BALL_SPAWN_OFFSET,
  FIRE_ALL,
  FIRE_MASK,
  FIRE_PORT,
  FIRE_STARBOARD,
  NEUTRAL_INPUT,
  broadsideAngle,
  fireSides,
  normalizeAngle,
  shipPhysicsStats,
  spawnBroadside,
  stepShip,
} from "@shared/physics";
import { fireFlags, isInputMessage, parseClientMessage } from "@shared/protocol";
import { WORLD_H } from "@shared/world/geo";

const EQ = WORLD_H / 2; // equator: metric offsets == coordinate offsets

/** The ship's bow direction: negative velocity = forward, so it sails along (−sin r, −cos r). */
function bowAfterSailing(rotationY: number): { x: number; z: number } {
  const stats = shipPhysicsStats("sloop");
  let s = { x: 1000, z: EQ, rotationY, velocity: 0 };
  for (let i = 0; i < 20; i++) s = stepShip(s, { th: 1, ru: 0, f: 0 }, stats);
  const len = Math.hypot(s.x - 1000, s.z - EQ);
  return { x: (s.x - 1000) / len, z: (s.z - EQ) / len };
}

/** 2D cross product (bow × v) in the x/z plane, viewed with y up: > 0 means v points to the LEFT
 *  of the bow, < 0 to the RIGHT (Three.js: x right, y up, z toward the viewer). */
function crossY(bow: { x: number; z: number }, v: { x: number; z: number }): number {
  // y component of (bow × v) for 3D vectors (bow.x, 0, bow.z) × (v.x, 0, v.z) is bow.z*v.x − bow.x*v.z.
  return bow.z * v.x - bow.x * v.z;
}

describe("side geometry", () => {
  const headings = [0, 0.7, Math.PI / 2, 2.5, Math.PI - 0.01, -Math.PI / 2, -2.2];

  it("starboard fires to the RIGHT of the bow and port to the LEFT, at every heading", () => {
    for (const r of headings) {
      const bow = bowAfterSailing(r);
      const ship = { x: 1000, z: EQ, rotationY: r };
      const [s] = spawnBroadside(ship, 1, "starboard");
      const [p] = spawnBroadside(ship, 1, "port");
      // Perpendicular to the bow…
      expect(Math.abs(bow.x * s.dx + bow.z * s.dz), `r=${r} stbd ⟂`).toBeLessThan(1e-6);
      expect(Math.abs(bow.x * p.dx + bow.z * p.dz), `r=${r} port ⟂`).toBeLessThan(1e-6);
      // …on opposite sides: the "A/Left turns rotationY up" rudder turns the bow toward port.
      expect(crossY(bow, { x: s.dx, z: s.dz }), `r=${r} starboard is right`).toBeLessThan(-0.99);
      expect(crossY(bow, { x: p.dx, z: p.dz }), `r=${r} port is left`).toBeGreaterThan(0.99);
      // Spawn points sit on the matching hull side, BALL_SPAWN_OFFSET out.
      expect(s.x - 1000).toBeCloseTo(s.dx * BALL_SPAWN_OFFSET, 6);
      expect(s.z - EQ).toBeCloseTo(s.dz * BALL_SPAWN_OFFSET, 6);
      expect(p.x - 1000).toBeCloseTo(p.dx * BALL_SPAWN_OFFSET, 6);
      expect(p.z - EQ).toBeCloseTo(p.dz * BALL_SPAWN_OFFSET, 6);
    }
  });

  it("port is the side the ship turns toward with the LEFT rudder (ru = 1)", () => {
    const stats = shipPhysicsStats("sloop");
    let s = { x: 1000, z: EQ, rotationY: 0.3, velocity: -stats.maxSpeed };
    const [p] = spawnBroadside(s, 1, "port");
    const bow0 = { x: -Math.sin(s.rotationY), z: -Math.cos(s.rotationY) };
    for (let i = 0; i < 5; i++) s = stepShip(s, { th: 1, ru: 1, f: 0 }, stats);
    const bow1 = { x: -Math.sin(s.rotationY), z: -Math.cos(s.rotationY) };
    // The bow swung toward the port guns' direction.
    expect(bow1.x * p.dx + bow1.z * p.dz).toBeGreaterThan(bow0.x * p.dx + bow0.z * p.dz);
  });

  it("broadsideAngle: starboard = r + π/2 (the pre-2026-10-23 only side), port = r − π/2", () => {
    for (const r of headings) {
      expect(broadsideAngle(r, "starboard")).toBeCloseTo(r + Math.PI / 2, 12);
      expect(normalizeAngle(broadsideAngle(r, "port") - broadsideAngle(r, "starboard") + Math.PI)).toBeCloseTo(0, 9);
    }
    // Default side is starboard, identical to the old single broadside.
    expect(spawnBroadside({ x: 1000, z: EQ, rotationY: 0.3 }, 3)).toEqual(spawnBroadside({ x: 1000, z: EQ, rotationY: 0.3 }, 3, "starboard"));
  });

  it("a port fan mirrors the starboard fan", () => {
    const ship = { x: 1000, z: EQ, rotationY: 1.1 };
    const s = spawnBroadside(ship, 4, "starboard");
    const p = spawnBroadside(ship, 4, "port");
    expect(p).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(p[i].dx).toBeCloseTo(-s[i].dx, 9);
      expect(p[i].dz).toBeCloseTo(-s[i].dz, 9);
    }
  });
});

describe("fireSides (fire-all-available selection)", () => {
  it("FIRE_ALL fires whatever is loaded: both, one, or none", () => {
    expect(fireSides(FIRE_ALL, true, true)).toEqual({ port: true, starboard: true });
    expect(fireSides(FIRE_ALL, true, false)).toEqual({ port: true, starboard: false });
    expect(fireSides(FIRE_ALL, false, true)).toEqual({ port: false, starboard: true });
    expect(fireSides(FIRE_ALL, false, false)).toEqual({ port: false, starboard: false });
  });

  it("FIRE_PORT / FIRE_STARBOARD fire only their own loaded side", () => {
    expect(fireSides(FIRE_PORT, true, true)).toEqual({ port: true, starboard: false });
    expect(fireSides(FIRE_PORT, false, true)).toEqual({ port: false, starboard: false });
    expect(fireSides(FIRE_STARBOARD, true, true)).toEqual({ port: false, starboard: true });
    expect(fireSides(FIRE_STARBOARD, true, false)).toEqual({ port: false, starboard: false });
    expect(fireSides(FIRE_PORT | FIRE_STARBOARD, true, true)).toEqual({ port: true, starboard: true });
    expect(fireSides(0, true, true)).toEqual({ port: false, starboard: false });
  });

  it("stepShip ignores the fire flags (physics is unchanged)", () => {
    const stats = shipPhysicsStats("sloop");
    const s = { x: 1000, z: EQ, rotationY: 0.4, velocity: -2 };
    for (const f of [FIRE_ALL, FIRE_PORT, FIRE_STARBOARD, FIRE_MASK]) {
      expect(stepShip(s, { th: 1, ru: -1, f }, stats)).toEqual(stepShip(s, { th: 1, ru: -1, f: 0 }, stats));
    }
    expect(NEUTRAL_INPUT.f).toBe(0);
  });
});

describe("wire back-compat", () => {
  it("an old cached client's f:1 still parses to FIRE_ALL (fires every loaded side)", () => {
    const m = parseClientMessage(JSON.stringify({ t: "input", s: 5, th: 1, ru: 0, f: 1 }));
    expect(m).toEqual({ t: "input", s: 5, th: 1, ru: 0, f: FIRE_ALL });
    expect(isInputMessage(m)).toBe(true);
    expect(parseClientMessage({ t: "input", s: 5, th: 0, ru: 0, f: true })).toMatchObject({ f: FIRE_ALL });
    expect(parseClientMessage({ t: "input", s: 5, th: 0, ru: 0, f: 0 })).toMatchObject({ f: 0 });
  });

  it("new side bits pass through; junk is clamped, never rejected", () => {
    for (const f of [FIRE_PORT, FIRE_STARBOARD, FIRE_PORT | FIRE_STARBOARD, FIRE_ALL | FIRE_PORT, FIRE_MASK]) {
      expect(parseClientMessage({ t: "input", s: 1, th: 0, ru: 0, f })).toMatchObject({ f });
    }
    expect(fireFlags(9)).toBe(FIRE_ALL); // 9 & 7 = 1
    expect(fireFlags(8)).toBe(FIRE_ALL); // positive with no known bit: the old "any positive fires"
    expect(fireFlags(0.5)).toBe(FIRE_ALL);
    expect(fireFlags(6.9)).toBe(FIRE_PORT | FIRE_STARBOARD);
    expect(fireFlags(-4)).toBe(0);
    expect(fireFlags(NaN)).toBe(0);
    expect(fireFlags(Infinity)).toBe(0);
    expect(fireFlags("4")).toBe(0);
    expect(fireFlags(null)).toBe(0);
    expect(fireFlags(false)).toBe(0);
  });

  it("isInputMessage accepts fire bits 0..7 only", () => {
    expect(isInputMessage({ t: "input", s: 1, th: 0, ru: 0, f: 6 })).toBe(true);
    expect(isInputMessage({ t: "input", s: 1, th: 0, ru: 0, f: 8 })).toBe(false);
    expect(isInputMessage({ t: "input", s: 1, th: 0, ru: 0, f: 1.5 })).toBe(false);
  });
});
