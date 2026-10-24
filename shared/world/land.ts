/**
 * Land sampling for the wrapping Earth (docs/world/WORLD_SPEC.md §4). ONE implementation used by
 * the server tick, client prediction, NPCs and rendering, so collisions agree everywhere.
 *
 * Data: a global signed-distance raster of SDF_W × SDF_H (8192 × 4096) Int8 pixels, cut into
 * 256 × 256 tiles (32 × 16). Pixel (i, j) is centred at x = (i + 0.5)·PX, z = (j + 0.5)·PX with
 * PX = C / 8192. Value v means a metric distance of v·SDF_UNIT to the nearest coast: + water,
 * − land, saturating at ±127 (±508 units). Tiles come from a `TileSource`:
 *   - server: every tile preloaded at boot (server/game/landLoader.ts);
 *   - client: fetched around the ship (client/src/lib/world/landTiles.ts), missing = water.
 *
 * `LandField.distance` = min(bilinear SDF, metric distance to the polar ice line), so the ice is
 * land too. Pure and deterministic; no I/O. Units: metric world units (see geo.ts).
 */
import { WORLD_C, WORLD_H, Z_ICE_N, Z_ICE_S, metricX, metricDelta, wrap, wrappedDelta } from "./geo";

/** Raster width in pixels (x, wraps). */
export const SDF_W = 8192;
/** Raster height in pixels (z, clamped). */
export const SDF_H = 4096;
/** Tile edge in pixels. */
export const TILE = 256;
/** Tiles across (x). */
export const TILES_X = SDF_W / TILE; // 32
/** Tiles down (z). */
export const TILES_Y = SDF_H / TILE; // 16
/** Pixel size in coordinate units (both axes): C / 8192 = 48.828125. */
export const PX = WORLD_C / SDF_W;
/** Metric units per SDF step: distance = value · SDF_UNIT. */
export const SDF_UNIT = 4;
/** Largest representable |value| (Int8 clamp). */
export const SDF_MAX = 127;
/** Metric distance reported for open water far from any coast (127 · 4 = 508). */
export const SDF_FAR = SDF_MAX * SDF_UNIT;

/** One tile: raw Int8 row-major TILE×TILE values, or a uniform all-water / all-land tile. */
export type TileData = Int8Array | "water" | "land";

/** Where a LandField gets its tiles. `undefined` = not loaded (treated as water, ready() false). */
export interface TileSource {
  get(tx: number, ty: number): TileData | undefined;
}

/** Shape of `client/public/world/land/manifest.json` (written by the W2 pipeline). */
export interface LandManifest {
  version: string;
  width: number;
  height: number;
  tile: number;
  px: number;
  sdfUnit: number;
  /** Ice lines in degrees (north 72, south 70; a single `iceLat: 70` before 2026-10-24). Informational:
   *  the runtime uses Z_ICE_N / Z_ICE_S from geo.ts. */
  iceLatN?: number;
  iceLatS?: number;
  /** Pre-2026-10-24 manifests. */
  iceLat?: number;
  /** Tile file encoding: "gzip" → files are `t_<tx>_<ty>.bin.gz` (gzipped, served as plain bytes);
   *  absent / "raw" → `t_<tx>_<ty>.bin`. Decompressed content is always TILE·TILE Int8 bytes. */
  encoding?: "gzip" | "raw";
  /** "tx_ty" keys of tiles whose every value is +127 (not shipped). */
  allWater: string[];
  /** "tx_ty" keys of tiles whose every value is −127 (not shipped). */
  allLand: string[];
}

/** Read-only land queries (spec §4.2). */
export interface LandQuery {
  /** Metric signed distance (units) at (x,z): + water, − land. Includes the polar ice:
   *  min(sdf(x,z), metric distance to the nearest ice line). */
  distance(x: number, z: number): number;
  /** Unit gradient of distance() (pointing toward water), metric, by central differences.
   *  {0,0} where the field is flat (deep inland / open sea far from any coast). */
  normal(x: number, z: number): { nx: number; nz: number };
  /** True if every tile needed around (x,z) within metric `radius` is loaded. */
  ready(x: number, z: number, radius: number): boolean;
}

/** Simple array-backed TileSource (server preload, client cache, tests). */
export class ArrayTileSource implements TileSource {
  private readonly tiles: (TileData | undefined)[] = new Array(TILES_X * TILES_Y);
  /** Default for tiles never set: `undefined` (unloaded) unless a fill is given. */
  constructor(fill?: TileData) {
    if (fill !== undefined) this.tiles.fill(fill);
  }
  get(tx: number, ty: number): TileData | undefined {
    return this.tiles[ty * TILES_X + tx];
  }
  set(tx: number, ty: number, data: TileData | undefined): void {
    this.tiles[ty * TILES_X + tx] = data;
  }
  has(tx: number, ty: number): boolean {
    return this.tiles[ty * TILES_X + tx] !== undefined;
  }
}

/** "tx_ty" key used by the manifest. */
export function tileKey(tx: number, ty: number): string {
  return `${tx}_${ty}`;
}

/** Tile containing coordinate (x, z) (x wrapped, z clamped). */
export function tileOf(x: number, z: number): { tx: number; ty: number } {
  const i = Math.floor(wrap(x, WORLD_C) / PX);
  let j = Math.floor(z / PX);
  if (j < 0) j = 0;
  else if (j >= SDF_H) j = SDF_H - 1;
  return { tx: Math.min(TILES_X - 1, i >> 8), ty: j >> 8 };
}

/**
 * Bilinear SDF sampler + ice (spec §4.2). Hot path: `distance` is called per ship per physics
 * sub-step on the server, so it avoids allocation; `normal` allocates one small object.
 */
export class LandField implements LandQuery {
  constructor(readonly source: TileSource) {}

  /** Metric SDF value of pixel (i, j); i wrapped into [0, SDF_W), j clamped into [0, SDF_H). */
  private pixel(i: number, j: number): number {
    const t = this.source.get(i >> 8, j >> 8);
    if (t === undefined || t === "water") return SDF_FAR;
    if (t === "land") return -SDF_FAR;
    return t[((j & 255) << 8) | (i & 255)] * SDF_UNIT;
  }

  /** Bilinear SDF only (no ice), metric units. */
  sdf(x: number, z: number): number {
    const fx = x / PX - 0.5;
    const fz = z / PX - 0.5;
    const i0f = Math.floor(fx);
    const j0f = Math.floor(fz);
    const tx = fx - i0f;
    const tz = fz - j0f;
    const i0 = ((i0f % SDF_W) + SDF_W) % SDF_W;
    const i1 = i0 + 1 === SDF_W ? 0 : i0 + 1;
    const j0 = j0f < 0 ? 0 : j0f >= SDF_H ? SDF_H - 1 : j0f;
    const j1 = j0f + 1 < 0 ? 0 : j0f + 1 >= SDF_H ? SDF_H - 1 : j0f + 1;
    const a = this.pixel(i0, j0);
    const b = this.pixel(i1, j0);
    const c = this.pixel(i0, j1);
    const d = this.pixel(i1, j1);
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return top + (bot - top) * tz;
  }

  distance(x: number, z: number): number {
    const iceN = z - Z_ICE_N;
    const iceS = Z_ICE_S - z;
    const ice = iceN < iceS ? iceN : iceS;
    // Deep in the ice the SDF cannot matter (it is ≥ −508 and ice is lower).
    if (ice < -SDF_FAR) return ice;
    const s = this.sdf(x, z);
    return s < ice ? s : ice;
  }

  normal(x: number, z: number): { nx: number; nz: number } {
    const h = PX;
    const hx = h / metricX(z);
    const gx = (this.distance(x + hx, z) - this.distance(x - hx, z)) / (2 * h);
    const gz = (this.distance(x, z + h) - this.distance(x, z - h)) / (2 * h);
    const len = Math.hypot(gx, gz);
    if (!(len > 1e-9)) return { nx: 0, nz: 0 };
    return { nx: gx / len, nz: gz / len };
  }

  ready(x: number, z: number, radius: number): boolean {
    const r = Math.max(0, radius) + PX;
    const z0 = Math.max(0, z - r);
    const z1 = Math.min(WORLD_H - 1e-6, z + r);
    const mx = Math.min(metricX(z0), metricX(z1));
    const rx = r / mx;
    const ty0 = tileOf(0, z0).ty;
    const ty1 = tileOf(0, z1).ty;
    let txs: number[];
    if (2 * rx >= WORLD_C - TILE * PX) {
      txs = Array.from({ length: TILES_X }, (_, k) => k);
    } else {
      const a = Math.floor((x - rx) / (TILE * PX));
      const b = Math.floor((x + rx) / (TILE * PX));
      txs = [];
      for (let k = a; k <= b; k++) txs.push(((k % TILES_X) + TILES_X) % TILES_X);
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      for (const tx of txs) if (this.source.get(tx, ty) === undefined) return false;
    }
    return true;
  }
}

/** Every tile is open water (only the polar ice is land). For tests and as a server fallback. */
export const ALWAYS_WATER_TEST_FIELD: LandField = new LandField(new ArrayTileSource("water"));

// ---------------------------------------------------------------------------------------------
// Synthetic fields for tests: real Int8 tiles, so they exercise the real sampler.
// ---------------------------------------------------------------------------------------------

/** A land shape for `buildSyntheticLand`. Circle radius is metric; rect corners are coordinates
 *  (x0 < x1 without wrapping, z0 < z1). */
export type SyntheticShape =
  | { kind: "circle"; x: number; z: number; r: number }
  | { kind: "rect"; x0: number; z0: number; x1: number; z1: number };

function shapeSignedDistance(s: SyntheticShape, x: number, z: number, scratch: { dx: number; dz: number }): number {
  if (s.kind === "circle") {
    metricDelta(s.x, s.z, x, z, scratch);
    return Math.hypot(scratch.dx, scratch.dz) - s.r;
  }
  const cx = (s.x0 + s.x1) / 2;
  const hx = ((s.x1 - s.x0) / 2) * metricX(z);
  const hz = (s.z1 - s.z0) / 2;
  const qx = Math.abs(wrappedDelta(cx, x, WORLD_C) * metricX(z)) - hx;
  const qz = Math.abs(z - (s.z0 + s.z1) / 2) - hz;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qz), 0);
  return outside + inside;
}

/**
 * Build a LandField from land shapes by rasterizing real SDF tiles (only tiles within reach of a
 * shape are rasterized; every other tile is 'water'). Returns the field and its source.
 */
export function buildSyntheticLand(shapes: SyntheticShape[]): { field: LandField; source: ArrayTileSource } {
  const source = new ArrayTileSource("water");
  const touched = new Set<number>();
  const margin = SDF_FAR + 2 * PX;
  const tileSize = TILE * PX;
  for (const s of shapes) {
    let x0: number, x1: number, z0: number, z1: number;
    if (s.kind === "circle") {
      z0 = s.z - s.r - margin;
      z1 = s.z + s.r + margin;
      const mx = Math.min(metricX(Math.max(0, z0)), metricX(Math.min(WORLD_H, z1)));
      x0 = s.x - (s.r + margin) / mx;
      x1 = s.x + (s.r + margin) / mx;
    } else {
      z0 = s.z0 - margin;
      z1 = s.z1 + margin;
      const mx = Math.min(metricX(Math.max(0, z0)), metricX(Math.min(WORLD_H, z1)));
      x0 = s.x0 - margin / mx;
      x1 = s.x1 + margin / mx;
    }
    const ty0 = Math.max(0, Math.floor(z0 / tileSize));
    const ty1 = Math.min(TILES_Y - 1, Math.floor(z1 / tileSize));
    const ta = Math.floor(x0 / tileSize);
    const tb = Math.floor(x1 / tileSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let k = ta; k <= tb && k - ta < TILES_X; k++) touched.add(ty * TILES_X + (((k % TILES_X) + TILES_X) % TILES_X));
    }
  }
  const scratch = { dx: 0, dz: 0 };
  touched.forEach((key) => {
    const tx = key % TILES_X;
    const ty = (key - tx) / TILES_X;
    const data = new Int8Array(TILE * TILE);
    for (let jj = 0; jj < TILE; jj++) {
      const z = (ty * TILE + jj + 0.5) * PX;
      for (let ii = 0; ii < TILE; ii++) {
        const x = (tx * TILE + ii + 0.5) * PX;
        let d = Infinity;
        for (const s of shapes) {
          const sd = shapeSignedDistance(s, x, z, scratch);
          if (sd < d) d = sd;
        }
        const v = Math.round(d / SDF_UNIT);
        data[(jj << 8) | ii] = v > SDF_MAX ? SDF_MAX : v < -SDF_MAX ? -SDF_MAX : v;
      }
    }
    source.set(tx, ty, data);
  });
  return { field: new LandField(source), source };
}
