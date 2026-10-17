/**
 * Reynolds steering for NPC ships, plus the bridge from "where I want to go" to the exact
 * `{th, ru, f}` input a player would send (`toInput`). Pure functions, no world access.
 *
 * All vectors are METRIC (ground units) "desired velocities" in units per 1/60 s frame, the same
 * unit as ship speed. A behaviour returns a desired velocity; `arbitrate` combines several by
 * priority; `toSteer` turns the result into a desired heading + speed; `toInput` turns that into
 * rudder/throttle with a deadband so ships never oscillate around their heading.
 *
 * Coordinates go through an `NpcMetric` (metric.ts), so this file never assumes a flat torus.
 */
import { SUBSTEPS, normalizeAngle, type ShipInput, type ShipPhysicsStats } from "@shared/physics";
import type { LandQuery as SharedLandQuery } from "@shared/world/land";
import type { NpcMetric } from "./metric";
import { clamp, headingForDir, moveDir } from "./util";

/** The land queries steering needs: the distance/normal half of WORLD_SPEC §4.2 `LandQuery`
 *  (shared/world/land.ts). The World's `LandField` (real SDF tiles + polar ice) satisfies it.
 *  distance: metric signed distance, + = water. */
export type LandQuery = Pick<SharedLandQuery, "distance" | "normal">;

/** Open ocean everywhere, no ice (logic-only unit tests). Live NPCs use `world.land`. */
export const OPEN_SEA: LandQuery = {
  distance: () => 1e9,
  normal: () => ({ nx: 0, nz: 0 }),
};

export interface Vec {
  x: number;
  z: number;
}

/** The kinematic view of a ship that steering needs. velocity < 0 = ahead (physics convention). */
export interface SteerShip {
  x: number;
  z: number;
  rotationY: number;
  velocity: number;
  maxSpeed: number;
}

/** A moving target (another ship). */
export interface SteerTarget {
  x: number;
  z: number;
  rotationY: number;
  velocity: number;
  /** F1: observed turn rate, rad per 1/60 s frame (+ = rotationY increasing). Used to lead a
   *  turning target along its arc (tactics.leadPoint). Omitted = sailing straight. */
  turnRate?: number;
}

const ZERO: Vec = Object.freeze({ x: 0, z: 0 }) as Vec;

function len(v: Vec): number {
  return Math.hypot(v.x, v.z);
}

function scaleTo(dx: number, dz: number, mag: number): Vec {
  const l = Math.hypot(dx, dz);
  if (l < 1e-9) return { x: 0, z: 0 };
  return { x: (dx / l) * mag, z: (dz / l) * mag };
}

/** Velocity vector (metric units/frame) of a ship: moveDir * forward speed. */
export function velocityOf(s: SteerTarget): Vec {
  const fwd = -s.velocity;
  const d = moveDir(s.rotationY);
  return { x: d.x * fwd, z: d.z * fwd };
}

// ---------------------------------------------------------------------------------------------
// Behaviours
// ---------------------------------------------------------------------------------------------

/** Full speed straight at (tx, tz). */
export function seek(ship: SteerShip, tx: number, tz: number, m: NpcMetric): Vec {
  const d = m.delta(ship.x, ship.z, tx, tz);
  return scaleTo(d.dx, d.dz, ship.maxSpeed);
}

/** Full speed straight away from (tx, tz). */
export function flee(ship: SteerShip, tx: number, tz: number, m: NpcMetric): Vec {
  const d = m.delta(ship.x, ship.z, tx, tz);
  return scaleTo(-d.dx, -d.dz, ship.maxSpeed);
}

/** Seek that slows linearly inside `slowRadius` and stops within `stopRadius`. */
export function arrive(ship: SteerShip, tx: number, tz: number, m: NpcMetric, slowRadius = 300, stopRadius = 30): Vec {
  const d = m.delta(ship.x, ship.z, tx, tz);
  const dist = Math.hypot(d.dx, d.dz);
  if (dist <= stopRadius) return { x: 0, z: 0 };
  const speed = ship.maxSpeed * clamp((dist - stopRadius) / Math.max(1, slowRadius - stopRadius), 0, 1);
  return scaleTo(d.dx, d.dz, Math.max(speed, 0.0001));
}

/** Where `target` will be after the time we need to reach it (Reynolds pursuit horizon). */
export function predictIntercept(ship: SteerShip, target: SteerTarget, m: NpcMetric, maxLookaheadFrames = 240): Vec {
  const d = m.delta(ship.x, ship.z, target.x, target.z);
  const dist = Math.hypot(d.dx, d.dz);
  const tv = velocityOf(target);
  const closing = ship.maxSpeed + len(tv);
  const t = clamp(dist / Math.max(0.1, closing), 0, maxLookaheadFrames);
  return { x: d.dx + tv.x * t, z: d.dz + tv.z * t };
}

/** Intercept a moving target (seek its predicted position). */
export function pursue(ship: SteerShip, target: SteerTarget, m: NpcMetric): Vec {
  const p = predictIntercept(ship, target, m);
  return scaleTo(p.x, p.z, ship.maxSpeed);
}

/** Run from where a moving threat is going to be. */
export function evade(ship: SteerShip, threat: SteerTarget, m: NpcMetric): Vec {
  const p = predictIntercept(ship, threat, m);
  return scaleTo(-p.x, -p.z, ship.maxSpeed);
}

/** Persistent wander state (the jittered angle offset). */
export interface WanderState {
  angle: number;
}

/** Gentle random meandering. `rng` must be deterministic (seeded) for reproducible tests. */
export function wander(ship: SteerShip, state: WanderState, rng: () => number, jitter = 0.3, speedFrac = 0.6): Vec {
  state.angle = clamp(state.angle + (rng() * 2 - 1) * jitter, -1.2, 1.2);
  const d = moveDir(ship.rotationY + state.angle);
  return { x: d.x * ship.maxSpeed * speedFrac, z: d.z * ship.maxSpeed * speedFrac };
}

// ---------------------------------------------------------------------------------------------
// Land avoidance (coastline feelers against the SDF)
// ---------------------------------------------------------------------------------------------

export interface AvoidResult {
  /** Desired velocity that steers along/away from the coast. */
  v: Vec;
  /** 0..1, how strongly it should override other behaviours. */
  urgency: number;
}

/** Tuning for the feelers. Lengths are metric units. */
export const FEELER_BASE = 80;
export const FEELER_PER_SPEED = 25;
export const FEELER_SIDE_ANGLE = 0.5;
export const LAND_CLEARANCE = 60;
/** NPC2: keep the previous coast-tangent side unless the other is better by this share of |want|. */
export const AVOID_SIDE_HYSTERESIS = 0.5;

/** NPC2: per-ship memory for `avoidLand` (which coast tangent it is sliding along; 0 = none). */
export interface AvoidMemo {
  side: -1 | 0 | 1;
}

/**
 * Three feelers (ahead and ±FEELER_SIDE_ANGLE) whose length grows with speed. If any feeler tip
 * (or the hull itself) is within `clearance` of land, steer along the coast tangent closest to
 * the current course, pushed out along the land normal. Returns null when the way is clear.
 */
export function avoidLand(
  ship: SteerShip,
  land: LandQuery,
  m: NpcMetric,
  clearance = LAND_CLEARANCE,
  desired?: Vec | null,
  memo?: AvoidMemo,
): AvoidResult | null {
  const fwd = Math.max(0, -ship.velocity);
  const L = FEELER_BASE + fwd * FEELER_PER_SPEED;
  let worst = Infinity;
  let wx = ship.x;
  let wz = ship.z;
  const here = land.distance(ship.x, ship.z);
  if (here < clearance) {
    worst = here;
  }
  const angles = [0, FEELER_SIDE_ANGLE, -FEELER_SIDE_ANGLE];
  const tip = { x: 0, z: 0 };
  for (let i = 0; i < 3; i++) {
    const d = moveDir(ship.rotationY + angles[i]);
    const len = i === 0 ? L : L * 0.6;
    m.offset(ship.x, ship.z, d.x * len, d.z * len, tip);
    const dist = land.distance(tip.x, tip.z);
    if (dist < clearance && dist < worst) {
      worst = dist;
      wx = tip.x;
      wz = tip.z;
    }
  }
  if (worst === Infinity) {
    if (memo) memo.side = 0;
    return null;
  }
  const n = land.normal(wx, wz);
  if (n.nx === 0 && n.nz === 0) return null;
  // The two coast tangents; take the one closest to where we want to go (NPC2: the desired
  // velocity when given, so avoidance slides toward the goal instead of fighting it; otherwise the
  // current course).
  const want = desired && Math.hypot(desired.x, desired.z) > 1e-6 ? desired : null;
  const cur = want ?? moveDir(ship.rotationY);
  let tx = -n.nz;
  let tz = n.nx;
  const dot = tx * cur.x + tz * cur.z;
  let side: 1 | -1 = dot < 0 ? -1 : 1;
  // NPC2: hysteresis. When the goal is straight behind the coast both tangents are equally good and
  // the choice would flip every tick (the ship then sits pinned with its rudder see-sawing). Keep
  // the previous side unless the other one is clearly better.
  if (memo && memo.side !== 0 && memo.side !== side && Math.abs(dot) < AVOID_SIDE_HYSTERESIS * Math.hypot(cur.x, cur.z)) side = memo.side;
  if (memo) memo.side = side;
  tx *= side;
  tz *= side;
  const urgency = clamp((clearance - worst) / clearance, 0.25, 1);
  // Push away harder the deeper we are.
  const push = 0.5 + urgency;
  return { v: scaleTo(tx + n.nx * push, tz + n.nz * push, ship.maxSpeed), urgency };
}

// ---------------------------------------------------------------------------------------------
// Arbitration
// ---------------------------------------------------------------------------------------------

export interface WeightedBehaviour {
  v: Vec | null;
  weight: number;
}

/**
 * Prioritized acceleration allocation (Reynolds): behaviours in priority order each add
 * `v * weight` until the magnitude budget (`maxMag`) is spent; lower-priority behaviours get
 * whatever is left. Null/zero entries are skipped.
 */
export function arbitrate(list: WeightedBehaviour[], maxMag: number): Vec {
  let ax = 0;
  let az = 0;
  let left = maxMag;
  for (const b of list) {
    if (!b.v || left <= 1e-9) continue;
    const bx = b.v.x * b.weight;
    const bz = b.v.z * b.weight;
    const mag = Math.hypot(bx, bz);
    if (mag < 1e-9) continue;
    if (mag <= left) {
      ax += bx;
      az += bz;
      left -= mag;
    } else {
      ax += (bx / mag) * left;
      az += (bz / mag) * left;
      left = 0;
    }
  }
  return { x: ax, z: az };
}

/** Blend a behaviour with land avoidance: avoidance wins in proportion to its urgency. */
export function withAvoidance(desired: Vec, avoid: AvoidResult | null): Vec {
  if (!avoid) return desired;
  const u = avoid.urgency;
  return { x: avoid.v.x * u + desired.x * (1 - u), z: avoid.v.z * u + desired.z * (1 - u) };
}

// ---------------------------------------------------------------------------------------------
// Desired velocity → heading/speed → input
// ---------------------------------------------------------------------------------------------

export interface Steer {
  heading: number;
  speed: number;
}

/** Desired heading (rotationY) and forward speed for a desired velocity. Zero vector keeps heading. */
export function toSteer(ship: SteerShip, v: Vec): Steer {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-6) return { heading: ship.rotationY, speed: 0 };
  return { heading: headingForDir(v.x, v.z), speed: Math.min(speed, ship.maxSpeed) };
}

/** Throttle hysteresis band (units per frame). */
export const SPEED_DEADBAND = 0.25;

/**
 * Convert a desired heading (rotationY) and forward speed (units/frame, ≥ 0) into a ShipInput,
 * using exactly the physics the ship obeys (stepShip):
 * - rudder: ±1 toward the shortest-arc heading error; 0 inside a deadband of half a tick's turn
 *   (turnSpeed * SUBSTEPS / 2). One full tick of turn never overshoots by more than the deadband,
 *   so the heading settles in one or two ticks and never oscillates.
 * - throttle: 1 when slower than desired − band, 0 (coast; drag brakes) when faster than
 *   desired + band; inside the band, hold full ahead only if the desired speed is ~max.
 * Never fires (`f` is set by tactics).
 */
export function toInput(
  ship: Pick<SteerShip, "rotationY" | "velocity">,
  desiredHeading: number,
  desiredSpeed: number,
  stats: Pick<ShipPhysicsStats, "turnSpeed" | "maxSpeed">,
): ShipInput {
  const err = normalizeAngle(desiredHeading - ship.rotationY);
  const deadband = (stats.turnSpeed * SUBSTEPS) / 2;
  const ru: -1 | 0 | 1 = Math.abs(err) <= deadband ? 0 : err > 0 ? 1 : -1;
  const fwd = -ship.velocity;
  const want = clamp(desiredSpeed, 0, stats.maxSpeed);
  let th: -1 | 0 | 1;
  if (fwd < want - SPEED_DEADBAND) th = 1;
  else if (fwd > want + SPEED_DEADBAND) th = 0;
  else th = want >= stats.maxSpeed - SPEED_DEADBAND ? 1 : 0;
  return { th, ru, f: 0 };
}

export { ZERO as ZERO_VEC };
