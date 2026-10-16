/**
 * Small pure helpers shared by the NPC modules: heading <-> direction conversion in the physics
 * convention, clamping, and a seeded RNG so NPC behaviour is reproducible in tests.
 *
 * Physics convention (shared/physics.ts): heading vector h = (sin r, cos r); NEGATIVE velocity is
 * forward, so a ship sailing ahead moves along −h = (−sin r, −cos r). rotationY 0 = north = −z.
 * Broadside balls leave along angle r + π/2, i.e. (cos r, −sin r): the starboard (right) side.
 */
import { normalizeAngle } from "@shared/physics";

/** Unit vector a ship with rotationY `r` moves along when sailing ahead. */
export function moveDir(r: number): { x: number; z: number } {
  return { x: -Math.sin(r), z: -Math.cos(r) };
}

/** rotationY that makes the ship sail ahead along (dx, dz). Inverse of moveDir. */
export function headingForDir(dx: number, dz: number): number {
  return normalizeAngle(Math.atan2(-dx, -dz));
}

/** "Bearing angle" b of a vector in the sin/cos convention: (dx, dz) ∝ (sin b, cos b). */
export function bearingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest signed angle from a to b, in [−π, π). */
export function angleDiff(a: number, b: number): number {
  return normalizeAngle(b - a);
}
