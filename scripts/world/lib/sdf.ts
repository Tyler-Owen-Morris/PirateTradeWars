// Metric signed distance field from a binary land mask (spec §4.1).
//
// Method: exact separable Euclidean distance transform (Felzenszwalb & Huttenlocher) with an
// anisotropic metric. Pass 1 runs down each column (uniform spacing PX). Pass 2 runs along each row
// j with east-west spacing PX*cos(lat_j), where lat_j is the QUERY row's latitude. That makes the
// transform exact for "dx scaled at the query latitude"; the spec's metric uses the mean latitude,
// and over the clamped ±508-unit range (±0.9° of latitude) the difference is far below one SDF_UNIT.
// The row is padded with wrapped columns so the antimeridian is seamless.
//
// Distances are measured from pixel centres to the nearest opposite-class pixel centre, then
// converted to a distance to that pixel's edge by subtracting the rectangle's support in the
// direction of travel: h = (sx/2)|ux| + (PX/2)|uz|. Neighbouring land/water centres therefore get
// ±half a pixel, so the bilinear zero crossing sits on the pixel boundary.
import { W, H, PX, SDF_UNIT, SDF_MAX, rowLat } from "./common";

const LIMIT = SDF_MAX * SDF_UNIT + 2 * PX; // search a little beyond the clamp range
const LIMIT_ROWS = Math.ceil(LIMIT / PX);
const INF_ROWS = 0x7fff;

/**
 * For each pixel, the vertical distance (rows) to the nearest pixel in the same column whose
 * mask value equals `featureVal`, capped at INF_ROWS.
 */
function columnPass(mask: Uint8Array, featureVal: number): Int16Array {
  const g = new Int16Array(W * H);
  for (let i = 0; i < W; i++) {
    let last = -INF_ROWS;
    for (let j = 0; j < H; j++) {
      const idx = j * W + i;
      if (mask[idx] === featureVal) last = j;
      g[idx] = Math.min(INF_ROWS, j - last);
    }
    last = INF_ROWS * 2;
    for (let j = H - 1; j >= 0; j--) {
      const idx = j * W + i;
      if (mask[idx] === featureVal) last = j;
      const d = last - j;
      if (d < g[idx]) g[idx] = d;
    }
  }
  return g;
}

/**
 * Builds the quantized Int8 SDF (+ water, − land), row-major W*H.
 */
export function buildSdf(mask: Uint8Array): Int8Array {
  const toLand = columnPass(mask, 1); // for water pixels
  const toWater = columnPass(mask, 0); // for land pixels
  const out = new Int8Array(W * H);

  const maxPad = W / 2;
  const cap = maxPad * 2 + W;
  const pos = new Float64Array(cap); // site positions (metric x)
  const val = new Float64Array(cap); // site heights (squared vertical metric distance)
  const col = new Int32Array(cap); // site column index (unwrapped)
  const env = new Int32Array(cap); // envelope -> site index
  const zb = new Float64Array(cap + 1); // envelope boundaries

  for (let j = 0; j < H; j++) {
    const sx = Math.max(1e-6, PX * Math.cos((rowLat(j) * Math.PI) / 180));
    const pad = Math.min(maxPad, Math.ceil(LIMIT / sx) + 1);
    for (const pass of [0, 1]) {
      const g = pass === 0 ? toLand : toWater;
      const want = pass === 0 ? 0 : 1; // pixels of this class get a value from this pass
      const rowBase = j * W;
      // collect finite sites over the padded row
      let n = 0;
      for (let u = -pad; u < W + pad; u++) {
        const i = ((u % W) + W) % W;
        const gr = g[rowBase + i];
        if (gr > LIMIT_ROWS) continue;
        const dz = gr * PX;
        pos[n] = u * sx;
        val[n] = dz * dz;
        col[n] = u;
        n++;
      }
      if (n === 0) {
        for (let i = 0; i < W; i++) {
          if (mask[rowBase + i] === want) out[rowBase + i] = want === 0 ? SDF_MAX : -SDF_MAX;
        }
        continue;
      }
      // lower envelope of parabolas y = (x - pos)^2 + val
      let k = 0;
      env[0] = 0;
      zb[0] = -Infinity;
      zb[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let s: number;
        for (;;) {
          const p = env[k];
          s = (val[q] + pos[q] * pos[q] - (val[p] + pos[p] * pos[p])) / (2 * (pos[q] - pos[p]));
          if (s <= zb[k] && k > 0) k--;
          else break;
        }
        if (s <= zb[k]) {
          // k === 0 and the new parabola dominates entirely
          env[0] = q;
          zb[0] = -Infinity;
          zb[1] = Infinity;
          continue;
        }
        k++;
        env[k] = q;
        zb[k] = s;
        zb[k + 1] = Infinity;
      }
      // evaluate for the real columns
      let e = 0;
      for (let i = 0; i < W; i++) {
        const idx = rowBase + i;
        if (mask[idx] !== want) continue;
        const x = i * sx;
        while (zb[e + 1] < x) e++;
        const p = env[e];
        const dx = x - pos[p];
        const dz2 = val[p];
        const D = Math.sqrt(dx * dx + dz2);
        let d: number;
        if (D > LIMIT) d = LIMIT;
        else {
          const dz = Math.sqrt(dz2);
          const h = D > 0 ? ((sx / 2) * Math.abs(dx) + (PX / 2) * dz) / D : 0;
          d = D - h;
        }
        let q = Math.round(d / SDF_UNIT);
        if (q < 1) q = 1; // keep the sign unambiguous
        if (q > SDF_MAX) q = SDF_MAX;
        out[idx] = want === 0 ? q : -q;
      }
    }
  }
  return out;
}
