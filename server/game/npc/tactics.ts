/**
 * Broadside combat tactics (proposal §3 "Broadside tactics"). Pure.
 *
 * Guns: `spawnBroadside` (shared/physics.ts) fires along rotationY + π/2 only, i.e. the STARBOARD
 * side. `Side` is modelled so port guns can be added later, but today `GUN_SIDES = ["starboard"]`.
 *
 * Engagement geometry: to put the target on the beam the ship must sail perpendicular to the line
 * of sight. Range is held with an orbit controller: the movement direction is the perpendicular,
 * rotated toward the target when too far and away when too close (gain on the range error). While
 * reloading the hold distance opens to the top of the band ("kite while reloading").
 *
 * Firing: lead the target by the ball flight time (balls do not inherit ship velocity; speed
 * BALL_SPEED * 60 = 900 units/s), and fire when the lead point is within ±FIRE_ARC of the beam,
 * after adding the archetype's aim error (seeded noise), and within range.
 */
import { BALL_LIFETIME_MS, BALL_SPEED, FRAMES_PER_SECOND, normalizeAngle } from "@shared/physics";
import { SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";
import type { NpcMetric } from "./metric";
import { velocityOf, type SteerShip, type SteerTarget } from "./steering";
import { bearingOf, clamp, moveDir } from "./util";

export type Side = "starboard" | "port";
/** Sides that actually have guns (spawnBroadside fires +π/2 only). */
export const GUN_SIDES: readonly Side[] = ["starboard"];

/** Ball ground speed, units per second. */
export const BALL_SPEED_PER_SEC = BALL_SPEED * FRAMES_PER_SECOND;
/** Geometric max ball travel (units). Accuracy, not this, limits real range. */
export const BALL_MAX_RANGE = BALL_SPEED_PER_SEC * (BALL_LIFETIME_MS / 1000);
/**
 * Default NPC engagement ("cannon") range, units. SHIP_STATS.cannonRange (150–300) is unused by
 * the server sim and smaller than a turning circle; balls fly 2700. 600 gives ~0.67 s flight time
 * so leading matters but stays hittable. Per-archetype override: Archetype.engageRange.
 */
export const DEFAULT_CANNON_RANGE = 600;
/** Hold distance band as a fraction of cannon range. */
export const HOLD_MIN = 0.6;
export const HOLD_MAX = 0.85;
/** Fire when the (noisy) lead bearing is within this of the beam (radians, 12°). */
export const FIRE_ARC = (12 * Math.PI) / 180;
/** Orbit controller gain (radians of course change per unit of range error / range). */
export const RANGE_GAIN = 3;
/** In-band speed: target's along-course speed + maxSpeed × (PACE_BASE + PACE_GAIN × ahead-of-beam rad). */
export const PACE_BASE = 0.3;
export const PACE_GAIN = 1.5;

/** Angle (sin/cos convention) the guns on `side` point along for rotationY `r`. */
export function gunAngle(r: number, side: Side): number {
  return side === "starboard" ? r + Math.PI / 2 : r - Math.PI / 2;
}

/** Lead point (metric delta from self) and flight time for a ball fired now at `target`. */
export function leadPoint(self: { x: number; z: number }, target: SteerTarget, m: NpcMetric): { dx: number; dz: number; t: number } {
  const d = m.delta(self.x, self.z, target.x, target.z);
  const v = velocityOf(target); // units/frame
  let px = d.dx;
  let pz = d.dz;
  let t = 0;
  for (let i = 0; i < 2; i++) {
    t = Math.hypot(px, pz) / BALL_SPEED_PER_SEC;
    px = d.dx + v.x * FRAMES_PER_SECOND * t;
    pz = d.dz + v.z * FRAMES_PER_SECOND * t;
  }
  return { dx: px, dz: pz, t };
}

/** Signed angle from the `side` gun direction to the lead point (radians, [−π, π)). */
export function beamError(self: SteerTarget, target: SteerTarget, m: NpcMetric, side: Side = "starboard"): number {
  const lp = leadPoint(self, target, m);
  return normalizeAngle(bearingOf(lp.dx, lp.dz) - gunAngle(self.rotationY, side));
}

/** Pick the gunned side needing the smallest turn to bear (only starboard today). */
export function chooseSide(self: SteerTarget, target: SteerTarget, m: NpcMetric, sides: readonly Side[] = GUN_SIDES): Side {
  let best = sides[0];
  let bestErr = Infinity;
  for (const s of sides) {
    const e = Math.abs(beamError(self, target, m, s));
    if (e < bestErr) {
      bestErr = e;
      best = s;
    }
  }
  return best;
}

export interface EngageParams {
  /** Cannon range (units). */
  range: number;
  /** Aim error (radians, ± uniform), the per-archetype difficulty knob. */
  aimError: number;
  sides?: readonly Side[];
}

export interface EngageOrder {
  /** Desired rotationY. */
  heading: number;
  /** Desired forward speed (units/frame). */
  speed: number;
  /** Pull the trigger this tick (the world still gates on reload). */
  fire: boolean;
  side: Side;
  dist: number;
  beamErr: number;
}

/**
 * One tick of broadside engagement against `target`. `reloading` = guns not ready (kite).
 * `rng` supplies the aim noise (seeded per NPC).
 */
export function engage(
  self: SteerShip,
  target: SteerTarget,
  params: EngageParams,
  reloading: boolean,
  m: NpcMetric,
  rng: () => number = Math.random,
): EngageOrder {
  const side = chooseSide(self, target, m, params.sides ?? GUN_SIDES);
  const d = m.delta(self.x, self.z, target.x, target.z);
  const dist = Math.hypot(d.dx, d.dz);
  const los = bearingOf(d.dx, d.dz);
  const hold = params.range * (reloading ? HOLD_MAX : (HOLD_MIN + HOLD_MAX) / 2);
  const rangeErr = (dist - hold) / params.range;
  // Course change toward the target: + when too far (close in), − when too close (open out).
  const k = clamp(rangeErr * RANGE_GAIN, -Math.PI / 3, Math.PI / 2);
  // Guns at angle r ± π/2 must point along `los`; moving direction is r + π (sin/cos convention).
  // Starboard: r = los − π/2 → move angle = los + π/2; rotating the course toward los subtracts k.
  const moveAngle = side === "starboard" ? los + Math.PI / 2 - k : los - Math.PI / 2 + k;
  const heading = normalizeAngle(moveAngle + Math.PI);
  const err = beamError(self, target, m, side);
  // Speed: full while closing/opening range. In the band, pace the target: its speed along our
  // course, plus a correction that speeds up when the target is ahead of the beam and slows when
  // it falls behind (so a running target is held abeam on a parallel course).
  const tv = velocityOf(target);
  const along = tv.x * Math.sin(moveAngle) + tv.z * Math.cos(moveAngle);
  const ahead = side === "starboard" ? err : -err;
  const paced = clamp(along + self.maxSpeed * (PACE_BASE + PACE_GAIN * ahead), self.maxSpeed * 0.2, self.maxSpeed);
  const w = clamp(Math.abs(rangeErr) * 2, 0, 1);
  const speed = w * self.maxSpeed + (1 - w) * paced;
  const noise = (rng() * 2 - 1) * params.aimError;
  const fire = !reloading && dist <= params.range && Math.abs(err + noise) <= FIRE_ARC;
  return { heading, speed, fire, side, dist, beamErr: err };
}

/** True when `self` is in broadside position: lead point within ±FIRE_ARC of a gun side and within
 *  [0.4, 1.0] × range. Used by tests and by the brain to judge an engagement. */
export function inBroadsidePosition(self: SteerTarget, target: SteerTarget, range: number, m: NpcMetric, sides: readonly Side[] = GUN_SIDES): boolean {
  const dist = Math.sqrt(m.distSq(self.x, self.z, target.x, target.z));
  if (dist > range || dist < range * 0.4) return false;
  for (const s of sides) if (Math.abs(beamError(self, target, m, s)) <= FIRE_ARC) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Firepower and disengage rules
// ---------------------------------------------------------------------------------------------

/** Rough combat power of a ship type: sqrt(broadside DPS after armour × effective hull). */
export function firepower(shipType: string, hpFrac = 1): number {
  const s = SHIP_STATS[shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
  const dps = (s.cannonCount * s.cannonDamage) / s.cannonReload;
  const hull = (s.hullStrength * hpFrac) / (1 - s.armor / 100);
  return Math.sqrt(dps * hull);
}

/**
 * Break off when badly hurt or outgunned. Thresholds scale with courage (0..1):
 * - hp below (1 − courage) × 0.6 of max (courage 0.9 → 6 %, 0.5 → 30 %, 0.2 → 48 %)
 * - enemy power above mine × (1 + 2 × courage) (courage 0.5 → 2×, 0.9 → 2.8×)
 */
export function shouldDisengage(hpFrac: number, courage: number, myPower: number, theirPower: number): boolean {
  if (hpFrac < (1 - courage) * 0.6) return true;
  return theirPower > myPower * (1 + 2 * courage);
}

/** Unit vector of a ship's current course (for tests and debugging). */
export function courseOf(r: number): { x: number; z: number } {
  return moveDir(r);
}
