// Shared constants and raster helpers for the offline world pipeline (scripts/world/build-world.ts).
// These numbers mirror docs/world/WORLD_SPEC.md §2 and §4.1. They are duplicated here on purpose so
// the generator does not depend on runtime code that other cards (W1) are rewriting in parallel.
// If the contract changes, change both.

export const WORLD_C = 400_000; // x wraps in [0, C)
export const WORLD_H = 200_000; // z in [0, H]; 0 = north pole
export const ICE_LAT = 70;
export const Z_ICE_N = (WORLD_H * (90 - ICE_LAT)) / 180;
export const Z_ICE_S = (WORLD_H * (90 + ICE_LAT)) / 180;

export const W = 8192; // raster width (pixels)
export const H = 4096; // raster height (pixels)
export const PX = WORLD_C / W; // 48.828125 units per pixel, both axes
export const TILE = 256;
export const TILES_X = W / TILE; // 32
export const TILES_Y = H / TILE; // 16
export const SDF_UNIT = 4;
export const SDF_MAX = 127;

export const lonToX = (lon: number) => ((lon + 180) / 360) * WORLD_C;
export const latToZ = (lat: number) => ((90 - lat) / 180) * WORLD_H;
export const xToLon = (x: number) => (x / WORLD_C) * 360 - 180;
export const zToLat = (z: number) => 90 - (z / WORLD_H) * 180;
export const metricX = (z: number) => Math.cos((zToLat(z) * Math.PI) / 180);

/** Latitude (degrees) of pixel row j's centre. */
export const rowLat = (j: number) => 90 - ((j + 0.5) / H) * 180;

export function wrap(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/** Shortest signed delta b - a on a ring of size m. */
export function wrappedDelta(a: number, b: number, m: number): number {
  let d = (b - a) % m;
  if (d > m / 2) d -= m;
  else if (d < -m / 2) d += m;
  return d;
}

/** Metric distance per spec §3 (dx scaled by cos of the mean latitude). */
export function metricDist(ax: number, az: number, bx: number, bz: number): number {
  const dx = wrappedDelta(ax, bx, WORLD_C) * metricX((az + bz) / 2);
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Bilinear SDF sample in metric units, exactly as spec §4.2 describes (pixel centres, i wraps,
 * j clamps). Does NOT include the polar ice (that is the runtime LandField's job).
 */
export function sampleSdf(sdf: Int8Array, x: number, z: number): number {
  const fx = x / PX - 0.5;
  const fz = z / PX - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  const ia = wrap(i0, W);
  const ib = wrap(i0 + 1, W);
  const ja = Math.min(H - 1, Math.max(0, j0));
  const jb = Math.min(H - 1, Math.max(0, j0 + 1));
  const v00 = sdf[ja * W + ia];
  const v10 = sdf[ja * W + ib];
  const v01 = sdf[jb * W + ia];
  const v11 = sdf[jb * W + ib];
  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return (top + (bot - top) * tz) * SDF_UNIT;
}

/** Pixel-centre coordinates. */
export const pixX = (i: number) => (i + 0.5) * PX;
export const pixZ = (j: number) => (j + 0.5) * PX;
