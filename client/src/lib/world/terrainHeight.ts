/**
 * Terrain height + colour from the land SDF (WORLD_SPEC §4). Pure, framework-free, unit-tested in
 * `__tests__/terrain.test.ts`. Used by the chunk builder in `terrain.ts`.
 *
 * Input is the metric signed distance d (`LandField.sdf`, + water / − land, ±508 range) plus world
 * x/z for noise. Output y is in render units (same as the scene; the ocean plane sits at WATER_Y):
 *  - water side (d > 0): a shelf sloping below the waterline (hidden by the opaque ocean);
 *  - d = 0 is the coastline, exactly at WATER_Y, so the drawn shore matches the physics coast;
 *  - land: a low beach (≤ BEACH_HEIGHT within BEACH_WIDTH of the coast), then a gentle rise inland,
 *    plus low fractal hills (fade in from ~60 u inland so beaches stay flat).
 * Noise is value noise on lattices that divide WORLD_C, so it is periodic in x: no seam at the wrap.
 */
import { WORLD_C } from "@shared/world/geo";

/** The ocean plane's height (Ocean.tsx). */
export const WATER_Y = -10;
/** Beach: rises to this height (render units) over BEACH_WIDTH metric units inland. */
export const BEACH_HEIGHT = 3;
export const BEACH_WIDTH = 40;
/** Inland slope after the beach (height per metric unit). */
export const INLAND_SLOPE = 0.16;
/** Max hill amplitude. */
export const HILL_HEIGHT = 75;
/** Underwater shelf slope and floor. */
export const SHELF_SLOPE = 0.25;
export const SHELF_FLOOR = -70;

// ---------------------------------------------------------------------------------------------
// Periodic value noise
// ---------------------------------------------------------------------------------------------

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise in [0, 1) at world (x, z) with lattice cell `cell` (coordinate units). `cell` must
 * divide WORLD_C so the noise is continuous across the x wrap.
 */
export function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const n = Math.round(WORLD_C / cell);
  const fx = x / cell;
  const fz = z / cell;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  let tx = fx - x0;
  let tz = fz - z0;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const ix0 = ((x0 % n) + n) % n;
  const ix1 = ix0 + 1 === n ? 0 : ix0 + 1;
  const a = hash2(ix0, z0, seed);
  const b = hash2(ix1, z0, seed);
  const c = hash2(ix0, z0 + 1, seed);
  const d = hash2(ix1, z0 + 1, seed);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * tz;
}

/** 3-octave fractal noise in [0, 1). Cells 1000 / 400 / 160 all divide WORLD_C. */
export function fbm(x: number, z: number, seed = 1): number {
  return (
    valueNoise(x, z, 1000, seed) * 0.55 + valueNoise(x, z, 400, seed + 1) * 0.3 + valueNoise(x, z, 160, seed + 2) * 0.15
  );
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Terrain height (render y) for SDF value `d` at world (x, z). `hill` = fbm(x, z) if precomputed. */
export function terrainHeight(d: number, x: number, z: number, hill: number = fbm(x, z)): number {
  if (d >= 0) return WATER_Y + Math.max(SHELF_FLOOR, -d * SHELF_SLOPE);
  const inland = -d;
  const beach = BEACH_HEIGHT * smoothstep(0, BEACH_WIDTH, inland);
  const rise = Math.max(0, inland - BEACH_WIDTH) * INLAND_SLOPE;
  const hills = HILL_HEIGHT * hill * hill * smoothstep(60, 320, inland);
  return WATER_Y + beach + rise + hills;
}

/** RGB in [0,1] written to out[o..o+2]. Colour bands: sand → grass / forest → rock. */
export function terrainColor(
  d: number,
  heightAboveWater: number,
  slope: number,
  forest: number,
  out: Float32Array,
  o: number,
): void {
  // wet sand under water / sand on the beach
  let r = 0.86,
    g = 0.79,
    b = 0.56;
  if (d >= 0) {
    r = 0.7;
    g = 0.65;
    b = 0.48;
  } else {
    const inland = -d;
    const grassT = smoothstep(BEACH_WIDTH * 0.7, BEACH_WIDTH * 1.4, inland);
    // grass vs forest
    const f = smoothstep(0.5, 0.62, forest);
    const gr = 0.36 + (0.15 - 0.36) * f;
    const gg = 0.56 + (0.33 - 0.56) * f;
    const gb = 0.24 + (0.14 - 0.24) * f;
    r += (gr - r) * grassT;
    g += (gg - g) * grassT;
    b += (gb - b) * grassT;
    // rock on high ground and steep slopes
    const rockT = Math.max(smoothstep(85, 120, heightAboveWater), smoothstep(0.55, 0.9, slope));
    r += (0.47 - r) * rockT;
    g += (0.44 - g) * rockT;
    b += (0.4 - b) * rockT;
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}
