/**
 * Navigation UI maths (card W5): pure, DOM-free helpers for the minimap, the world map and the
 * compass HUD. Everything east-west goes through shared/world/geo.ts (metricX / wrappedDelta) so
 * shapes are right at every latitude and across the x seam. Tested in __tests__/nav.test.ts.
 */
import {
  WORLD_C,
  WORLD_H,
  metricX,
  metricDelta,
  metricDist,
  bearingDeg,
  wrappedDelta,
  wrapX,
  latOf,
  lonOf,
} from "@shared/world/geo";

/** 1 world unit ≈ 100 m. */
export const METERS_PER_UNIT = 100;
/** One nautical (sea) mile in world units (1852 m). */
export const UNITS_PER_SEA_MILE = 1852 / METERS_PER_UNIT;

export interface XZ {
  x: number;
  z: number;
}

/** Minimal port shape the nav UI needs (dock is optional until W4 lands real ports). */
export interface NavPort {
  id: number | string;
  name: string;
  x: number;
  z: number;
  dock?: XZ;
  nation?: string;
}

/** The point a ship sails to for a port: its dock, else its x/z. */
export function portPoint(p: { x: number; z: number; dock?: XZ }): XZ {
  return p.dock ? { x: p.dock.x, z: p.dock.z } : { x: p.x, z: p.z };
}

// ------------------------------------------------------------------ formatting

/** Format a latitude/longitude pair like `17°56′N 76°50′W`. */
export function formatLatLon(lat: number, lon: number): string {
  return `${formatDms(lat, "N", "S")} ${formatDms(lon, "E", "W")}`;
}

function formatDms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  let deg = Math.floor(a);
  let min = Math.round((a - deg) * 60);
  if (min === 60) {
    deg += 1;
    min = 0;
  }
  const hemi = deg === 0 && min === 0 ? "" : v < 0 ? neg : pos;
  return `${deg}°${String(min).padStart(2, "0")}′${hemi}`;
}

/** Latitude/longitude string for a world position. */
export function formatPosition(x: number, z: number): string {
  return formatLatLon(latOf(z), lonOf(x));
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** 8-point cardinal letters for a compass heading in degrees. */
export function cardinalOf(headingDeg: number): string {
  const h = ((headingDeg % 360) + 360) % 360;
  return CARDINALS[Math.round(h / 45) % 8];
}

/** Distance in sea miles from world units. */
export function unitsToSeaMiles(units: number): number {
  return units / UNITS_PER_SEA_MILE;
}

/** `3.4 nm` / `42 nm` / `1,250 nm`. */
export function formatSeaMiles(units: number): string {
  const nm = unitsToSeaMiles(units);
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  return `${Math.round(nm).toLocaleString("en-US")} nm`;
}

// ------------------------------------------------------------------ targeting

/** Bearing relative to the ship's bow, degrees in [-180, 180): negative = port (left). */
export function relativeBearing(bearing: number, heading: number): number {
  return wrappedDelta(heading, bearing, 360);
}

/** Nearest port by metric distance to its dock point (x/z fallback). null for an empty list. */
export function nearestPortTo<T extends NavPort>(px: number, pz: number, ports: T[]): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const p of ports) {
    const pt = portPoint(p);
    const d = metricDist(px, pz, pt.x, pt.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export interface TargetInfo {
  distance: number; // world units
  bearing: number; // compass degrees
  relative: number; // vs ship heading, [-180, 180)
}

/** Distance, bearing and relative bearing from a ship to a port's dock point. */
export function targetInfo(px: number, pz: number, headingDegrees: number, port: NavPort): TargetInfo {
  const pt = portPoint(port);
  const bearing = bearingDeg(px, pz, pt.x, pt.z);
  return {
    distance: metricDist(px, pz, pt.x, pt.z),
    bearing,
    relative: relativeBearing(bearing, headingDegrees),
  };
}

// ------------------------------------------------------------------ minimap

/**
 * Minimap projection, north-up, centred on (cx, cz). `radius` = metric units from centre to the
 * edge. Returns pixel coords inside a `size`×`size` square.
 */
export function minimapProject(
  cx: number,
  cz: number,
  x: number,
  z: number,
  radius: number,
  size: number,
): { x: number; y: number } {
  const d = metricDelta(cx, cz, x, z);
  const half = size / 2;
  return { x: half + (d.dx / radius) * half, y: half + (d.dz / radius) * half };
}

export interface RowSegment {
  /** source x range in image pixels */
  sx: number;
  sw: number;
  /** destination x range in minimap pixels */
  dx: number;
  dw: number;
}

/**
 * Land drawing for one minimap pixel row. Rows are metric-correct: at the row's latitude the
 * visible span is ±radius/metricX(z) x-units, so the equirectangular image is stretched
 * horizontally towards the poles. Returns 1 segment, or 2 when the span crosses the x seam.
 * `srcY` is the image pixel row to sample.
 */
export function minimapRow(
  cx: number,
  cz: number,
  row: number,
  radius: number,
  size: number,
  imgW: number,
  imgH: number,
): { srcY: number; segments: RowSegment[] } {
  const half = size / 2;
  const z = Math.min(WORLD_H, Math.max(0, cz + ((row + 0.5 - half) / half) * radius));
  const srcY = Math.min(imgH - 1, Math.max(0, Math.floor((z / WORLD_H) * imgH)));
  const spanX = Math.min(WORLD_C, (2 * radius) / Math.max(0.05, metricX(z))); // visible x units
  const left = wrapX(cx - spanX / 2);
  const toPx = imgW / WORLD_C;
  const sw = spanX * toPx;
  const sx = left * toPx;
  if (sx + sw <= imgW) return { srcY, segments: [{ sx, sw, dx: 0, dw: size }] };
  const w1 = imgW - sx; // part up to the seam
  const f = w1 / sw;
  return {
    srcY,
    segments: [
      { sx, sw: w1, dx: 0, dw: size * f },
      { sx: 0, sw: sw - w1, dx: size * f, dw: size * (1 - f) },
    ],
  };
}

export const MINIMAP_MIN_RADIUS = 1500;
export const MINIMAP_MAX_RADIUS = 24000;
export const MINIMAP_DEFAULT_RADIUS = 6000;
/**
 * HUD "knots" (F1/Q1 B5). Ship speed is in world units (100 m) per 1/60 s frame, so a literal
 * conversion would be absurd (a sloop at 4 = 24 km/s): game time is heavily compressed (a lap of the
 * equator takes ~20 minutes). The HUD instead shows a fixed, documented display scale of
 * KNOTS_PER_SPEED_UNIT knots per unit/frame, chosen so the fastest ship's top speed reads like a
 * fast age-of-sail ship: sloop 4 → 6 kn, brigantine 5 → 7.5, galleon 5.5 → 8.3, man-o-war 7 → 10.5,
 * dreadnought 9 → 13.5 kn. It is a label scale only; distances on the HUD (nm) stay metric.
 */
export const KNOTS_PER_SPEED_UNIT = 1.5;
export function speedToKnots(velocity: number): number {
  return Math.abs(velocity) * KNOTS_PER_SPEED_UNIT;
}

/** Minimap scale caption. `radius` is centre-to-edge (world units of 100 m), so the minimap spans
 *  2 × radius edge to edge (F1/Q1 B4: the old "Edge = 600 km" showed the radius as if it were the
 *  span). Default zoom 6000 → "1200 km across". */
export function minimapSpanLabel(radius: number): string {
  const km = (2 * radius * METERS_PER_UNIT) / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km across`;
}

/** Next zoom radius: dir +1 zooms in (smaller radius). Clamped. */
export function stepMinimapRadius(radius: number, dir: 1 | -1): number {
  const r = dir > 0 ? radius / 2 : radius * 2;
  return Math.min(MINIMAP_MAX_RADIUS, Math.max(MINIMAP_MIN_RADIUS, r));
}

// ------------------------------------------------------------------ world map

export interface MapView {
  /** x unit at the horizontal centre of the viewport (wraps) */
  cx: number;
  /** z unit at the vertical centre (clamped) */
  cz: number;
  /** screen pixels per world unit (same on both axes: the map is equirectangular) */
  k: number;
}

/** Smallest zoom: the whole height fits the viewport. */
export function minMapScale(viewH: number): number {
  return viewH / WORLD_H;
}
/** Largest zoom: 50 world units (5 km) per screen pixel. */
export const MAX_MAP_SCALE = 0.02;

/** Clamp a view: zoom within bounds, cx wrapped, cz kept so the map covers the viewport. */
export function clampView(v: MapView, viewH: number): MapView {
  const k = Math.min(MAX_MAP_SCALE, Math.max(minMapScale(viewH), v.k));
  const halfH = viewH / 2 / k;
  const cz =
    halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.min(WORLD_H - halfH, Math.max(halfH, v.cz));
  return { cx: wrapX(v.cx), cz, k };
}

/** World -> screen for the world map. x takes the shortest wrapped path from the view centre. */
export function mapWorldToScreen(
  v: MapView,
  viewW: number,
  viewH: number,
  x: number,
  z: number,
): { x: number; y: number } {
  return {
    x: viewW / 2 + wrappedDelta(v.cx, x, WORLD_C) * v.k,
    y: viewH / 2 + (z - v.cz) * v.k,
  };
}

/** Screen -> world (x wrapped into [0, C)). */
export function mapScreenToWorld(v: MapView, viewW: number, viewH: number, sx: number, sy: number): XZ {
  return { x: wrapX(v.cx + (sx - viewW / 2) / v.k), z: v.cz + (sy - viewH / 2) / v.k };
}

/** Zoom about a screen point so the world point under it stays put. */
export function zoomAt(
  v: MapView,
  viewW: number,
  viewH: number,
  sx: number,
  sy: number,
  factor: number,
): MapView {
  const before = mapScreenToWorld(v, viewW, viewH, sx, sy);
  const k = Math.min(MAX_MAP_SCALE, Math.max(minMapScale(viewH), v.k * factor));
  return clampView(
    { cx: before.x - (sx - viewW / 2) / k, cz: before.z - (sy - viewH / 2) / k, k },
    viewH,
  );
}

/** Screen x offsets at which to draw copies of the (C·k wide) map image so it wraps seamlessly. */
export function mapImageOffsets(v: MapView, viewW: number): number[] {
  const mapW = WORLD_C * v.k;
  const zeroX = viewW / 2 + wrappedDelta(v.cx, 0, WORLD_C) * v.k; // screen x of world x = 0
  const start = (zeroX % mapW) - mapW; // in (-2mapW, 0]; first copy may be fully offscreen
  const out: number[] = [];
  for (let o = start; o < viewW; o += mapW) if (o + mapW > 0) out.push(o);
  return out;
}

/** Longitude/latitude grid lines (degrees) every `step` degrees, excluding the poles. */
export function gridLines(step = 30): { lons: number[]; lats: number[] } {
  const lons: number[] = [];
  const lats: number[] = [];
  for (let l = -180; l < 180; l += step) lons.push(l);
  for (let l = -90 + step; l < 90; l += step) lats.push(l);
  return { lons, lats };
}

/** Nation colours (c. 1700). */
export const NATION_COLORS: Record<string, string> = {
  england: "#e0524d",
  spain: "#f2c230",
  france: "#5b8def",
  netherlands: "#f08a24",
  portugal: "#3fbf7f",
  pirates: "#b0b0b0",
  // New Horizons phase 2 (2026-10-24)
  russia: "#8fb3e8",
  sweden: "#2f6fc0",
  denmark_norway: "#c63a3a",
  hawaii: "#d9a05b",
};
export function nationColor(nation?: string): string {
  return (nation && NATION_COLORS[nation]) || "#e6c577";
}

/** Port within `radiusPx` of a screen point (nearest wins); null if none. */
export function pickPort<T extends NavPort>(
  v: MapView,
  viewW: number,
  viewH: number,
  sx: number,
  sy: number,
  ports: T[],
  radiusPx = 14,
): T | null {
  let best: T | null = null;
  let bd = radiusPx * radiusPx;
  for (const p of ports) {
    const pt = portPoint(p);
    const s = mapWorldToScreen(v, viewW, viewH, pt.x, pt.z);
    const d = (s.x - sx) ** 2 + (s.y - sy) ** 2;
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Label decluttering (New Horizons phase 1: 43 ports crowd the Caribbean and the River Plate when
// zoomed out). Dots are always drawn; a label is drawn only if its box does not overlap a label
// already placed, in priority order: the navigation target, then major ports, then the rest by id.
// ---------------------------------------------------------------------------------------------

/** Ports whose names win a crowded map (the great harbours of the age). */
export const MAJOR_PORT_KEYS: ReadonlySet<string> = new Set([
  "port_royal", "havana", "cartagena", "veracruz", "nassau", "tortuga", "boston", "new_york",
  "london", "amsterdam", "lisbon", "cadiz", "cape_town", "goa", "batavia", "macau", "manila",
  "acapulco", "callao", "panama", "portobelo", "rio_de_janeiro", "buenos_aires", "salvador",
]);

export interface LabelCandidate {
  /** Anything unique (the port id). */
  id: number | string;
  /** Anchor in screen px: the label's centre bottom. */
  x: number;
  y: number;
  text: string;
  /** Higher wins. */
  priority: number;
}

/** Label priority for a port: target 1000, major 10, else 0 (ties: lower id first, i.e. older ports). */
export function portLabelPriority(p: { key?: string; id: number | string }, isTarget: boolean): number {
  return (isTarget ? 1000 : 0) + (p.key && MAJOR_PORT_KEYS.has(p.key) ? 10 : 0);
}

/**
 * Greedy label placement: returns the ids whose labels fit without overlapping (boxes `measure(text)`
 * wide plus `pad`, `height` tall, centred on x and ending at y). Pure; `measure` is ctx.measureText
 * in the canvas, a stub in tests.
 */
export function placeLabels(
  cands: readonly LabelCandidate[],
  measure: (text: string) => number,
  height: number,
  pad = 4,
): Set<number | string> {
  const order = [...cands].sort((a, b) => b.priority - a.priority || (Number(a.id) || 0) - (Number(b.id) || 0));
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const shown = new Set<number | string>();
  for (const c of order) {
    const w = measure(c.text) + pad;
    const b = { x0: c.x - w / 2, y0: c.y - height, x1: c.x + w / 2, y1: c.y + 2 };
    if (boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
    boxes.push(b);
    shown.add(c.id);
  }
  return shown;
}
