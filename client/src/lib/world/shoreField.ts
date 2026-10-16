/**
 * Shore distance texture for the ocean shader (shallow-water tint + surf foam). Framework-free;
 * unit-tested in `__tests__/terrain.test.ts`. Ocean.tsx uploads `front` as a DataTexture.
 *
 * A SIZE×SIZE grid of `LandField.distance` samples (metric, includes the polar ice) covering
 * ±HALF metric units around the focus, encoded as Uint8: byte = clamp(round(d / 4) + 128, 0, 255)
 * (the SDF's own ±508 range and 4-unit step). Texel centres are fixed in TRAVEL space
 * (renderFocus.travel, i.e. world-anchored for the purposes of a few km), so a finished texture
 * stays valid while the ship moves: the shader maps a fragment at render position p to
 *     uv = (p + travelNow − centerTravel) / (2·HALF) + 0.5
 * and the CPU passes `centerTravel − travelNow` (float64 difference) as a small uniform.
 *
 * The grid is rebuilt (time-sliced, ROWS_PER_STEP rows per call, into a back buffer) when the focus
 * has moved more than REBUILD_DISTANCE from the texture centre or the land tiles changed. On
 * completion the back buffer is swapped into `front` and `revision` bumps.
 * Sample position for texel (i, j): render offset (u, v) from the focus at build start →
 * world z = F.z + v, x = F.x + u / metricX(z) (the inverse of renderSpace.toRender).
 */
import { metricX } from "@shared/world/geo";
import type { LandQuery } from "@shared/world/land";

export const SHORE_SIZE = 256;
/** Half extent (metric units) of the texture; it must cover the visible ocean (camera far 2500). */
export const SHORE_HALF = 3000;
export const REBUILD_DISTANCE = 500;
export const ROWS_PER_STEP = 16;

export function encodeShore(d: number): number {
  const v = Math.round(d / 4) + 128;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
export function decodeShore(b: number): number {
  return (b - 128) * 4;
}

export class ShoreField {
  readonly size: number;
  readonly half: number;
  /** Finished texture data (row j = +z, column i = +x). */
  front: Uint8Array;
  /** Travel-space centre of `front`. */
  centerX = 0;
  centerZ = 0;
  /** Bumps whenever `front` changes. 0 = nothing built yet. */
  revision = 0;
  private back: Uint8Array;
  private building = false;
  private row = 0;
  private bFx = 0;
  private bFz = 0;
  private bTx = 0;
  private bTz = 0;
  private builtVersion = -1;
  private buildVersion = -1;

  constructor(
    private readonly land: LandQuery,
    size = SHORE_SIZE,
    half = SHORE_HALF,
  ) {
    this.size = size;
    this.half = half;
    this.front = new Uint8Array(size * size).fill(255);
    this.back = new Uint8Array(size * size);
  }

  /**
   * Advance by one slice. `fx, fz` = focus (raw world coords), `tx, tz` = renderFocus.travel,
   * `version` = land tile version. Returns true if `front` was swapped this call.
   */
  step(fx: number, fz: number, tx: number, tz: number, version: number, rows = ROWS_PER_STEP): boolean {
    if (!this.building) {
      const moved = Math.hypot(tx - this.centerX, tz - this.centerZ);
      if (this.revision !== 0 && moved < REBUILD_DISTANCE && version === this.builtVersion) return false;
      this.building = true;
      this.row = 0;
      this.bFx = fx;
      this.bFz = fz;
      this.bTx = tx;
      this.bTz = tz;
      this.buildVersion = version;
    }
    const n = this.size;
    const texel = (2 * this.half) / n;
    const end = Math.min(n, this.row + rows);
    for (let j = this.row; j < end; j++) {
      const v = -this.half + (j + 0.5) * texel;
      const z = this.bFz + v;
      const inv = 1 / metricX(z);
      for (let i = 0; i < n; i++) {
        const u = -this.half + (i + 0.5) * texel;
        this.back[j * n + i] = encodeShore(this.land.distance(this.bFx + u * inv, z));
      }
    }
    this.row = end;
    if (this.row < n) return false;
    const t = this.front;
    this.front = this.back;
    this.back = t;
    this.centerX = this.bTx;
    this.centerZ = this.bTz;
    this.builtVersion = this.buildVersion;
    this.building = false;
    this.revision++;
    return true;
  }

  /** Decoded distance at a render offset from the CURRENT focus (tests / debugging). */
  sampleRender(rx: number, rz: number, tx: number, tz: number): number {
    const n = this.size;
    const texel = (2 * this.half) / n;
    const i = Math.floor((rx + tx - this.centerX + this.half) / texel);
    const j = Math.floor((rz + tz - this.centerZ + this.half) / texel);
    if (i < 0 || j < 0 || i >= n || j >= n) return decodeShore(255);
    return decodeShore(this.front[j * n + i]);
  }
}
