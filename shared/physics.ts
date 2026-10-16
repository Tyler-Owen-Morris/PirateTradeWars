/**
 * Shared deterministic simulation for Pirate Trade Wars (see docs/netcode/PROTOCOL.md §2).
 *
 * This module is imported by BOTH the server (authoritative tick) and the client (prediction +
 * reconciliation + remote interpolation). It must stay pure and dependency-free: no imports from
 * `client/` or `server/`, no DOM / Node APIs, no randomness, no clocks. The only import is the
 * sibling `./gameConstants` (relative, so it resolves under Vite, esbuild and vitest without aliases).
 *
 * Units (unchanged from the pre-netcode game):
 * - Distance: world units. The world is a torus of MAP_WIDTH x MAP_HEIGHT (10000 x 10000) that wraps.
 * - Speed / velocity: "units per 1/60 s frame". Displacement over dt seconds = velocity * dt * 60.
 * - Angles: radians. `rotationY` is the rotation about +Y; the heading (bow) vector is
 *   (sin(rotationY), cos(rotationY)) in (x, z) — i.e. (0,0,1) rotated about Y, same as three.js.
 * - Time: TICK_DT and the `elapsedSec` arguments are seconds; *_MS constants are milliseconds.
 *
 * Sign convention (preserved from the live game): NEGATIVE velocity = sailing forward (W key).
 *
 * Determinism: given the same starting state and the same input sequence, `stepShip` produces
 * bit-identical results in the same JS engine. Math.sin/Math.cos may differ in the last ulp between
 * engines (browser vs Node); that is fine because the server is authoritative and the client
 * reconciles to every snapshot.
 */
import { MAP_HEIGHT, MAP_WIDTH, SHIP_STATS, SHIP_TYPES } from "./gameConstants";

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

/** Ship kinematic state. x/z in world units (always wrapped into [0, MAP)), rotationY in radians
 *  normalized to [-π, π), velocity in units per 1/60 s (negative = forward). */
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
 *  accelerations are units/frame per frame. */
export interface ShipPhysicsStats {
  /** Forward top speed (magnitude). Forward velocity tends to −maxSpeed. */
  maxSpeed: number;
  forwardAccel: number;
  reverseAccel: number;
  /** Reverse top speed = maxSpeed * reverseFactor. */
  reverseFactor: number;
  turnSpeed: number;
}

/** Physics stats for a ship type (from SHIP_STATS[shipType].speed). Unknown types fall back to sloop. */
export function shipPhysicsStats(shipType: string): ShipPhysicsStats {
  const stats = SHIP_STATS[shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
  return physicsStatsFromMaxSpeed(stats.speed);
}

/** Physics stats from an explicit max speed (units per 1/60 s), using the default tuning. */
export function physicsStatsFromMaxSpeed(maxSpeed: number): ShipPhysicsStats {
  return {
    maxSpeed,
    forwardAccel: FORWARD_ACCEL,
    reverseAccel: REVERSE_ACCEL,
    reverseFactor: REVERSE_SPEED_FACTOR,
    turnSpeed: TURN_SPEED,
  };
}

/**
 * Advance a ship by exactly one simulation tick (TICK_DT = 0.05 s = SUBSTEPS frames of 1/60 s).
 * Pure: returns a NEW object, never mutates `state`. Per sub-step, in order:
 *  1. rotationY += ru * turnSpeed
 *  2. velocity moves toward the throttle target (−maxSpeed for th=1, +maxSpeed*reverseFactor for
 *     th=−1) by the accel; with th=0 it is multiplied by DRAG_COEFFICIENT, then reduced by
 *     COAST_DECEL toward 0 and snapped to exactly 0 once |v| < COAST_DECEL.
 *  3. position += heading(rotationY) * velocity (one frame of displacement), wrapped to the map.
 * Inputs are defensively clamped to {-1,0,1}, so malformed values cannot speed a ship up.
 */
export function stepShip(
  state: ShipKinematics,
  input: ShipInput,
  stats: ShipPhysicsStats,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): ShipKinematics {
  const th = clampUnit(input.th);
  const ru = clampUnit(input.ru);
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

    // 3. Integrate (one 1/60 s frame: displacement = velocity * 1)
    if (velocity !== 0) {
      x = wrap(x + Math.sin(rotationY) * velocity, mapWidth);
      z = wrap(z + Math.cos(rotationY) * velocity, mapHeight);
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
// Wrap / angle helpers (the world is a torus)
// ---------------------------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;

/** Wrap a coordinate into [0, size). */
export function wrap(v: number, size: number): number {
  const r = ((v % size) + size) % size;
  // (-tiny % size) + size can round to exactly `size`; keep the half-open interval.
  return r >= size ? 0 : r;
}

/** Shortest signed delta from a to b on a ring of length `size`; result in [-size/2, size/2).
 *  b ≈ a + wrappedDelta(a, b, size) (mod size). */
export function wrappedDelta(a: number, b: number, size: number): number {
  return wrap(b - a + size / 2, size) - size / 2;
}

/** Squared shortest distance between two points on the wrapped map (units²). */
export function wrappedDistSq(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): number {
  const dx = wrappedDelta(ax, bx, mapWidth);
  const dz = wrappedDelta(az, bz, mapHeight);
  return dx * dx + dz * dz;
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

// ---------------------------------------------------------------------------------------------
// Cannonballs
// ---------------------------------------------------------------------------------------------

/** Cannonball speed, units per 1/60 s (= 900 units/s). */
export const BALL_SPEED = 15;
/** Cannonball lifetime in milliseconds. */
export const BALL_LIFETIME_MS = 3000;
/** Angular spacing between balls of one broadside, radians. */
export const BALL_SPREAD = 0.1;
/** Distance from ship center at which balls spawn, world units. */
export const BALL_SPAWN_OFFSET = 10;
/** Ship hit radius for cannonball collisions, world units (same as the old server). */
export const SHIP_HIT_RADIUS = 20;

/** A cannonball's analytic trajectory: spawn point (x, z) in world units and unit direction
 *  (dx, dz). `speed` is units per 1/60 s (defaults to BALL_SPEED). */
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
 * BALL_SPAWN_OFFSET units from the ship center along its own direction (wrapped).
 */
export function spawnBroadside(
  ship: Pick<ShipKinematics, "x" | "z" | "rotationY">,
  cannonCount: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): BallSpawn[] {
  const balls: BallSpawn[] = [];
  const n = Math.max(0, Math.floor(cannonCount));
  for (let i = 0; i < n; i++) {
    const offsetAngle = (i - (n - 1) / 2) * BALL_SPREAD;
    const angle = ship.rotationY + Math.PI / 2 + offsetAngle;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    balls.push({
      x: wrap(ship.x + dx * BALL_SPAWN_OFFSET, mapWidth),
      z: wrap(ship.z + dz * BALL_SPAWN_OFFSET, mapHeight),
      dx,
      dz,
      speed: BALL_SPEED,
    });
  }
  return balls;
}

/** Position of a ball `elapsedSec` seconds after spawning: p0 + dir * speed * 60 * t (wrapped). */
export function ballPositionAt(
  ball: BallSpawn,
  elapsedSec: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): { x: number; z: number } {
  const dist = (ball.speed ?? BALL_SPEED) * FRAMES_PER_SECOND * elapsedSec;
  return {
    x: wrap(ball.x + ball.dx * dist, mapWidth),
    z: wrap(ball.z + ball.dz * dist, mapHeight),
  };
}

/** Advance a ball's current position by `dt` seconds along its direction (wrapped). */
export function stepBall(
  pos: { x: number; z: number },
  ball: Pick<BallSpawn, "dx" | "dz" | "speed">,
  dt: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): { x: number; z: number } {
  const dist = (ball.speed ?? BALL_SPEED) * FRAMES_PER_SECOND * dt;
  return {
    x: wrap(pos.x + ball.dx * dist, mapWidth),
    z: wrap(pos.z + ball.dz * dist, mapHeight),
  };
}

/**
 * Swept 2D hit test: does the segment (x0,z0)→(x1,z1) come within `r` of the circle center
 * (cx,cz)? Wrap-aware: the segment is taken as the shortest path from p0 to p1 across the seam,
 * and the circle is measured relative to p0 by shortest delta, so hits across the map edge count.
 * Unlike the old 3D sphere test this also returns true when the whole segment is inside the circle.
 * Segments are assumed shorter than half the map (true for any one-tick ball move).
 */
export function segmentHitsCircle(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cx: number,
  cz: number,
  r: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): boolean {
  // Everything relative to p0.
  const dx = wrappedDelta(x0, x1, mapWidth);
  const dz = wrappedDelta(z0, z1, mapHeight);
  const ccx = wrappedDelta(x0, cx, mapWidth);
  const ccz = wrappedDelta(z0, cz, mapHeight);
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? (ccx * dx + ccz * dz) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = dx * t - ccx;
  const ez = dz * t - ccz;
  return ex * ex + ez * ez <= r * r;
}
