/**
 * Distance metric used by every NPC module (sensing, steering, tactics, LOD, director, fair play).
 *
 * WORLD_SPEC §3: every gameplay distance is the *metric* delta
 *   dx = wrappedDelta(a.x, b.x, C) * cos(lat((a.z + b.z) / 2)),  dz = b.z − a.z
 * and moving by a metric offset divides x by metricX(z).
 *
 * TODO(W1): W1 is adding `metricDelta` / `metricDistSq` / `metricX` to `shared/world/geo.ts`. Until
 * that lands, `torusMetric` is a wrap-aware flat placeholder over the current 10000² torus. When W1
 * merges, replace the body of `defaultMetric()` with a metric built on shared/world/geo.ts (x wraps,
 * z clamped, x scaled by metricX). Nothing else in server/game/npc/ needs to change: all modules
 * take an `NpcMetric` and never do raw coordinate math.
 */
import { wrap, wrappedDelta } from "@shared/physics";

/** Metric delta (world units, "ground" distance). */
export interface MetricDelta {
  dx: number;
  dz: number;
}

/** Pluggable distance metric. All deltas and offsets are metric (ground) units. */
export interface NpcMetric {
  /** Metric delta from a to b, written into `out` (returned). */
  delta(ax: number, az: number, bx: number, bz: number, out?: MetricDelta): MetricDelta;
  /** Squared metric distance between a and b. */
  distSq(ax: number, az: number, bx: number, bz: number): number;
  /** Coordinate position reached by moving a metric offset (dx, dz) from (x, z); wrapped. */
  offset(x: number, z: number, dx: number, dz: number, out?: { x: number; z: number }): { x: number; z: number };
}

/** Wrap-aware flat metric on a W×H torus. TODO(W1): placeholder until shared/world/geo.ts lands. */
export function torusMetric(width: number, height: number): NpcMetric {
  return {
    delta(ax, az, bx, bz, out = { dx: 0, dz: 0 }) {
      out.dx = wrappedDelta(ax, bx, width);
      out.dz = wrappedDelta(az, bz, height);
      return out;
    },
    distSq(ax, az, bx, bz) {
      const dx = wrappedDelta(ax, bx, width);
      const dz = wrappedDelta(az, bz, height);
      return dx * dx + dz * dz;
    },
    offset(x, z, dx, dz, out = { x: 0, z: 0 }) {
      out.x = wrap(x + dx, width);
      out.z = wrap(z + dz, height);
      return out;
    },
  };
}

/** The metric used when the caller passes none. TODO(W1): switch to shared/world/geo.ts metric. */
export function defaultMetric(width: number, height: number): NpcMetric {
  return torusMetric(width, height);
}
