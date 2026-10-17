/**
 * Shared deterministic simulation for Pirate Trade Wars (see docs/netcode/PROTOCOL.md §2 and
 * docs/world/WORLD_SPEC.md §3, §4.3).
 *
 * This module is imported by BOTH the server (authoritative tick) and the client (prediction +
 * reconciliation + remote interpolation). It must stay pure and dependency-free: no imports from
 * `client/` or `server/`, no DOM / Node APIs, no randomness, no clocks. Imports are relative
 * (`./gameConstants`, `./world/*`) so they resolve under Vite, esbuild and vitest without aliases.
 *
 * World (wrapping Earth, WORLD_SPEC §2): x is longitude and wraps in [0, WORLD_C = 400 000);
 * z is latitude in [0, WORLD_H = 200 000] (north pole at 0, north = −z) and does NOT wrap — it is
 * closed by polar ice, which `LandField` reports as land. Movement uses the sphere metric: a ship's
 * velocity is a ground (metric) speed, so moving east at latitude φ advances x by v / cos φ.
 *
 * Units:
 * - Distance: world units (≈ 100 m). Gameplay distances are METRIC (`metricDistSq` in geo.ts).
 * - Speed / velocity: "units per 1/60 s frame". Displacement over dt seconds = velocity * dt * 60.
 * - Angles: radians. `rotationY` is the rotation about +Y; the heading (bow) vector is
 *   (sin(rotationY), cos(rotationY)) in metric (east, south) — i.e. (0,0,1) rotated about Y.
 * - Time: TICK_DT and the `elapsedSec` arguments are seconds; *_MS constants are milliseconds.
 *
 * Sign convention (preserved from the live game): NEGATIVE velocity = sailing forward (W key).
 *
 * Determinism: given the same starting state, input sequence and land tiles, `stepShip` produces
 * bit-identical results in the same JS engine. Math.sin/Math.cos may differ in the last ulp between
 * engines (browser vs Node); that is fine because the server is authoritative and the client
 * reconciles to every snapshot.
 */
import { SHIP_STATS, SHIP_TYPES } from "./gameConstants";
import { WORLD_C, WORLD_H, clampZ, metricDistSq, metricX, wrap, wrappedDelta } from "./world/geo";
import type { LandQuery } from "./world/land";

export { wrap, wrappedDelta, metricX, metricDelta, metricDistSq } from "./world/geo";
export type { LandQuery } from "./world/land";

// ---------------------------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------------------------

/** Simulation ticks per second (server runs exactly one `stepShip` per player per tick). */
export const TICK_HZ = 20;
/** Seconds per simulation tick (0.05 s). */
export const TICK_DT = 1 / TICK_HZ;
/** Physics sub-steps per tick. Each sub-step is exactly one legacy 1/60 s "frame". */
export const SUBSTEPS = 3;
/** Seconds per physics sub-step (1/60 s). */
export const SUBSTEP_DT = TICK_DT / SUBSTEPS;
/** Legacy frame rate the speed units are expressed in (speed is "units per 1/60 s"). */
export const FRAMES_PER_SECOND = 60;

// ---------------------------------------------------------------------------------------------
// Ship tuning (constants taken from the old client Player.tsx so the feel is preserved)
// ---------------------------------------------------------------------------------------------

/** Rudder turn rate, radians per 1/60 s frame (= 3 rad/s). A/Left = +, D/Right = −. */
export const TURN_SPEED = 0.05;
/** Velocity change per frame while W (full ahead) is held, units/frame per frame. */
export const FORWARD_ACCEL = 0.15;
/** Velocity change per frame while S (reverse) is held, units/frame per frame. */
export const REVERSE_ACCEL = 0.1;
/** Multiplicative drag applied each frame while coasting (no throttle). Unitless. */
export const DRAG_COEFFICIENT = 0.97;
/** Linear deceleration per frame while coasting, applied after drag; snaps to exactly 0 below it. */
export const COAST_DECEL = 0.03;
/** Reverse top speed as a fraction of maxSpeed (S key). */
export const REVERSE_SPEED_FACTOR = 0.5;

/** Hull radius (metric units) per ship type, used for land collision (WORLD_SPEC §4.3). */
export const HULL_RADIUS: Readonly<Record<string, number>> = Object.freeze({
  [SHIP_TYPES.SLOOP]: 12,
  [SHIP_TYPES.BRIGANTINE]: 16,
  [SHIP_TYPES.GALLEON]: 22,
  [SHIP_TYPES.MAN_O_WAR]: 26,
  [SHIP_TYPES.DREADNAUGHT]: 30,
});
/** Hull radius for unknown ship types (sloop). */
export const DEFAULT_HULL_RADIUS = 12;
/** Max push-out iterations per sub-step (concave coasts may need more than one). */
export const COLLISION_ITERATIONS = 3;

/** Ship kinematic state. x in [0, WORLD_C) (wrapped), z in [0, WORLD_H] (not wrapped), rotationY
 *  in radians normalized to [-π, π), velocity in metric units per 1/60 s (negative = forward). */
export interface ShipKinematics {
  x: number;
  z: number;
  rotationY: number;
  velocity: number;
}

/** One tick of player intent. All fields are integers.
 *  th: throttle, 1 = W/Up (full ahead, target velocity −maxSpeed), −1 = S/Down (reverse, target
 *      +maxSpeed·REVERSE_SPEED_FACTOR), 0 = coast.
 *  ru: rudder, 1 = A/Left (rotationY increases), −1 = D/Right, 0 = straight.
 *  f:  fire, 1 = fire button held this tick (reload gating is the server's job, not physics). */
export interface ShipInput {
  th: -1 | 0 | 1;
  ru: -1 | 0 | 1;
  f: 0 | 1;
}

/** The "no input" value (coast, rudder centered, not firing). */
export const NEUTRAL_INPUT: Readonly<ShipInput> = Object.freeze({ th: 0, ru: 0, f: 0 });

/** Per-ship-type physics parameters. Speeds are units per 1/60 s; turnSpeed is rad per 1/60 s;
 *  accelerations are units/frame per frame; hullRadius is metric units. */
export interface ShipPhysicsStats {
  /** Forward top speed (magnitude). Forward velocity tends to −maxSpeed. */
  maxSpeed: number;
  forwardAccel: number;
  reverseAccel: number;
  /** Reverse top speed = maxSpeed * reverseFactor. */
  reverseFactor: number;
  turnSpeed: number;
  /** Collision radius against land (metric units). */
  hullRadius: number;
}

/** Physics stats for a ship type (from SHIP_STATS[shipType].speed). Unknown types fall back to sloop. */
export function shipPhysicsStats(shipType: string): ShipPhysicsStats {
  const stats = SHIP_STATS[shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
  return physicsStatsFromMaxSpeed(stats.speed, HULL_RADIUS[shipType] ?? DEFAULT_HULL_RADIUS);
}

/** Physics stats from an explicit max speed (units per 1/60 s), using the default tuning. */
export function physicsStatsFromMaxSpeed(maxSpeed: number, hullRadius: number = DEFAULT_HULL_RADIUS): ShipPhysicsStats {
  return {
    maxSpeed,
    forwardAccel: FORWARD_ACCEL,
    reverseAccel: REVERSE_ACCEL,
    reverseFactor: REVERSE_SPEED_FACTOR,
    turnSpeed: TURN_SPEED,
    hullRadius,
  };
}

/**
 * Advance a ship by exactly one simulation tick (TICK_DT = 0.05 s = SUBSTEPS frames of 1/60 s).
 * Pure: returns a NEW object, never mutates `state`. Per sub-step, in order:
 *  1. rotationY += ru * turnSpeed
 *  2. velocity moves toward the throttle target (−maxSpeed for th=1, +maxSpeed*reverseFactor for
 *     th=−1) by the accel; with th=0 it is multiplied by DRAG_COEFFICIENT, then reduced by
 *     COAST_DECEL toward 0 and snapped to exactly 0 once |v| < COAST_DECEL.
 *  3. metric integration: z += cos(r)·v, then x += sin(r)·v / metricX(z) (x wrapped, z clamped
 *     to [0, H]; the ice keeps ships far from the poles).
 *  4. land (if `land` given, WORLD_SPEC §4.3, no damage): if distance(x,z) < hullRadius, push the
 *     ship out along the land normal by (hullRadius − d) (up to COLLISION_ITERATIONS times), and
 *     if it was moving into the land clamp |velocity| to maxSpeed·sqrt(1 − hn²), hn = heading·normal
 *     (the tangential share of top speed), so it slides along the coast at ≈ |cos(angle to the
 *     coast)| × maxSpeed; head-on stops. Heading never changes. (F1/B1: was a per-sub-step
 *     multiply, which compounded to ~0.1× speed; see the WORLD_SPEC clarification.)
 * Inputs are defensively clamped to {-1,0,1}, so malformed values cannot speed a ship up.
 */
export function stepShip(
  state: ShipKinematics,
  input: ShipInput,
  stats: ShipPhysicsStats,
  land?: LandQuery,
): ShipKinematics {
  const th = clampUnit(input.th);
  const ru = clampUnit(input.ru);
  const hull = stats.hullRadius ?? DEFAULT_HULL_RADIUS;
  let { x, z, rotationY, velocity } = state;

  for (let i = 0; i < SUBSTEPS; i++) {
    // 1. Rudder
    if (ru !== 0) rotationY = normalizeAngle(rotationY + ru * stats.turnSpeed);

    // 2. Throttle
    if (th === 1) {
      velocity = approach(velocity, -stats.maxSpeed, stats.forwardAccel);
    } else if (th === -1) {
      velocity = approach(velocity, stats.maxSpeed * stats.reverseFactor, stats.reverseAccel);
    } else if (velocity !== 0) {
      velocity *= DRAG_COEFFICIENT;
      if (Math.abs(velocity) < COAST_DECEL) velocity = 0;
      else velocity -= Math.sign(velocity) * COAST_DECEL;
    }

    // 3. Integrate (one 1/60 s frame: metric displacement = velocity * 1)
    const hx = Math.sin(rotationY);
    const hz = Math.cos(rotationY);
    if (velocity !== 0) {
      z = clampZ(z + hz * velocity);
      x = wrap(x + (hx * velocity) / metricX(z), WORLD_C);
    }

    // 4. Land: push out + slide (no damage).
    if (land) {
      for (let k = 0; k < COLLISION_ITERATIONS; k++) {
        const d = land.distance(x, z);
        if (d >= hull) break;
        const n = land.normal(x, z);
        if (n.nx === 0 && n.nz === 0) break; // flat field (deep inland): nothing to push along
        const push = hull - d;
        z = clampZ(z + n.nz * push);
        x = wrap(x + (n.nx * push) / metricX(z), WORLD_C);
        if (k === 0 && velocity !== 0) {
          // Motion is heading*velocity; it goes into the land when (heading·n)*velocity < 0.
          // Slide (WORLD_SPEC clarification after Q1 B1): CLAMP |velocity| to the tangential share
          // of top speed, maxSpeed·sqrt(1 − hn²) (sqrt(1 − hn²) = |sin| of the angle between the
          // heading and the coast normal). Clamping is idempotent, so a ship held against the coast
          // keeps that speed every sub-step instead of compounding a multiply 180 times a second
          // (which glued ships to the coast at ~0.1× speed). Head-on (|hn| = 1) still stops.
          const hn = hx * n.nx + hz * n.nz;
          if (hn * velocity < 0) {
            const cap = stats.maxSpeed * Math.sqrt(Math.max(0, 1 - hn * hn));
            if (Math.abs(velocity) > cap) velocity = Math.sign(velocity) * cap;
          }
        }
      }
    }
  }

  return { x, z, rotationY, velocity };
}

/** Clamp an untrusted number to the integer set {-1, 0, 1} (NaN → 0). */
function clampUnit(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Move `value` toward `target` by at most `step` (step >= 0), never overshooting. */
function approach(value: number, target: number, step: number): number {
  if (value > target) return Math.max(target, value - step);
  if (value < target) return Math.min(target, value + step);
  return target;
}

// ---------------------------------------------------------------------------------------------
// Wrap / angle helpers (wrap and wrappedDelta live in world/geo.ts and are re-exported above)
// ---------------------------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;

/**
 * @deprecated The world is no longer a torus. Use `metricDistSq` (geo.ts). Kept as an alias that
 * returns the METRIC squared distance so older call sites keep gameplay-correct behaviour; the
 * extra size arguments are ignored.
 */
export function wrappedDistSq(ax: number, az: number, bx: number, bz: number, _mapWidth?: number, _mapHeight?: number): number {
  return metricDistSq(ax, az, bx, bz);
}

/** Interpolate from a to b (t in [0,1]) along the shortest path across the seam; result wrapped. */
export function lerpWrapped(a: number, b: number, t: number, size: number): number {
  return wrap(a + wrappedDelta(a, b, size) * t, size);
}

/** Normalize an angle (radians) into [-π, π). */
export function normalizeAngle(a: number): number {
  return wrap(a + Math.PI, TWO_PI) - Math.PI;
}

/** Interpolate angles (radians) along the shortest arc; result normalized to [-π, π). */
export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}

/**
 * Coordinate-x advance of a straight metric path: a body moving `dist` metric units with unit
 * metric direction (dx, dz) from z0 moves x by dx · ∫₀^dist ds / metricX(z0 + dz·s).
 * Exact (closed form ∫ csc = ln tan(θ/2)), so stepping in pieces equals one big step.
 */
export function metricXAdvance(z0: number, dx: number, dz: number, dist: number): number {
  if (dx === 0 || dist === 0) return 0;
  const k = Math.PI / WORLD_H; // θ = k·z, metricX = sin θ
  const dzDist = dz * dist;
  if (Math.abs(dzDist) < 1e-6) return (dx * dist) / metricX(z0 + dzDist / 2);
  const eps = 1e-6;
  const th0 = Math.min(Math.PI - eps, Math.max(eps, k * z0));
  const th1 = Math.min(Math.PI - eps, Math.max(eps, k * (z0 + dzDist)));
  const integral = (Math.log(Math.tan(th1 / 2)) - Math.log(Math.tan(th0 / 2))) / (k * dz);
  return dx * integral;
}

// ---------------------------------------------------------------------------------------------
// Cannonballs
// ---------------------------------------------------------------------------------------------

/** Cannonball speed, metric units per 1/60 s (= 900 units/s). */
export const BALL_SPEED = 15;
/** Cannonball lifetime in milliseconds. */
export const BALL_LIFETIME_MS = 3000;
/** Angular spacing between balls of one broadside, radians. */
export const BALL_SPREAD = 0.1;
/** Metric distance from ship center at which balls spawn. */
export const BALL_SPAWN_OFFSET = 10;
/** Ship hit radius for cannonball collisions, metric units (same as the old server). */
export const SHIP_HIT_RADIUS = 20;

/** A cannonball's trajectory: spawn point (x, z) in coordinates and unit METRIC direction
 *  (dx, dz). `speed` is metric units per 1/60 s (defaults to BALL_SPEED). */
export interface BallSpawn {
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed?: number;
}

/**
 * Spawn one broadside, identical to the old server `fireCannonBall`: `cannonCount` balls fanned
 * BALL_SPREAD rad apart, centered on the broadside direction `rotationY + π/2`, each starting
 * BALL_SPAWN_OFFSET metric units from the ship center along its own direction (x wrapped).
 */
export function spawnBroadside(ship: Pick<ShipKinematics, "x" | "z" | "rotationY">, cannonCount: number): BallSpawn[] {
  const balls: BallSpawn[] = [];
  const n = Math.max(0, Math.floor(cannonCount));
  for (let i = 0; i < n; i++) {
    const offsetAngle = (i - (n - 1) / 2) * BALL_SPREAD;
    const angle = ship.rotationY + Math.PI / 2 + offsetAngle;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    balls.push({
      x: wrap(ship.x + metricXAdvance(ship.z, dx, dz, BALL_SPAWN_OFFSET), WORLD_C),
      z: ship.z + dz * BALL_SPAWN_OFFSET,
      dx,
      dz,
      speed: BALL_SPEED,
    });
  }
  return balls;
}

/** Position of a ball `elapsedSec` seconds after spawning (metric straight line, x wrapped). */
export function ballPositionAt(ball: BallSpawn, elapsedSec: number): { x: number; z: number } {
  return stepBall(ball, ball, elapsedSec);
}

/** Advance a ball's current position by `dt` seconds along its direction (metric, x wrapped).
 *  Exact: stepping n times by dt equals ballPositionAt(n·dt) up to float rounding. */
export function stepBall(
  pos: { x: number; z: number },
  ball: Pick<BallSpawn, "dx" | "dz" | "speed">,
  dt: number,
): { x: number; z: number } {
  const dist = (ball.speed ?? BALL_SPEED) * FRAMES_PER_SECOND * dt;
  return {
    x: wrap(pos.x + metricXAdvance(pos.z, ball.dx, ball.dz, dist), WORLD_C),
    z: pos.z + ball.dz * dist,
  };
}

/** True if a ball at (x, z) has hit land (distance < 0; includes the polar ice). */
export function ballHitsLand(land: LandQuery, x: number, z: number): boolean {
  return land.distance(x, z) < 0;
}

/**
 * Swept 2D hit test in METRIC space: does the segment (x0,z0)→(x1,z1) come within metric `r` of
 * the circle center (cx,cz)? Everything is taken relative to p0 with x deltas scaled by metricX at
 * the segment midpoint (segments are one tick long, so the scale is constant to ~1e-4). Seam-aware;
 * also true when the whole segment is inside the circle.
 */
export function segmentHitsCircle(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cx: number,
  cz: number,
  r: number,
): boolean {
  const k = metricX((z0 + z1) / 2);
  const dx = wrappedDelta(x0, x1, WORLD_C) * k;
  const dz = z1 - z0;
  const ccx = wrappedDelta(x0, cx, WORLD_C) * k;
  const ccz = cz - z0;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? (ccx * dx + ccz * dz) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = dx * t - ccx;
  const ez = dz * t - ccz;
  return ex * ex + ez * ez <= r * r;
}
