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
 * Firing (F1, after Q1 B2): lead the target by the ball flight time (balls do not inherit ship
 * velocity; speed BALL_SPEED * 60 = 900 units/s), along an ARC when the target is turning
 * (`SteerTarget.turnRate`), and fire when the lead point is within `fireTolerance` of the beam: the
 * angle the target's hit circle subtends at that range plus half the broadside fan. That is a few
 * degrees at 500 units, so the old fixed 12° arc (plus noise) fired mostly misses. The archetype's
 * aim error is a per-volley "slack" added to that tolerance (sloppy gunners fire off the beam).
 * Any range up to FIRE_RANGE_FACTOR × range counts; the hold band only shapes the manoeuvre.
 * The NPC system then re-checks the shot one tick ahead with the real `stepShip` (the World fires
 * AFTER this tick's rudder is applied) and picks the rudder that keeps the gun on (index.ts `aim`).
 *
 * Turning circle: TURN_SPEED is a fixed 0.05 rad per frame at any speed, so the radius is
 * 20 × speed: 80 (sloop at 4) to 180 (dreadnought at 9) units, well inside the 435–510 hold band.
 * Approaching from far away the course stays APPROACH_MAX_K short of straight at the target (a
 * spiral, 30° off the line of sight) so the target drifts onto the starboard beam on the way in.
 */
import { BALL_LIFETIME_MS, BALL_SPEED, BALL_SPREAD, FRAMES_PER_SECOND, SHIP_HIT_RADIUS, normalizeAngle } from "@shared/physics";
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
/** "In broadside position" arc used by `inBroadsidePosition` (tests, judging). NOT the fire gate:
 *  12° is ~100 units off at 500, far outside a 20-unit hit circle (see `fireTolerance`). */
export const FIRE_ARC = (12 * Math.PI) / 180;
/** Fraction of SHIP_HIT_RADIUS the lead point may miss by and still count as on target. */
export const HIT_TOLERANCE_FRAC = 0.8;
/** Fire at any range up to this × engage range (balls fly 2700; accuracy limits it, not range). */
export const FIRE_RANGE_FACTOR = 1.5;
/** Orbit controller gain (radians of course change per unit of range error / range). */
export const RANGE_GAIN = 3;
/** Largest course change toward the target (radians off the perpendicular). π/2 would run straight
 *  at it; π/3 keeps a 30° offset from the line of sight so the target comes abeam on the approach. */
export const APPROACH_MAX_K = Math.PI / 3;
/** In-band speed: target's along-course speed + maxSpeed × (PACE_BASE + PACE_GAIN × ahead-of-beam rad). */
export const PACE_BASE = 0.3;
export const PACE_GAIN = 1.5;

/** Angle (sin/cos convention) the guns on `side` point along for rotationY `r`. */
export function gunAngle(r: number, side: Side): number {
  return side === "starboard" ? r + Math.PI / 2 : r - Math.PI / 2;
}

/**
 * Metric displacement of a ship over `frames` 1/60 s frames at constant forward speed and constant
 * turn rate `turnRate` (rad/frame; 0 = straight). Straight: moveDir(r) × speed × frames. Turning:
 * the exact integral of moveDir(r + ω f) = (−sin, −cos)(r + ω f) over f ∈ [0, frames].
 */
export function displacement(target: SteerTarget, frames: number): { dx: number; dz: number } {
  const s = -target.velocity; // forward speed, units/frame
  const w = target.turnRate ?? 0;
  const r = target.rotationY;
  if (Math.abs(w) < 1e-5) {
    const d = moveDir(r);
    return { dx: d.x * s * frames, dz: d.z * s * frames };
  }
  const r1 = r + w * frames;
  return { dx: (s * (Math.cos(r1) - Math.cos(r))) / w, dz: (-s * (Math.sin(r1) - Math.sin(r))) / w };
}

/** Lead point (metric delta from self) and flight time for a ball fired now at `target`. A turning
 *  target (`turnRate`) is led along its arc. */
export function leadPoint(self: { x: number; z: number }, target: SteerTarget, m: NpcMetric): { dx: number; dz: number; t: number } {
  const d = m.delta(self.x, self.z, target.x, target.z);
  let px = d.dx;
  let pz = d.dz;
  let t = 0;
  for (let i = 0; i < 3; i++) {
    t = Math.hypot(px, pz) / BALL_SPEED_PER_SEC;
    const o = displacement(target, t * FRAMES_PER_SECOND);
    px = d.dx + o.dx;
    pz = d.dz + o.dz;
  }
  return { dx: px, dz: pz, t };
}

/**
 * Half-angle (radians) within which a broadside fired now hits a ship at `dist`: the angle its hit
 * circle (HIT_TOLERANCE_FRAC × SHIP_HIT_RADIUS) subtends, plus half the fan of a `cannonCount`
 * broadside (BALL_SPREAD apart). Sloop (1 gun) at 500: ≈ 1.8°; man-o-war (4 guns) at 500: ≈ 10.4°.
 */
export function fireTolerance(dist: number, cannonCount = 1): number {
  const hit = Math.atan2(SHIP_HIT_RADIUS * HIT_TOLERANCE_FRAC, Math.max(1, dist));
  return hit + (Math.max(1, Math.floor(cannonCount)) - 1) * 0.5 * BALL_SPREAD;
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
  /** Aim error (radians), the per-archetype difficulty knob: up to this much extra beam error is
   *  accepted when firing (see `aimSlack`). */
  aimError: number;
  sides?: readonly Side[];
  /** Guns per broadside (widens the fire tolerance by the fan). Default 1. */
  cannonCount?: number;
  /** This volley's accepted extra error (0..aimError). The NPC system samples it once per reload
   *  so a volley does not re-roll every tick; when omitted it is rng() × aimError per call. */
  aimSlack?: number;
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
  const k = clamp(rangeErr * RANGE_GAIN, -Math.PI / 3, APPROACH_MAX_K);
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
  const slack = params.aimSlack ?? rng() * params.aimError;
  const fire =
    !reloading && dist <= params.range * FIRE_RANGE_FACTOR && Math.abs(err) <= fireTolerance(dist, params.cannonCount) + slack;
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

/** A ship breaks off at or below (1 − courage) × DISENGAGE_HP_SCALE of its hp. */
export const DISENGAGE_HP_SCALE = 0.7;

/**
 * Break off when badly hurt or outgunned. Thresholds scale with courage (0..1):
 * - hp at or below (1 − courage) × 0.7 of max (F1: was strictly below × 0.6). Pirate (0.5) → 35 %,
 *   privateer (0.6) → 28 %, navy (0.9) → 7 % (navies rarely run), merchant (0.2) → 56 %.
 * - enemy power above mine × (1 + 2 × courage) (courage 0.5 → 2×, 0.9 → 2.8×)
 */
export function shouldDisengage(hpFrac: number, courage: number, myPower: number, theirPower: number): boolean {
  if (hpFrac <= (1 - courage) * DISENGAGE_HP_SCALE) return true;
  return theirPower > myPower * (1 + 2 * courage);
}

/** Unit vector of a ship's current course (for tests and debugging). */
export function courseOf(r: number): { x: number; z: number } {
  return moveDir(r);
}
