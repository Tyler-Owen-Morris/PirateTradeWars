/**
 * Minimap land drawn straight from the SDF tiles (the same `clientLand` field that drives
 * prediction), so coasts stay sharp at every minimap zoom. The 1024×512 chart texture is ~390 units
 * per pixel, so at the closest zoom (3000 units across 200 px) it was magnified ~25× and read as
 * big blocks; the SDF is 48.8 units per pixel and bilinear, and the coast is anti-aliased at the
 * zero crossing over one device pixel.
 *
 * Colours follow scripts/world/lib/map.ts (the chart texture), duplicated on purpose: that is a
 * build script with no runtime imports. Pixels whose tile is not loaded yet are left transparent,
 * so the texture drawn underneath shows through until the tile arrives.
 *
 * `MinimapLandLayer` renders into an offscreen buffer 1.5× the minimap around an anchor point and
 * just shifts it while the ship moves, re-rendering only when the shift gets large, the zoom
 * changes or a tile arrives (`clientLand.version`).
 */
import { iceLatFor, latOf, metricX, wrappedDelta, WORLD_C, WORLD_H } from "@shared/world/geo";
import { PX, SDF_FAR, SDF_H, SDF_UNIT, SDF_W, TILES_X, type LandField, type TileData } from "@shared/world/land";

type RGB = readonly [number, number, number];
const SEA_DEEP: RGB = [118, 156, 165];
const SEA_SHALLOW: RGB = [168, 199, 194];
const RIPPLE: RGB = [96, 132, 140];
const INK: RGB = [74, 52, 32];
const LAND_COAST: RGB = [226, 206, 158];
const LAND_INNER: RGB = [204, 178, 124];
const ICE: RGB = [234, 240, 242];
const ICE_EDGE: RGB = [180, 196, 204];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Writes the chart colour for SDF value `d` (metric, + water), latitude `lat` and `upp` metric units
 *  per output pixel into out[o..o+3] (opaque). */
export function chartColor(d: number, lat: number, upp: number, out: Uint8ClampedArray, o: number): void {
  // sea
  const ds = d > 0 ? d : 0;
  const ts = Math.sqrt(Math.min(1, ds / 350));
  let sr = SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * ts;
  let sg = SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * ts;
  let sb = SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * ts;
  // the two coastal contour lines (old-chart hatching), at least ~1 pixel wide
  const ripple =
    0.55 *
    Math.max(
      clamp01((Math.max(9, 0.5 * upp) - Math.abs(d - 119)) / upp + 0.5),
      clamp01((Math.max(7, 0.5 * upp) - Math.abs(d - 257)) / upp + 0.5),
    );
  sr += (RIPPLE[0] - sr) * ripple;
  sg += (RIPPLE[1] - sg) * ripple;
  sb += (RIPPLE[2] - sb) * ripple;
  // land
  const tl = Math.min(1, (d < 0 ? -d : 0) / 500);
  const lr = LAND_COAST[0] + (LAND_INNER[0] - LAND_COAST[0]) * tl;
  const lg = LAND_COAST[1] + (LAND_INNER[1] - LAND_COAST[1]) * tl;
  const lb = LAND_COAST[2] + (LAND_INNER[2] - LAND_COAST[2]) * tl;
  // anti-aliased coast: land coverage over one output pixel
  const cov = clamp01(0.5 - d / upp);
  let r = sr + (lr - sr) * cov;
  let g = sg + (lg - sg) * cov;
  let b = sb + (lb - sb) * cov;
  // ink coastline band
  const band = 1.5 * upp + 6; // ~3 output px wide at any zoom
  const ink = Math.max(0, 1 - Math.abs(d) / band) * 0.85;
  r += (INK[0] - r) * ink;
  g += (INK[1] - g) * ink;
  b += (INK[2] - b) * ink;
  // polar pack ice
  const al = Math.abs(lat);
  const iceLat = iceLatFor(lat); // 72 north, 70 south (asymmetric since 2026-10-24)
  if (al > iceLat) {
    const t = Math.min(1, (al - iceLat) / 0.6);
    r = ICE_EDGE[0] + (ICE[0] - ICE_EDGE[0]) * t;
    g = ICE_EDGE[1] + (ICE[1] - ICE_EDGE[1]) * t;
    b = ICE_EDGE[2] + (ICE[2] - ICE_EDGE[2]) * t;
    if (d < 0) {
      r += (LAND_INNER[0] - r) * 0.15;
      g += (LAND_INNER[1] - g) * 0.15;
      b += (LAND_INNER[2] - b) * 0.15;
    }
  } else if (al > iceLat - 0.4) {
    const t = (al - (iceLat - 0.4)) / 0.4;
    r += (ICE_EDGE[0] - r) * t;
    g += (ICE_EDGE[1] - g) * t;
    b += (ICE_EDGE[2] - b) * t;
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = 255;
}

/** Colour lookup steps per metric unit of SDF value (the stored values are 4 units apart). */
const LUT_STEP = 4;

/**
 * RGBA pixels of a `size`×`size` north-up square centred on (ax, az) at `scale` output pixels per
 * metric unit. Rows are metric-correct like nav.minimapRow: x offsets divide by metricX of the
 * row's z. Pixels whose 2×2 SDF footprint touches an unloaded tile stay transparent.
 *
 * Hot loop (~0.4 M pixels per re-render at dpr 2): it samples the tiles inline with the same
 * bilinear maths as LandField.sdf (tiles fetched once per row, not per pixel) and looks colours
 * up in a per-call table indexed by the SDF value; only the rows next to the polar ice call
 * chartColor per pixel. Zoomed in past the data (under one SDF pixel per output pixel) it renders
 * from a lightly blurred copy instead (renderSmoothed), so the coast reads as curves rather than the
 * data's 49-unit stair-steps.
 */
export function renderMinimapLand(field: LandField, ax: number, az: number, scale: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const out32 = new Uint32Array(out.buffer); // little-endian RGBA
  const upp = 1 / scale;
  const half = size / 2;
  const src = field.source;

  const lutN = 2 * SDF_FAR * LUT_STEP + 1;
  const lut = new Uint32Array(lutN);
  const tmp = new Uint8ClampedArray(4);
  for (let k = 0; k < lutN; k++) {
    chartColor(k / LUT_STEP - SDF_FAR, 0, upp, tmp, 0);
    lut[k] = (tmp[0] | (tmp[1] << 8) | (tmp[2] << 16) | (255 << 24)) >>> 0;
  }

  if (upp < PX) {
    renderSmoothed(field, ax, az, upp, size, lut, out, out32);
    return out;
  }

  const rowA: (TileData | undefined)[] = new Array(TILES_X);
  const rowB: (TileData | undefined)[] = new Array(TILES_X);
  const val = (t: TileData, idx: number) => (typeof t === "string" ? (t === "water" ? SDF_FAR : -SDF_FAR) : t[idx] * SDF_UNIT);

  for (let v = 0; v < size; v++) {
    const z = az + (v + 0.5 - half) * upp;
    if (z < 0 || z > WORLD_H) continue;
    const lat = latOf(z);
    const nearIce = Math.abs(lat) > iceLatFor(lat) - 0.4;
    const xPerPx = upp / metricX(z);
    const fz = z / PX - 0.5;
    const j0f = Math.floor(fz);
    const tz = fz - j0f;
    const j0 = j0f < 0 ? 0 : j0f >= SDF_H ? SDF_H - 1 : j0f;
    const j1 = j0f + 1 < 0 ? 0 : j0f + 1 >= SDF_H ? SDF_H - 1 : j0f + 1;
    const r0 = (j0 & 255) << 8;
    const r1 = (j1 & 255) << 8;
    for (let t = 0; t < TILES_X; t++) {
      rowA[t] = src.get(t, j0 >> 8);
      rowB[t] = src.get(t, j1 >> 8);
    }
    const x0 = ax + (0.5 - half) * xPerPx;
    let o = v * size;
    for (let u = 0; u < size; u++, o++) {
      const fx = (x0 + u * xPerPx) / PX - 0.5;
      const i0f = Math.floor(fx);
      const tx = fx - i0f;
      const i0 = ((i0f % SDF_W) + SDF_W) % SDF_W;
      const i1 = i0 + 1 === SDF_W ? 0 : i0 + 1;
      const ta = rowA[i0 >> 8], tb = rowA[i1 >> 8], tc = rowB[i0 >> 8], td = rowB[i1 >> 8];
      if (ta === undefined || tb === undefined || tc === undefined || td === undefined) continue;
      const a = val(ta, r0 | (i0 & 255));
      const b = val(tb, r0 | (i1 & 255));
      const c = val(tc, r1 | (i0 & 255));
      const d = val(td, r1 | (i1 & 255));
      const top = a + (b - a) * tx;
      const s = top + (c + (d - c) * tx - top) * tz;
      if (nearIce) chartColor(s, lat, upp, out, o * 4);
      else out32[o] = lut[Math.round((s + SDF_FAR) * LUT_STEP)];
    }
  }
  return out;
}

/** SDF value of pixel (i, j) (i wrapped, j clamped), or NaN when its tile is not loaded. */
function sdfPixel(field: LandField, i: number, j: number): number {
  const ii = ((i % SDF_W) + SDF_W) % SDF_W;
  const jj = j < 0 ? 0 : j >= SDF_H ? SDF_H - 1 : j;
  const t = field.source.get(ii >> 8, jj >> 8);
  if (t === undefined) return NaN;
  if (typeof t === "string") return t === "water" ? SDF_FAR : -SDF_FAR;
  return t[((jj & 255) << 8) | (ii & 255)] * SDF_UNIT;
}

/** Separable [1 2 1]/4 blur along x (stride 1) or z (stride w), in place via a scratch row. */
function blur121(g: Float32Array, w: number, h: number, alongX: boolean): void {
  const n = alongX ? w : h;
  const lines = alongX ? h : w;
  const step = alongX ? 1 : w;
  const tmp = new Float32Array(n);
  for (let l = 0; l < lines; l++) {
    const base = alongX ? l * w : l;
    for (let k = 0; k < n; k++) tmp[k] = g[base + k * step];
    for (let k = 1; k < n - 1; k++) g[base + k * step] = (tmp[k - 1] + 2 * tmp[k] + tmp[k + 1]) / 4;
  }
}

/** renderMinimapLand when magnifying: copy the SDF under the view into a grid, blur it twice with
 *  [1 2 1] (≈ Gaussian, σ ≈ 1 SDF pixel, rounds the stair-step corners), sample it bilinearly.
 *  Cells on unloaded tiles are NaN, which the blur spreads a little; those pixels stay transparent. */
function renderSmoothed(
  field: LandField,
  ax: number,
  az: number,
  upp: number,
  size: number,
  lut: Uint32Array,
  out: Uint8ClampedArray,
  out32: Uint32Array,
): void {
  const half = size / 2;
  const zMin = az - half * upp;
  const zMax = az + half * upp;
  const hx = (half * upp) / Math.min(metricX(Math.max(0, zMin)), metricX(Math.min(WORLD_H, zMax)));
  const iA = Math.floor((ax - hx) / PX) - 3;
  const jA = Math.floor(zMin / PX) - 3;
  const w = Math.ceil((ax + hx) / PX) + 3 - iA + 1;
  const h = Math.ceil(zMax / PX) + 3 - jA + 1;
  const g = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[j * w + i] = sdfPixel(field, iA + i, jA + j);
  for (let k = 0; k < 2; k++) {
    blur121(g, w, h, true);
    blur121(g, w, h, false);
  }
  for (let v = 0; v < size; v++) {
    const z = az + (v + 0.5 - half) * upp;
    if (z < 0 || z > WORLD_H) continue;
    const lat = latOf(z);
    const nearIce = Math.abs(lat) > iceLatFor(lat) - 0.4;
    const xPerPx = upp / metricX(z);
    const fz = z / PX - 0.5 - jA;
    const j0 = Math.floor(fz);
    const tz = fz - j0;
    const r0 = j0 * w;
    const r1 = r0 + w;
    const x0 = ax + (0.5 - half) * xPerPx;
    let o = v * size;
    for (let u = 0; u < size; u++, o++) {
      const fx = (x0 + u * xPerPx) / PX - 0.5 - iA;
      const i0 = Math.floor(fx);
      const tx = fx - i0;
      const a = g[r0 + i0], b = g[r0 + i0 + 1], c = g[r1 + i0], d = g[r1 + i0 + 1];
      const top = a + (b - a) * tx;
      const s = top + (c + (d - c) * tx - top) * tz;
      if (s !== s) continue; // NaN: unloaded
      if (nearIce) chartColor(s, lat, upp, out, o * 4);
      else out32[o] = lut[Math.round((s + SDF_FAR) * LUT_STEP)];
    }
  }
}

/** Offscreen SDF land layer for the minimap (see the file comment). */
export class MinimapLandLayer {
  private canvas: HTMLCanvasElement | null = null;
  private key = "";
  private ax = 0;
  private az = 0;

  constructor(private readonly field: LandField) {}

  /**
   * Draws the land for a minimap of `size` CSS px and `radius` metric units centre-to-edge, centred
   * on (cx, cz), into `ctx` (whose transform is reset here and restored after). `version` should
   * change whenever tiles arrive.
   */
  draw(ctx: CanvasRenderingContext2D, cx: number, cz: number, radius: number, size: number, dpr: number, version: number): void {
    const S = Math.round(size * dpr); // minimap in device px
    const B = Math.ceil(S * 1.5); // buffer in device px
    const scale = S / 2 / radius; // device px per metric unit
    const key = `${radius}|${S}|${version}`;
    let dx = wrappedDelta(this.ax, cx, WORLD_C) * metricX((this.az + cz) / 2) * scale;
    let dz = (cz - this.az) * scale;
    const slack = (B - S) / 2 - 2;
    if (!this.canvas || key !== this.key || Math.abs(dx) > slack || Math.abs(dz) > slack) {
      this.canvas ??= document.createElement("canvas");
      this.canvas.width = B;
      this.canvas.height = B;
      const c = this.canvas.getContext("2d");
      if (!c) return;
      c.putImageData(new ImageData(renderMinimapLand(this.field, cx, cz, scale, B), B, B), 0, 0);
      this.key = key;
      this.ax = cx;
      this.az = cz;
      dx = 0;
      dz = 0;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas, Math.round((S - B) / 2 - dx), Math.round((S - B) / 2 - dz));
    ctx.restore();
  }
}
