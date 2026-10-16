// Stylised age-of-sail chart texture (equirectangular, lon -180..180 left->right, lat 90..-90
// top->bottom), rendered from the SDF. Parchment land with a dark ink coastline, pale sea with
// shallow tint and a couple of coastal "ripple" contour lines, white pack ice beyond ±ICE_LAT, and a
// faint 15° graticule. Ports, ships and labels are drawn by the client (W5), not baked in.
import { W, H, SDF_UNIT, ICE_LAT } from "./common";

type RGB = [number, number, number];
const SEA_DEEP: RGB = [118, 156, 165];
const SEA_SHALLOW: RGB = [168, 199, 194];
const RIPPLE: RGB = [96, 132, 140];
const INK: RGB = [74, 52, 32];
const LAND_COAST: RGB = [226, 206, 158];
const LAND_INNER: RGB = [204, 178, 124];
const ICE: RGB = [234, 240, 242];
const ICE_EDGE: RGB = [180, 196, 204];
const GRID_DARKEN = 0.86;

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Renders the map at width x (width/2). width must divide W. */
export function renderMap(sdf: Int8Array, width: number): Uint8Array {
  const height = width / 2;
  const f = W / width; // raster pixels per map pixel
  const out = new Uint8Array(width * height * 3);
  const gridStep = width / 24; // 15°
  for (let v = 0; v < height; v++) {
    const lat = 90 - ((v + 0.5) / height) * 180;
    for (let u = 0; u < width; u++) {
      // average SDF over the f x f block
      let s = 0;
      for (let dj = 0; dj < f; dj++) {
        const row = (v * f + dj) * W + u * f;
        for (let di = 0; di < f; di++) s += sdf[row + di];
      }
      const d = (s / (f * f)) * SDF_UNIT; // metric units, + water
      let c: RGB;
      if (d >= 0) {
        const t = Math.min(1, d / 350);
        c = mix(SEA_SHALLOW, SEA_DEEP, Math.sqrt(t));
        // two thin coastal contour lines (old-chart hatching)
        if ((d > 110 && d < 128) || (d > 250 && d < 264)) c = mix(c, RIPPLE, 0.55);
      } else {
        const t = Math.min(1, -d / 500);
        c = mix(LAND_COAST, LAND_INNER, t);
      }
      // ink coastline: a band straddling the zero crossing
      const band = 30 * f;
      if (Math.abs(d) < band) c = mix(c, INK, Math.max(0, 1 - Math.abs(d) / band) * 0.85);
      // graticule (sea only, so coasts stay crisp)
      if (d > 0) {
        const gu = (u + 0.5) % gridStep;
        const gv = (v + 0.5) % gridStep;
        if (gu < 1 || gv < 1) c = [c[0] * GRID_DARKEN, c[1] * GRID_DARKEN, c[2] * GRID_DARKEN];
      }
      // polar pack ice
      const al = Math.abs(lat);
      if (al > ICE_LAT) {
        const t = Math.min(1, (al - ICE_LAT) / 0.6);
        c = mix(ICE_EDGE, ICE, t);
        if (d < 0) c = mix(c, LAND_INNER, 0.15);
      } else if (al > ICE_LAT - 0.4) {
        c = mix(c, ICE_EDGE, (al - (ICE_LAT - 0.4)) / 0.4);
      }
      const o = (v * width + u) * 3;
      out[o] = Math.round(c[0]);
      out[o + 1] = Math.round(c[1]);
      out[o + 2] = Math.round(c[2]);
    }
  }
  return out;
}
