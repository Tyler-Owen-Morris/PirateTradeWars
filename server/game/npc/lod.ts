/**
 * Simulation tiers (proposal §3 "Keeping it cheap") and lane polylines. Pure.
 *
 * | Tier    | When                         | Cost                                        |
 * |---------|------------------------------|---------------------------------------------|
 * | active  | a player within 2500         | a real World ship: physics, steering, AI    |
 * | rail    | no player near, has a lane   | a virtual record moved along the lane 2×/s  |
 * | docked  | in port                      | a departure timer only                      |
 *
 * Only `active` NPCs exist in the World (and so in the grid, snapshots and physics). Promotion
 * happens at ACTIVE_RADIUS (2500), beyond the client interest radius (2000), so nobody sees a ship
 * pop in. Demotion uses DEMOTE_RADIUS (2800) for hysteresis and is refused while in combat.
 *
 * Lanes (WORLD_SPEC §6): `{from, to, points: [[x, z], …]}` with x unwrapped along the route
 * (consecutive points differ by < C/2); consumers wrap. Lengths are measured with the NpcMetric.
 */
import type { NpcMetric } from "./metric";

export type LodTier = "active" | "rail" | "docked";

export const ACTIVE_RADIUS = 2500;
export const DEMOTE_RADIUS = 2800;
/** Rail records advance every this many ms (0.5 s). */
export const RAIL_STEP_MS = 500;

/** WORLD_SPEC §6 lane. `from`/`to` are port ids. */
export interface Lane {
  from: string;
  to: string;
  points: [number, number][];
}

/** A lane with cumulative metric lengths, for O(log n) position lookups. */
export interface Polyline {
  lane: Lane;
  /** cum[i] = metric length from points[0] to points[i]. */
  cum: number[];
  total: number;
}

export function buildPolyline(lane: Lane, m: NpcMetric): Polyline {
  const cum = [0];
  let total = 0;
  const d = { dx: 0, dz: 0 };
  for (let i = 1; i < lane.points.length; i++) {
    const [ax, az] = lane.points[i - 1];
    const [bx, bz] = lane.points[i];
    m.delta(ax, az, bx, bz, d);
    total += Math.hypot(d.dx, d.dz);
    cum.push(total);
  }
  return { lane, cum, total };
}

/** Point (wrapped coordinates) and travel direction (metric unit vector) at distance `s` along the
 *  polyline, `dir` = +1 from→to, −1 to→from. */
export function pointAt(poly: Polyline, s: number, m: NpcMetric, dir: 1 | -1 = 1): { x: number; z: number; dx: number; dz: number } {
  const pts = poly.lane.points;
  if (pts.length === 1) {
    const p = m.offset(pts[0][0], pts[0][1], 0, 0);
    return { x: p.x, z: p.z, dx: 0, dz: -1 };
  }
  const t = Math.max(0, Math.min(poly.total, s));
  // binary search segment
  let lo = 0;
  let hi = poly.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poly.cum[mid] <= t) lo = mid;
    else hi = mid;
  }
  const segLen = poly.cum[hi] - poly.cum[lo];
  const f = segLen > 0 ? (t - poly.cum[lo]) / segLen : 0;
  const [ax, az] = pts[lo];
  const [bx, bz] = pts[hi];
  const d = m.delta(ax, az, bx, bz);
  const p = m.offset(ax, az, d.dx * f, d.dz * f);
  const l = Math.hypot(d.dx, d.dz) || 1;
  return { x: p.x, z: p.z, dx: (d.dx / l) * dir, dz: (d.dz / l) * dir };
}

/** Distance along the polyline of the point nearest (x, z) (for demotion onto a lane). */
export function projectOnto(poly: Polyline, x: number, z: number, m: NpcMetric): { s: number; distSq: number } {
  const pts = poly.lane.points;
  let best = { s: 0, distSq: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const seg = m.delta(ax, az, bx, bz);
    const rel = m.delta(ax, az, x, z);
    const l2 = seg.dx * seg.dx + seg.dz * seg.dz;
    const f = l2 > 0 ? Math.max(0, Math.min(1, (rel.dx * seg.dx + rel.dz * seg.dz) / l2)) : 0;
    const ex = rel.dx - seg.dx * f;
    const ez = rel.dz - seg.dz * f;
    const d2 = ex * ex + ez * ez;
    if (d2 < best.distSq) best = { s: poly.cum[i - 1] + f * (poly.cum[i] - poly.cum[i - 1]), distSq: d2 };
  }
  if (pts.length === 1) best = { s: 0, distSq: m.distSq(pts[0][0], pts[0][1], x, z) };
  return best;
}

/** Rail progress along a lane. `s` measured from `from`; `dir` −1 sails it backwards. */
export interface RailState {
  poly: Polyline;
  s: number;
  dir: 1 | -1;
  /** Metric units per second. */
  speed: number;
}

/** Advance a rail by dtSec. Returns true when it reached the end of the lane. */
export function advanceRail(r: RailState, dtSec: number): boolean {
  r.s += r.dir * r.speed * dtSec;
  if (r.dir === 1 && r.s >= r.poly.total) {
    r.s = r.poly.total;
    return true;
  }
  if (r.dir === -1 && r.s <= 0) {
    r.s = 0;
    return true;
  }
  return false;
}

/** Port id the rail is sailing toward. */
export function railDestination(r: RailState): string {
  return r.dir === 1 ? r.poly.lane.to : r.poly.lane.from;
}

/**
 * Tier transition rule. `nearestPlayerDistSq` = squared metric distance to the closest live player
 * (Infinity if none). Docked records stay docked (the director undocks them on their timer), except
 * that a docked NPC is NOT promoted: it is in port and invisible by design.
 */
export function nextTier(current: LodTier, nearestPlayerDistSq: number, inCombat: boolean): LodTier {
  if (current === "docked") return "docked";
  if (current === "rail") return nearestPlayerDistSq <= ACTIVE_RADIUS * ACTIVE_RADIUS ? "active" : "rail";
  // active
  if (inCombat) return "active";
  return nearestPlayerDistSq > DEMOTE_RADIUS * DEMOTE_RADIUS ? "rail" : "active";
}
