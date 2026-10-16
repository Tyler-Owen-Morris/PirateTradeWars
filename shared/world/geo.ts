/**
 * World geometry for the wrapping Earth (docs/world/WORLD_SPEC.md §2, §3). Pure, dependency-free:
 * imported by shared/physics.ts, shared/world/land.ts, the server and the client.
 *
 * Coordinates:
 * - x is longitude and WRAPS in [0, WORLD_C). x = 0 is lon −180, x = C/2 is lon 0 (Greenwich).
 * - z is latitude and does NOT wrap: z = 0 is the north pole, z = WORLD_H the south pole, H/2 the
 *   equator. North is −z. Play is closed by polar pack ice at |lat| > ICE_LAT (Z_ICE_N / Z_ICE_S);
 *   the ice is land in shared/world/land.ts.
 * - 1 unit ≈ 100 m. z units are metric everywhere; an x unit is metricX(z) metric units long
 *   (cos of the latitude), so 1 unit of x at lat 60 is half a metric unit.
 *
 * Every gameplay distance (interest, hits, gold pickup, port radius, NPC sensing, minimap) must use
 * `metricDelta` / `metricDistSq`, never raw coordinate deltas.
 */

/** Circumference: x wraps in [0, WORLD_C). About a 20-minute lap of the equator. */
export const WORLD_C = 400_000;
/** Pole-to-pole extent: z in [0, WORLD_H]. z = 0 north pole, z = WORLD_H south pole. */
export const WORLD_H = 200_000;
/** Sphere radius in units (C / 2π ≈ 63 662). */
export const WORLD_R = WORLD_C / (2 * Math.PI);
/** |latitude| above this (degrees) is impassable pack ice. */
export const ICE_LAT = 70;
/** z of the northern ice line (lat +70), ≈ 22 222.2. z < Z_ICE_N is ice. */
export const Z_ICE_N = (WORLD_H * (90 - ICE_LAT)) / 180;
/** z of the southern ice line (lat −70), ≈ 177 777.8. z > Z_ICE_S is ice. */
export const Z_ICE_S = (WORLD_H * (90 + ICE_LAT)) / 180;
/**
 * Version stamp of the coordinate system, persisted on player records (`worldVersion`). Records
 * without it (or with an older value) are from the retired 10000×10000 torus and get relocated.
 */
export const WORLD_VERSION = 2;
/** metricX never goes below this (only reachable outside play, beyond the ice), avoiding /0. */
export const MIN_METRIC_X = 0.01;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Wrap helpers (x ring). Re-exported by shared/physics.ts.
// ---------------------------------------------------------------------------------------------

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

/** Wrap an x coordinate into [0, WORLD_C). */
export function wrapX(x: number): number {
  return wrap(x, WORLD_C);
}

/** Clamp z into [0, WORLD_H] (z does not wrap). */
export function clampZ(z: number): number {
  return z < 0 ? 0 : z > WORLD_H ? WORLD_H : z;
}

// ---------------------------------------------------------------------------------------------
// Longitude / latitude
// ---------------------------------------------------------------------------------------------

/** Longitude (degrees, [−180, 180)) of coordinate x. */
export function lonOf(x: number): number {
  return (wrapX(x) / WORLD_C) * 360 - 180;
}
/** Coordinate x (in [0, C)) of longitude `lon` (degrees). */
export function xOfLon(lon: number): number {
  return wrapX(((lon + 180) / 360) * WORLD_C);
}
/** Latitude (degrees, +90 north pole … −90 south pole) of coordinate z. */
export function latOf(z: number): number {
  return 90 - (z / WORLD_H) * 180;
}
/** Coordinate z of latitude `lat` (degrees). */
export function zOfLat(lat: number): number {
  return ((90 - lat) / 180) * WORLD_H;
}

/**
 * East-west scale factor at z: cos(lat(z)) = sin(π·z/H). One x unit is metricX(z) metric units.
 * Clamped to ≥ MIN_METRIC_X (in play it is ≥ cos 70° ≈ 0.342).
 */
export function metricX(z: number): number {
  const m = Math.sin((z * Math.PI) / WORLD_H);
  return m > MIN_METRIC_X ? m : MIN_METRIC_X;
}

// ---------------------------------------------------------------------------------------------
// Metric distances (spec §3): x delta is scaled by cos(lat) at the mid z.
// ---------------------------------------------------------------------------------------------

/** Metric delta from a to b: dx = wrappedDelta(ax,bx,C)·metricX((az+bz)/2), dz = bz − az. */
export function metricDelta(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out: { dx: number; dz: number } = { dx: 0, dz: 0 },
): { dx: number; dz: number } {
  out.dx = wrappedDelta(ax, bx, WORLD_C) * metricX((az + bz) / 2);
  out.dz = bz - az;
  return out;
}

/** Squared metric distance between a and b (units²). Allocation-free. */
export function metricDistSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = wrappedDelta(ax, bx, WORLD_C) * metricX((az + bz) / 2);
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Metric distance between a and b (units). */
export function metricDist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(metricDistSq(ax, az, bx, bz));
}

// ---------------------------------------------------------------------------------------------
// Compass
// ---------------------------------------------------------------------------------------------

/**
 * Compass heading in degrees, clockwise from north, in [0, 360), of a ship with `rotationY`
 * (spec §2). Sailing forward (negative velocity) with rotationY = 0 goes north (−z) = 0°;
 * rotationY = −π/2 goes east (+x) = 90°.
 */
export function compassHeading(rotationY: number): number {
  const deg = (-rotationY * 180) / Math.PI;
  const h = ((deg % 360) + 360) % 360;
  return h >= 360 ? 0 : h;
}

/** rotationY (radians, [−π, π)) whose compass heading is `headingDeg`. Inverse of compassHeading. */
export function rotationForHeading(headingDeg: number): number {
  const r = -headingDeg * DEG;
  const t = Math.PI * 2;
  return ((((r + Math.PI) % t) + t) % t) - Math.PI;
}

/** Compass bearing (degrees clockwise from north, [0, 360)) from a to b, using the metric delta. */
export function bearingDeg(ax: number, az: number, bx: number, bz: number): number {
  const dx = wrappedDelta(ax, bx, WORLD_C) * metricX((az + bz) / 2);
  const dz = bz - az;
  // north = −z
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const h = (deg + 360) % 360;
  return h >= 360 ? 0 : h;
}
