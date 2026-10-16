// Scanline polygon rasterizer for GeoJSON (Polygon / MultiPolygon) onto the 8192x4096
// equirectangular grid. A pixel is land when its CENTRE is inside the polygon (even-odd rule per
// polygon, so holes work). Natural Earth splits every feature at the antimeridian, so no ring
// crosses lon ±180 and no wrap handling is needed here.
import { W, H } from "./common";

type Ring = number[][]; // [[lon, lat], ...]
type Poly = Ring[];

function polysOf(geom: any): Poly[] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  if (geom.type === "GeometryCollection") return geom.geometries.flatMap(polysOf);
  return [];
}

/** Rasterize every polygon of a FeatureCollection into `mask` (sets 1 for land). */
export function rasterizeGeoJson(fc: any, mask: Uint8Array): number {
  let polys = 0;
  for (const f of fc.features) {
    for (const poly of polysOf(f.geometry)) {
      rasterizePolygon(poly, mask);
      polys++;
    }
  }
  return polys;
}

function rasterizePolygon(poly: Poly, mask: Uint8Array) {
  // Pixel space: fx = (lon+180)/360*W, fy = (90-lat)/180*H. Row j samples at fy = j + 0.5.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of poly) {
    for (const p of ring) {
      const fy = ((90 - p[1]) / 180) * H;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
    }
  }
  const j0 = Math.max(0, Math.ceil(minY - 0.5));
  const j1 = Math.min(H - 1, Math.floor(maxY - 0.5));
  if (j1 < j0) return;
  const rows: number[][] = new Array(j1 - j0 + 1);
  for (let k = 0; k < rows.length; k++) rows[k] = [];

  for (const ring of poly) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % n];
      const ax = ((a[0] + 180) / 360) * W;
      const ay = ((90 - a[1]) / 180) * H;
      const bx = ((b[0] + 180) / 360) * W;
      const by = ((90 - b[1]) / 180) * H;
      if (ay === by) continue;
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      // rows whose centre y satisfies lo <= y < hi (half-open avoids double-counting vertices)
      let js = Math.ceil(lo - 0.5);
      if (js + 0.5 < lo) js++;
      for (let j = Math.max(js, j0); j + 0.5 < hi && j <= j1; j++) {
        const y = j + 0.5;
        const t = (y - ay) / (by - ay);
        rows[j - j0].push(ax + t * (bx - ax));
      }
    }
  }

  for (let r = 0; r < rows.length; r++) {
    const xs = rows[r];
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const base = (j0 + r) * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // pixels whose centre i+0.5 lies in [xa, xb)
      const ia = Math.max(0, Math.ceil(xs[k] - 0.5));
      const ib = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let i = ia; i <= ib; i++) mask[base + i] = 1;
    }
  }
}
