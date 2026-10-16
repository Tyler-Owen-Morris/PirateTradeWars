/**
 * Distance metric used by every NPC module (sensing, steering, tactics, LOD, director, fair play).
 *
 * WORLD_SPEC §3: every gameplay distance is the *metric* delta
 *   dx = wrappedDelta(a.x, b.x, C) * cos(lat((a.z + b.z) / 2)),  dz = b.z − a.z
 * (shared/world/geo.ts `metricDelta` / `metricDistSq`). x wraps on the 400 000 ring; z does NOT
 * wrap (it is clamped to [0, H]; the polar ice is land in the LandField). Moving by a metric offset
 * divides dx by metricX at the mid latitude of the move, so `delta(p, offset(p, d)) ≈ d`.
 *
 * All NPC modules take an `NpcMetric` and never do raw coordinate math, so tests can still inject a
 * flat torus (`torusMetric`) when a scenario is about logic rather than geography.
 */
import { WORLD_C, clampZ, metricDelta, metricDistSq, metricX, wrap, wrappedDelta } from "@shared/world/geo";

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
  /** Coordinate position reached by moving a metric offset (dx, dz) from (x, z); x wrapped, z clamped. */
  offset(x: number, z: number, dx: number, dz: number, out?: { x: number; z: number }): { x: number; z: number };
}

/** The wrapping-Earth metric (WORLD_SPEC §3): x wraps on WORLD_C and is scaled by cos(lat). */
export const geoMetric: NpcMetric = {
  delta(ax, az, bx, bz, out = { dx: 0, dz: 0 }) {
    return metricDelta(ax, az, bx, bz, out);
  },
  distSq(ax, az, bx, bz) {
    return metricDistSq(ax, az, bx, bz);
  },
  offset(x, z, dx, dz, out = { x: 0, z: 0 }) {
    const nz = clampZ(z + dz);
    out.x = wrap(x + dx / metricX((z + nz) / 2), WORLD_C);
    out.z = nz;
    return out;
  },
};

/** Wrap-aware flat metric on a W×H torus (both axes wrap). Only for logic-only unit tests. */
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

/** The metric used when the caller passes none: the wrapping-Earth geo metric. */
export function defaultMetric(): NpcMetric {
  return geoMetric;
}
