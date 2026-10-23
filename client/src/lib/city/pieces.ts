/**
 * Pieces of the port-city kit: each is a small function writing low-poly geometry into the city's
 * layers (README.md). Coordinates are local metric units around the town anchor; y is the render
 * height (terrain from `ctx.site.height`). Convention for oriented pieces: `yaw` turns the piece so
 * its local +z (front / entrance / gun line) faces the given direction (layout passes the seaward one).
 *
 * Layers: `main` (always drawn: bodies, roofs, landmarks, forts, quays, trees, boats), `detail`
 * (near LOD only: windows, doors, shutters, chimneys, bollards, cannons, piles), `flags` (waving).
 *
 * To add a piece: write `function myPiece(ctx, x, z, yaw, scale)` and register it in EXTRA_PIECES
 * (or add a case to the house/roof/landmark/fort switch). Keep it to a few hundred triangles.
 */
import { MeshBuilder, hex, shade, mixRGB, type RGB, type V3 } from "./meshBuilder";
import type { CityStyle, FortKind, HouseKind, LandmarkKind, RoofKind, TreeKind } from "./styles";

export type Rng = () => number;

/** Terrain around the town, in local metric coordinates (layout.ts builds it). */
export interface CitySite {
  /** Signed distance to the coast (metric): + water, − land. */
  sdf(x: number, z: number): number;
  /** Terrain render height (y) at the point. */
  height(x: number, z: number): number;
}

export interface CityCtx {
  main: MeshBuilder;
  detail: MeshBuilder;
  flags: MeshBuilder;
  style: CityStyle;
  rng: Rng;
  nation: string;
  lat: number;
  site: CitySite;
}

export const WATER_Y = -10;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rngFor(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
export function pickWeighted<K extends string>(rng: Rng, w: Partial<Record<K, number>>): K {
  const entries = Object.entries(w) as [K, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = rng() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[0][0];
}
/** Colour with a little per-instance variation. */
export const vary = (rng: Rng, c: string, amt = 0.07): RGB => shade(hex(c), 1 - amt + rng() * 2 * amt);

/** Min/max terrain height under a rotated w × d rectangle. */
export function groundSpan(site: CitySite, x: number, z: number, w: number, d: number, yaw: number): { min: number; max: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let min = Infinity, max = -Infinity;
  for (const [u, v] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
    const h = site.height(x + u * c + v * s, z - u * s + v * c);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

const IRON: RGB = hex("#2a2a2c");
const WOOD_DARK: RGB = hex("#4a3624");
const WOOD: RGB = hex("#7a5a3a");
const PLANK: RGB = hex("#8a6a48");
const CANVAS: RGB = hex("#eae2cc");
const STONE_TOP: RGB = hex("#b8ae9c");

// ---------------------------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------------------------

export interface HouseOpts {
  w: number;
  d: number;
  floors: number;
  kind?: HouseKind;
  roof?: RoofKind;
  wall?: RGB;
  roofColor?: RGB;
}

/** Windows (+ door, shutters) on a box face. `face` 0 = +z front. */
function windows(ctx: CityCtx, w: number, d: number, face: 0 | 1 | 2 | 3, floorY: number, floors: number, floorH: number, door: boolean, trim: RGB | null, tall = false) {
  const st = ctx.style;
  const span = face < 2 ? w : d;
  const spacing = tall ? 2.8 : 3.6;
  const cols = Math.max(1, Math.floor((span - 1.5) / spacing));
  const win = hex(st.window);
  const ww = tall ? 1.3 : 1.4;
  const wh = tall ? 2.4 : 1.9;
  const cw = face < 2 ? w : d;
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < cols; k++) {
      const u = (k + 0.5) * (span / cols) - span / 2;
      const y0 = floorY + f * floorH + floorH * 0.32;
      if (door && f === 0 && k === Math.floor(cols / 2)) {
        ctx.detail.decal(0, 0, w, d, face, u - 0.9, u + 0.9, floorY, floorY + Math.min(3.2, floorH * 0.7), shade(hex("#4a3020"), 0.9));
        continue;
      }
      ctx.detail.decal(0, 0, w, d, face, u - ww / 2, u + ww / 2, y0, y0 + wh, win);
      if (trim) {
        ctx.detail.decal(0, 0, w, d, face, u - ww / 2 - 0.75, u - ww / 2 - 0.1, y0, y0 + wh, trim);
        ctx.detail.decal(0, 0, w, d, face, u + ww / 2 + 0.1, u + ww / 2 + 0.75, y0, y0 + wh, trim);
      }
    }
  }
  void cw;
}

/** Roof of kind `k` on a w × d body whose walls end at `top`. Returns the roof's peak height. */
export function roof(ctx: CityCtx, k: RoofKind, w: number, d: number, top: number, color: RGB, wall: RGB): number {
  const st = ctx.style;
  const m = ctx.main;
  switch (k) {
    case "flat": {
      m.box(0, top, 0, w + 0.4, 1.1, d + 0.4, shade(wall, 0.95), { top: hex("#cbbd9f") });
      return top + 1.1;
    }
    case "hip": {
      const rise = st.pitch * Math.min(w, d) * 0.5;
      m.hip(0, top, 0, w, d, rise, st.eaves, color);
      return top + rise;
    }
    case "tiered": {
      const rise = st.pitch * Math.min(w, d) * 0.35;
      m.hip(0, top, 0, w, d, rise, st.eaves * 1.4, color);
      const w2 = w * 0.6, d2 = d * 0.6;
      m.box(0, top + rise * 0.6, 0, w2, 2.6, d2, wall, { top: false });
      m.hip(0, top + rise * 0.6 + 2.6, 0, w2, d2, rise * 0.8, st.eaves, color);
      return top + rise * 1.4 + 2.6;
    }
    case "shed": {
      const rise = st.pitch * d * 0.5;
      m.shed(0, top, 0, w, d, rise, st.eaves, color, wall);
      return top + rise;
    }
    case "stepgable":
    case "bellgable": {
      // ridge front-to-back (gable faces the street at +z), then a raised facade on the front
      const rise = st.pitch * w * 0.5;
      m.push(0, 0, 0, Math.PI / 2);
      m.gable(0, top, 0, d, w, rise, st.eaves, color, wall, 0);
      m.pop();
      const fz = d / 2 - 0.4;
      if (k === "stepgable") {
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          const sw = w * (1 - i / steps) - 0.2;
          m.box(0, top + (i * rise) / steps, fz, sw, rise / steps + 0.4, 0.9, wall);
        }
        m.box(0, top + rise + 0.4, fz, 1.2, 1.6, 0.9, wall);
      } else {
        // bell / neck gable: narrow neck to the peak + sloped shoulders + a little pediment
        m.box(0, top, fz, w * 0.42, rise + 0.8, 0.9, wall);
        m.poly([[-w / 2, top, fz + 0.45], [-w * 0.21, top, fz + 0.45], [-w * 0.21, top + rise * 0.55, fz + 0.45]], wall, [0, top, fz - 2]);
        m.poly([[w / 2, top, fz + 0.45], [w * 0.21, top, fz + 0.45], [w * 0.21, top + rise * 0.55, fz + 0.45]], wall, [0, top, fz - 2]);
        m.poly([[-w * 0.26, top + rise + 0.8, fz + 0.5], [w * 0.26, top + rise + 0.8, fz + 0.5], [0, top + rise + 2.2, fz + 0.5]], shade(wall, 1.15), [0, top, fz - 2]);
      }
      return top + rise + 2;
    }
    case "gable":
    default: {
      const rise = st.pitch * d * 0.5;
      m.gable(0, top, 0, w, d, rise, st.eaves, color, wall);
      return top + rise;
    }
  }
}

/** A house (or shack / canal house) at (x, z) with its front (+z) facing `yaw`. Returns its peak y. */
export function house(ctx: CityCtx, x: number, z: number, yaw: number, o: HouseOpts): number {
  const st = ctx.style;
  const kind = o.kind ?? st.house;
  const g = groundSpan(ctx.site, x, z, o.w, o.d, yaw);
  const wall = o.wall ?? vary(ctx.rng, pick(ctx.rng, st.walls));
  const roofColor = o.roofColor ?? vary(ctx.rng, pick(ctx.rng, st.roofs), 0.1);
  const roofKind = o.roof ?? pickWeighted(ctx.rng, st.roofKinds);
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  ctx.detail.push(x, 0, z, yaw);
  let floorY = g.max + 0.4;
  if (kind === "shack") {
    // timber shack, on stilts near the water
    const stilts = g.min < WATER_Y + 2.5;
    floorY = Math.max(g.max, WATER_Y + 1.5) + (stilts ? 1.6 : 0.3);
    if (stilts) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ctx.detail.box((sx * o.w) / 2 - sx * 0.4, WATER_Y - 3, (sz * o.d) / 2 - sz * 0.4, 0.6, floorY - WATER_Y + 3, 0.6, WOOD_DARK);
      m.box(0, floorY - 0.6, 0, o.w + 1, 0.6, o.d + 1.4, PLANK);
    } else {
      m.box(0, g.min - 2, 0, o.w + 0.2, floorY - g.min + 2, o.d + 0.2, hex(st.plinth), { top: false });
    }
  } else {
    m.box(0, g.min - 3, 0, o.w + 0.5, floorY - g.min + 3, o.d + 0.5, vary(ctx.rng, st.plinth, 0.05), { top: false });
  }
  const floors = o.floors;
  const fh = st.floorH * (kind === "shack" ? 0.85 : 1);
  const top = floorY + floors * fh;
  m.box(0, floorY, 0, o.w, floors * fh, o.d, wall, { top: roofKind === "flat" ? wall : false, sideShade: 0.97 });
  const peak = roof(ctx, roofKind, o.w, o.d, top, roofColor, wall);
  // details
  const trim = st.shutters ? hex(pick(ctx.rng, st.trim)) : null;
  const tall = kind === "canal" || st.id === "spanish_colonial";
  windows(ctx, o.w, o.d, 0, floorY, floors, fh, true, trim, tall);
  if (kind !== "shack") windows(ctx, o.w, o.d, 1, floorY, floors, fh, false, null, tall);
  if (o.d > 9.5 && kind !== "canal") {
    windows(ctx, o.w, o.d, 2, floorY, floors, fh, false, null);
    windows(ctx, o.w, o.d, 3, floorY, floors, fh, false, null);
  }
  if (kind === "canal") {
    // hoist beam under the gable peak
    ctx.detail.box(0, top + (st.pitch * o.w) / 2 - 0.6, o.d / 2 + 0.4, 0.5, 0.5, 1.8, WOOD_DARK);
  }
  if (ctx.rng() < st.chimneys && roofKind !== "flat") {
    const cx = (ctx.rng() < 0.5 ? -1 : 1) * o.w * 0.3;
    ctx.detail.box(cx, top, kind === "canal" ? -o.d * 0.25 : 0, 1.3, peak - top + 1.6, 1.3, shade(hex("#7a4a3a"), 0.95));
  }
  m.pop();
  ctx.detail.pop();
  return peak;
}

/** Waterfront warehouse: big gabled store, loading doors and a hoist toward the sea (+z). */
export function warehouse(ctx: CityCtx, x: number, z: number, yaw: number, w: number, d: number): number {
  const st = ctx.style;
  const g = groundSpan(ctx.site, x, z, w, d, yaw);
  const wall = vary(ctx.rng, pick(ctx.rng, st.warehouseWalls));
  const roofC = vary(ctx.rng, pick(ctx.rng, st.warehouseRoofs), 0.08);
  const floorY = Math.max(g.max, WATER_Y + 3.6) + 0.3;
  const h = 10.5;
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  ctx.detail.push(x, 0, z, yaw);
  m.box(0, g.min - 3, 0, w + 0.6, floorY - g.min + 3, d + 0.6, hex(st.plinth), { top: false });
  m.box(0, floorY, 0, w, h, d, wall, { top: false, sideShade: 0.95 });
  const pitch = st.house === "shack" ? 0.6 : Math.min(st.pitch, 0.8);
  m.gable(0, floorY + h, 0, w, d, pitch * d * 0.5, st.eaves + 0.3, roofC, wall);
  const dark = hex("#3a2a1e");
  const bays = Math.max(2, Math.round(w / 9));
  for (let i = 0; i < bays; i++) {
    const u = (i + 0.5) * (w / bays) - w / 2;
    ctx.detail.decal(0, 0, w, d, 0, u - 1.6, u + 1.6, floorY, floorY + 4.2, dark);
    ctx.detail.decal(0, 0, w, d, 0, u - 1.1, u + 1.1, floorY + 6, floorY + 8.6, dark);
    ctx.detail.decal(0, 0, w, d, 1, u - 0.7, u + 0.7, floorY + 6.5, floorY + 8.3, hex(st.window));
  }
  ctx.detail.box(0, floorY + h - 0.8, d / 2 + 1, 0.6, 0.6, 2.2, WOOD_DARK);
  // a few crates / barrels in front
  for (let i = 0; i < 3; i++) {
    const cx = range(ctx.rng, -w / 2 + 2, w / 2 - 2);
    ctx.detail.box(cx, floorY, d / 2 + 2.5 + ctx.rng() * 2, 1.6, 1.6, 1.6, vary(ctx.rng, "#8a6a40"));
  }
  m.pop();
  ctx.detail.pop();
  return floorY + h + pitch * d * 0.5;
}

// ---------------------------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------------------------

/** Open belfry: four corner piers and a cap. */
function belfry(m: MeshBuilder, cx: number, y: number, cz: number, s: number, h: number, wall: RGB) {
  const p = s * 0.22;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.box(cx + (a * (s - p)) / 2, y, cz + (b * (s - p)) / 2, p, h, p, wall);
  m.box(cx, y + h, cz, s + 0.6, 1, s + 0.6, shade(wall, 0.92));
}

/** The town's main landmark, entrance (+z) facing `yaw`. Returns its top y. */
export function landmark(ctx: CityCtx, kind: LandmarkKind, x: number, z: number, yaw: number, scale = 1, wallHex?: string, roofHex?: string): number {
  const st = ctx.style;
  const wall = hex(wallHex ?? st.landmarkWall);
  const roofC = hex(roofHex ?? st.landmarkRoof);
  const m = ctx.main;
  const S = scale;
  const footW = (kind === "dome" ? 30 : 16) * S;
  const footD = (kind === "dome" ? 34 : 30) * S;
  const g = groundSpan(ctx.site, x, z, footW, footD, yaw);
  const y0 = g.max + 0.4;
  m.push(x, 0, z, yaw);
  ctx.detail.push(x, 0, z, yaw);
  m.box(0, g.min - 3, 0, footW + 1, y0 - g.min + 3, footD + 1, shade(wall, 0.8), { top: STONE_TOP });
  let top = y0;
  const nave = (w: number, d: number, h: number, zc = 0) => {
    m.box(0, y0, zc, w, h, d, wall, { top: false, sideShade: 0.95 });
    m.push(0, 0, zc, Math.PI / 2);
    m.gable(0, y0 + h, 0, d, w, w * 0.45, 0.5, roofC, wall, 0.3);
    m.pop();
    // tall windows along the nave
    for (let i = 0; i < 4; i++) {
      const u = -d / 2 + ((i + 0.5) * d) / 4;
      ctx.detail.decal(0, zc, w, d, 2, u - 0.8, u + 0.8, y0 + h * 0.35, y0 + h * 0.8, hex("#3a3440"));
      ctx.detail.decal(0, zc, w, d, 3, u - 0.8, u + 0.8, y0 + h * 0.35, y0 + h * 0.8, hex("#3a3440"));
    }
    ctx.detail.decal(0, zc, w, d, 0, -1.6, 1.6, y0, y0 + 5, hex("#4a3020"));
  };
  switch (kind) {
    case "bell_tower": {
      nave(12 * S, 26 * S, 11 * S);
      const s = 7.5 * S, th = 22 * S;
      const tx = -6 * S, tz = 11 * S;
      m.box(tx, y0, tz, s, th, s, wall, { top: false });
      belfry(m, tx, y0 + th, tz, s, 5 * S, wall);
      m.hip(tx, y0 + th + 6 * S, tz, s, s, 4 * S, 0.4, roofC);
      m.box(tx, y0 + th + 10 * S, tz, 0.4, 2.4 * S, 0.4, IRON);
      // baroque front gable
      m.box(0, y0 + 11 * S, 12.6 * S, 8 * S, 4 * S, 1, wall);
      m.box(0, y0 + 15 * S, 12.6 * S, 4 * S, 2.5 * S, 1, wall);
      top = y0 + th + 12 * S;
      break;
    }
    case "twin_towers": {
      nave(13 * S, 26 * S, 12 * S);
      const s = 6 * S, th = 20 * S;
      for (const sx of [-1, 1]) {
        m.box(sx * 5.5 * S, y0, 12 * S, s, th, s, wall, { top: false });
        belfry(m, sx * 5.5 * S, y0 + th, 12 * S, s, 4 * S, wall);
        m.hip(sx * 5.5 * S, y0 + th + 5 * S, 12 * S, s, s, 3.5 * S, 0.3, roofC);
      }
      m.box(0, y0 + 12 * S, 12.5 * S, 6 * S, 5 * S, 1, wall);
      top = y0 + th + 9 * S;
      break;
    }
    case "steeple": {
      nave(12 * S, 24 * S, 10 * S);
      const s = 7 * S, th = 18 * S;
      m.box(0, y0, 13 * S, s, th, s, wall, { top: false });
      m.box(0, y0 + th, 13 * S, s + 0.6, 0.8, s + 0.6, shade(wall, 0.9));
      m.prism(0, y0 + th + 0.8, 13 * S, s * 0.42, s * 0.36, 4 * S, 8, shade(wall, 1.05));
      m.prism(0, y0 + th + 0.8 + 4 * S, 13 * S, s * 0.4, 0, 16 * S, 8, roofC);
      for (let i = 0; i < 3; i++) ctx.detail.decal(0, 13 * S, s, s, 0, -0.7, 0.7, y0 + th * (0.35 + i * 0.22), y0 + th * (0.35 + i * 0.22) + 2.2, hex("#2a2a30"));
      top = y0 + th + 21 * S;
      break;
    }
    case "gothic_tower": {
      nave(13 * S, 26 * S, 13 * S);
      const s = 9 * S, th = 26 * S;
      m.box(0, y0, 13 * S, s, th, s, wall, { top: hex("#5a5a5a") });
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        m.prism((a * (s - 1.4)) / 2, y0 + th, 13 * S + (b * (s - 1.4)) / 2, 0.9 * S, 0, 5 * S, 4, shade(wall, 1.1), { phase: Math.PI / 4 });
      }
      m.prism(0, y0 + th, 13 * S, s * 0.3, 0, 9 * S, 8, roofC);
      for (let i = 0; i < 3; i++) ctx.detail.decal(0, 13 * S, s, s, 0, -1, 1, y0 + th * (0.4 + i * 0.2), y0 + th * (0.4 + i * 0.2) + 3, hex("#2a2a30"));
      top = y0 + th + 9 * S;
      break;
    }
    case "dome": {
      // cross plan, drum + dome + lantern, two west towers
      m.box(0, y0, 0, 14 * S, 14 * S, 34 * S, wall, { top: false });
      m.push(0, 0, 0, Math.PI / 2);
      m.gable(0, y0 + 14 * S, 0, 34 * S, 14 * S, 5 * S, 0.4, roofC, wall, 0);
      m.pop();
      m.box(0, y0, 0, 30 * S, 13 * S, 12 * S, wall, { top: false });
      m.gable(0, y0 + 13 * S, 0, 30 * S, 12 * S, 4.5 * S, 0.4, roofC, wall, 0);
      m.prism(0, y0 + 14 * S, 0, 9 * S, 9 * S, 7 * S, 12, wall);
      m.dome(0, y0 + 21 * S, 0, 8.5 * S, 12, 3, hex("#8a9a9a"), 1.25);
      m.prism(0, y0 + 21 * S + 10.6 * S, 0, 1.6 * S, 1.4 * S, 3.5 * S, 6, wall);
      m.prism(0, y0 + 21 * S + 14.1 * S, 0, 1.6 * S, 0, 2.6 * S, 6, hex("#c9a640"));
      for (const sx of [-1, 1]) {
        m.box(sx * 6 * S, y0, 17 * S, 5 * S, 20 * S, 5 * S, wall, { top: false });
        m.prism(sx * 6 * S, y0 + 20 * S, 17 * S, 2.2 * S, 0, 5 * S, 8, roofC);
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.detail.box(Math.cos(a) * 9.1 * S, y0 + 16 * S, Math.sin(a) * 9.1 * S, 0.9, 3 * S, 0.9, hex("#3a3a40"));
      }
      top = y0 + 38 * S;
      break;
    }
    case "pagoda": {
      let y = y0;
      let s = 12 * S;
      for (let i = 0; i < 5; i++) {
        m.box(0, y, 0, s, 4.4 * S, s, wall, { top: false });
        m.hip(0, y + 4.4 * S, 0, s, s, s * 0.22, 2.2 * S, roofC);
        y += 4.4 * S + s * 0.16;
        s *= 0.82;
      }
      m.prism(0, y + 1, 0, 0.5, 0.3, 6 * S, 6, hex("#c9a640"));
      top = y + 6 * S;
      break;
    }
    case "chapel": {
      m.box(0, y0, 0, 8 * S, 6 * S, 14 * S, wall, { top: false });
      m.push(0, 0, 0, Math.PI / 2);
      m.gable(0, y0 + 6 * S, 0, 14 * S, 8 * S, 4 * S, 0.6, roofC, wall, 0.4);
      m.pop();
      m.box(0, y0 + 10 * S, 6.5 * S, 0.5, 3.5 * S, 0.5, WOOD_DARK);
      m.box(0, y0 + 12 * S, 6.5 * S, 2, 0.5, 0.5, WOOD_DARK);
      ctx.detail.decal(0, 0, 8 * S, 14 * S, 0, -1, 1, y0, y0 + 3.4, hex("#2a1e14"));
      top = y0 + 14 * S;
      break;
    }
    case "windmill": {
      ctx.detail.pop();
      m.pop();
      return windmill(ctx, x, z, yaw, scale);
    }
    case "none":
    default:
      break;
  }
  ctx.detail.pop();
  m.pop();
  return top;
}

/** Tower windmill with four lattice sails facing +z. */
export function windmill(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1): number {
  const S = scale;
  const g = groundSpan(ctx.site, x, z, 10 * S, 10 * S, yaw);
  const y0 = g.min - 1;
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  const body = hex(ctx.style.id === "dutch" ? "#5a4a3c" : "#e8e0cc");
  m.prism(0, y0, 0, 5 * S, 3.5 * S, g.max - y0 + 15 * S, 8, body);
  const hy = g.max + 15 * S;
  m.prism(0, hy, 0, 3.9 * S, 0, 4.5 * S, 8, hex("#3e3a38"));
  m.box(0, hy - 0.5, 3.4 * S, 1.2, 1.2, 1.6, WOOD_DARK);
  const hz = 4.3 * S;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca; // perpendicular in the sail plane
    const r0 = 1.2 * S, r1 = 12 * S, hw = 1.3 * S;
    m.poly2(
      [
        [ca * r0 + px * 0.2, hy + sa * r0 + py * 0.2, hz],
        [ca * r1 + px * 0.2, hy + sa * r1 + py * 0.2, hz],
        [ca * r1 + px * hw * 2, hy + sa * r1 + py * hw * 2, hz],
        [ca * r0 + px * hw * 2, hy + sa * r0 + py * hw * 2, hz],
      ],
      CANVAS,
    );
    m.poly2([[ca * r0 - px * 0.25, hy + sa * r0 - py * 0.25, hz + 0.05], [ca * r1 - px * 0.25, hy + sa * r1 - py * 0.25, hz + 0.05], [ca * r1 + px * 0.25, hy + sa * r1 + py * 0.25, hz + 0.05], [ca * r0 + px * 0.25, hy + sa * r0 + py * 0.25, hz + 0.05]], WOOD_DARK);
  }
  m.pop();
  return hy + 12 * S;
}

// ---------------------------------------------------------------------------------------------
// Forts
// ---------------------------------------------------------------------------------------------

/** Cannon on a carriage, muzzle toward local +z, at (x, y, z) in the CURRENT frame of `b`. */
export function cannon(b: MeshBuilder, x: number, y: number, z: number, yaw = 0) {
  b.push(x, y, z, yaw);
  b.box(0, 0, 0, 2.2, 1, 2.6, WOOD_DARK);
  b.box(0, 0.9, 0.9, 0.9, 0.9, 4.2, IRON);
  b.pop();
}

/** Arrowhead-bastion outline: `n` bastions round a polygon of radius a, first bastion pointing at +z. */
function bastionOutline(n: number, a: number, rot = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = rot + (k / n) * Math.PI * 2;
    for (const [dt, r] of [[-0.34, 0.92], [-0.24, 1.12], [0, 1.5], [0.24, 1.12], [0.34, 0.92]] as const) {
      const ang = t + dt;
      pts.push([Math.sin(ang) * a * r, Math.cos(ang) * a * r]);
    }
  }
  return pts;
}

/** Flagpole (main) + flag (flags layer) at local (x, z) of the current frames, pole foot at y. */
export function flagpole(ctx: CityCtx, x: number, y: number, z: number, h = 14, size = 1, nation = ctx.nation) {
  ctx.main.box(x, y, z, 0.5, h, 0.5, WOOD_DARK);
  flag(ctx.flags, x + 0.25, y + h - 0.3, z, 7 * size, 4.6 * size, nation);
}

/** Fort of kind `kind` with its gun line (+z) facing `yaw`. Returns the top y. */
export function fort(ctx: CityCtx, kind: FortKind, x: number, z: number, yaw: number, scale = 1, stoneHex?: string): number {
  if (kind === "none") return 0;
  const S = scale;
  const stone = hex(stoneHex ?? ctx.style.fortStone);
  const top = shade(stone, 1.12);
  const m = ctx.main;
  const R = (kind === "castle" ? 22 : kind === "palisade" ? 18 : kind === "bastion" ? 20 : 26) * S;
  const g = groundSpan(ctx.site, x, z, R * 2, R * 2, yaw);
  const base = Math.min(g.min, WATER_Y) - 3;
  const wallTop = Math.max(g.max, WATER_Y + 4) + (kind === "palisade" ? 2 : 7 * S);
  m.push(x, 0, z, yaw);
  ctx.detail.push(x, 0, z, yaw);
  ctx.flags.push(x, 0, z, yaw);
  let peak = wallTop;
  switch (kind) {
    case "star":
    case "bastion": {
      const ol = kind === "star" ? bastionOutline(4, R, Math.PI / 4) : bastionTwo(R);
      m.extrude(ol, base, wallTop - base, stone, top, 2.2 * S);
      m.extrude(ol.map(([a, b]) => [a * 0.82, b * 0.82] as [number, number]), wallTop, 1.2, shade(stone, 0.95), hex("#8a9a6a"), 0);
      // barracks + powder house
      m.box(-R * 0.2, wallTop + 1.2, -R * 0.25, R * 0.7, 5, R * 0.35, shade(stone, 1.05), { top: false });
      m.hip(-R * 0.2, wallTop + 6.2, -R * 0.25, R * 0.7, R * 0.35, 2.6, 0.5, hex("#8a4a30"));
      // guns along the seaward faces
      const guns = kind === "star" ? 7 : 5;
      for (let i = 0; i < guns; i++) {
        const u = -R * 0.75 + (i * 1.5 * R) / Math.max(1, guns - 1);
        cannon(ctx.detail, u, wallTop + 1.2, R * 0.62 + (Math.abs(u) < R * 0.4 ? 0 : -R * 0.15));
      }
      flagpole(ctx, R * 0.25, wallTop + 1.2, -R * 0.3, 16 * S, S);
      peak = wallTop + 18 * S;
      break;
    }
    case "castle": {
      const W = R * 1.8, D = R * 1.4;
      m.box(0, base, 0, W, wallTop - base + 4 * S, D, stone, { top: top });
      // crenels
      for (let i = -3; i <= 3; i++) ctx.detail.box((i * W) / 7, wallTop + 4 * S, D / 2 - 0.5, 2, 1.4, 1, stone);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        m.box((a * W) / 2, base, (b * D) / 2, 7 * S, wallTop - base + 8 * S, 7 * S, shade(stone, 0.96), { top: top });
        m.hip((a * W) / 2, wallTop + 8 * S, (b * D) / 2, 7 * S, 7 * S, 3 * S, 0.3, hex("#a85a3a"));
      }
      // keep
      m.box(-W * 0.12, wallTop + 4 * S, -D * 0.1, W * 0.45, 10 * S, D * 0.45, shade(stone, 1.03), { top: false });
      m.hip(-W * 0.12, wallTop + 14 * S, -D * 0.1, W * 0.45, D * 0.45, 4 * S, 0.6, hex("#a85a3a"));
      for (let i = 0; i < 4; i++) ctx.detail.decal(-W * 0.12, -D * 0.1, W * 0.45, D * 0.45, 0, -W * 0.18 + i * W * 0.12, -W * 0.18 + i * W * 0.12 + 1.4, wallTop + 8 * S, wallTop + 10.4 * S, hex("#2a2a30"));
      for (let i = 0; i < 4; i++) cannon(ctx.detail, -W * 0.3 + (i * W * 0.6) / 3, wallTop + 4 * S, D / 2 - 3);
      flagpole(ctx, -W * 0.12, wallTop + 18 * S, -D * 0.1, 10 * S, S);
      peak = wallTop + 28 * S;
      break;
    }
    case "morro": {
      // stepped triangular headland fortress + lighthouse at the point (+z)
      const tri = (k: number): [number, number][] => [[-R * 1.3 * k, -R * 0.8 * k], [R * 1.3 * k, -R * 0.8 * k], [R * 0.45 * k, R * 1.1 * k], [0, R * 1.35 * k], [-R * 0.45 * k, R * 1.1 * k]];
      m.extrude(tri(1), base, wallTop - base, stone, top, 2 * S);
      m.extrude(tri(0.72), wallTop, 5 * S, shade(stone, 0.95), top, 0.8);
      m.extrude(tri(0.42), wallTop + 5 * S, 4 * S, shade(stone, 0.9), top, 0.5);
      for (let i = 0; i < 6; i++) {
        const u = -R * 0.9 + (i * 1.8 * R) / 5;
        cannon(ctx.detail, u * 0.8, wallTop, R * 0.55 - Math.abs(u) * 0.55);
      }
      const ly = wallTop + 9 * S;
      m.prism(0, ly, R * 0.5, 3.2 * S, 2.5 * S, 16 * S, 8, hex("#efe8d8"));
      m.prism(0, ly + 16 * S, R * 0.5, 2.6 * S, 2.6 * S, 2.6 * S, 8, hex("#f6e7a0"));
      m.prism(0, ly + 18.6 * S, R * 0.5, 3 * S, 0, 2.6 * S, 8, hex("#6a3a2a"));
      flagpole(ctx, -R * 0.4, wallTop + 9 * S, -R * 0.2, 12 * S, S);
      peak = ly + 21 * S;
      break;
    }
    case "palisade": {
      // earth platform, a ring of stakes, a blockhouse and a few guns
      const plat: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        plat.push([Math.cos(a) * R, Math.sin(a) * R * 0.85]);
      }
      m.extrude(plat, base, wallTop - base, hex("#8a7a5a"), hex("#9a8a5e"), 2);
      const n = 22;
      for (let i = 0; i < n; i++) {
        if (i === 5 || i === 6) continue; // gate on the seaward side
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const rr = R - 2;
        m.segment(Math.cos(a0) * rr, Math.sin(a0) * rr * 0.85, Math.cos(a1) * rr, Math.sin(a1) * rr * 0.85, wallTop, 4.5, 0.9, vary(ctx.rng, "#6a5034"));
      }
      m.box(-R * 0.25, wallTop, -R * 0.2, 9, 5, 7, hex("#6a4c30"), { top: false });
      m.shed(-R * 0.25, wallTop + 5, -R * 0.2, 9, 7, 2, 0.6, hex("#5a4a32"), hex("#6a4c30"));
      for (let i = 0; i < 3; i++) cannon(ctx.detail, -6 + i * 6, wallTop, R * 0.6);
      flagpole(ctx, R * 0.3, wallTop, -R * 0.3, 14, 1.1, "pirates");
      peak = wallTop + 14;
      break;
    }
  }
  ctx.flags.pop();
  ctx.detail.pop();
  m.pop();
  return peak;
}

/** Two-bastion battery outline: a rectangle with arrowhead bastions on the seaward (+z) corners. */
function bastionTwo(R: number): [number, number][] {
  const a = R * 0.9, b = R * 0.6, f = a * 0.32, s = a * 0.22, t = a * 0.3;
  return [
    [-a, -b],
    [a, -b],
    [a, b - f],
    [a + s, b - f],
    [a + t, b + t],
    [a - f, b + s],
    [a - f, b],
    [-a + f, b],
    [-a + f, b + s],
    [-a - t, b + t],
    [-a - s, b - f],
    [-a, b - f],
  ];
}
/** City rampart segment with a parapet between two local points. */
export function rampart(ctx: CityCtx, ax: number, az: number, bx: number, bz: number, scale = 1) {
  const st = hex(ctx.style.fortStone);
  const g0 = ctx.site.height(ax, az), g1 = ctx.site.height(bx, bz), gm = ctx.site.height((ax + bx) / 2, (az + bz) / 2);
  const lo = Math.min(g0, g1, gm, WATER_Y) - 3;
  const hi = Math.max(g0, g1, gm, WATER_Y + 2) + 7 * scale;
  ctx.main.segment(ax, az, bx, bz, lo, hi - lo, 5 * scale, st, shade(st, 1.12));
  ctx.detail.segment(ax, az, bx, bz, hi, 1.3, 1, shade(st, 0.92));
}

/** Round/square tower on the ramparts. */
export function wallTower(ctx: CityCtx, x: number, z: number, scale = 1) {
  const st = hex(ctx.style.fortStone);
  const g = ctx.site.height(x, z);
  ctx.main.prism(x, Math.min(g, WATER_Y) - 3, z, 4.2 * scale, 3.8 * scale, Math.max(g, WATER_Y + 2) - Math.min(g, WATER_Y) + 3 + 10 * scale, 8, st, { cap: shade(st, 1.1) });
}

// ---------------------------------------------------------------------------------------------
// Waterfront, boats, ships
// ---------------------------------------------------------------------------------------------

/** Small boat (sloop/launch), bow toward local +z, waterline at WATER_Y. */
export function boat(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1, sail = false) {
  const S = scale;
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  const hull: [number, number][] = [[-1.9 * S, -6 * S], [1.9 * S, -6 * S], [2.1 * S, 2 * S], [0, 7 * S], [-2.1 * S, 2 * S]];
  m.extrude(hull, WATER_Y - 1, 2.6 * S, vary(ctx.rng, "#5a3e28"), hex("#9a7a52"), 0.3);
  m.prism(0, WATER_Y + 1.6 * S, 0.5 * S, 0.22 * S, 0.16 * S, 13 * S, 5, WOOD_DARK);
  if (sail) m.poly2([[0, WATER_Y + 3 * S, 0.3 * S], [0, WATER_Y + 13 * S, 0.3 * S], [0, WATER_Y + 3 * S, -5.5 * S]], CANVAS);
  else m.box(0, WATER_Y + 3.5 * S, -2 * S, 0.7 * S, 0.7 * S, 7 * S, CANVAS);
  m.pop();
}

/** Three-masted ship at anchor, bow toward local +z. */
export function ship(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1, nation = ctx.nation) {
  const S = scale;
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  ctx.flags.push(x, 0, z, yaw);
  const hullC = vary(ctx.rng, nation === "pirates" ? "#2e2622" : "#5a3a24");
  const hull: [number, number][] = [[-4.2 * S, -15 * S], [4.2 * S, -15 * S], [4.8 * S, 4 * S], [0, 17 * S], [-4.8 * S, 4 * S]];
  m.extrude(hull, WATER_Y - 2, 6 * S, hullC, hex("#a0825a"), 0.6 * S);
  m.box(0, WATER_Y + 4 * S, -12 * S, 8 * S, 3.5 * S, 6 * S, hullC); // quarterdeck
  ctx.detail.push(x, 0, z, yaw);
  for (let i = 0; i < 4; i++) {
    ctx.detail.decal(0, -3 * S, 9.4 * S, 20 * S, 2, -8 * S + i * 4.5 * S, -7 * S + i * 4.5 * S, WATER_Y + 2.2 * S, WATER_Y + 3 * S, hex("#1a1410"));
    ctx.detail.decal(0, -3 * S, 9.4 * S, 20 * S, 3, -8 * S + i * 4.5 * S, -7 * S + i * 4.5 * S, WATER_Y + 2.2 * S, WATER_Y + 3 * S, hex("#1a1410"));
  }
  ctx.detail.pop();
  const sailC = nation === "pirates" ? hex("#3a3632") : CANVAS;
  for (const [mz, mh] of [[8, 24], [-1, 28], [-10, 21]] as const) {
    m.prism(0, WATER_Y + 4 * S, mz * S, 0.45 * S, 0.3 * S, mh * S, 5, WOOD_DARK);
    // furled-ish square sails (at anchor): two shallow sails per mast
    for (const [y, w] of [[0.45, 7], [0.75, 5.5]] as const) {
      const yy = WATER_Y + 4 * S + mh * S * y;
      m.poly2([[-w * S, yy, mz * S + 0.4], [w * S, yy, mz * S + 0.4], [w * 0.9 * S, yy + 4.5 * S, mz * S + 0.4], [-w * 0.9 * S, yy + 4.5 * S, mz * S + 0.4]], sailC);
    }
  }
  m.segment(0, 17 * S, 0, 25 * S, WATER_Y + 4.5 * S, 0.5 * S, 0.5 * S, WOOD_DARK); // bowsprit
  flag(ctx.flags, 0.2, WATER_Y + 4 * S + 28 * S, -1 * S, 5 * S, 3.4 * S, nation);
  ctx.flags.pop();
  m.pop();
}

/** Ship hauled down on her side on the beach for careening (pirate havens). */
export function careenedShip(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1) {
  const S = scale;
  const m = ctx.main;
  const g = ctx.site.height(x, z);
  const y0 = Math.max(g, WATER_Y) - 1.5;
  m.push(x, 0, z, yaw);
  // side profile (z along the keel, y up) extruded across x: the hull lying with its deck facing −x
  const prof: [number, number][] = [[-14, 0], [12, 0], [16, 5], [10, 8], [-12, 8], [-15, 4]];
  const hullC = hex("#4a3424");
  const x0 = -2.5 * S, x1 = 3.5 * S;
  const P = (x: number, p: [number, number]): V3 => [x, y0 + p[1] * S, p[0] * S];
  const ins: V3 = [0, y0 + 4 * S, 0];
  m.poly(prof.map((p) => P(x0, p)), hex("#8a6a48"), ins);
  m.poly(prof.map((p) => P(x1, p)), hullC, ins);
  for (let i = 0; i < prof.length; i++) {
    const j = (i + 1) % prof.length;
    m.poly([P(x0, prof[i]), P(x0, prof[j]), P(x1, prof[j]), P(x1, prof[i])], shade(hullC, 0.9), ins);
  }
  // masts lying toward the water
  m.segment(-3 * S, -4 * S, -24 * S, -4 * S, y0 + 4 * S, 0.7, 0.7, WOOD_DARK);
  m.segment(-3 * S, 5 * S, -20 * S, 5 * S, y0 + 4 * S, 0.7, 0.7, WOOD_DARK);
  // tackle posts on shore
  ctx.detail.box(8 * S, y0, -6 * S, 0.7, 5, 0.7, WOOD_DARK);
  ctx.detail.box(8 * S, y0, 7 * S, 0.7, 5, 0.7, WOOD_DARK);
  m.pop();
}

/** Gallows on a little platform. */
export function gallows(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1) {
  const g = groundSpan(ctx.site, x, z, 6, 4, yaw);
  const y = g.max + 0.2;
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  m.box(0, g.min - 1, 0, 6 * scale, y - g.min + 2.2, 4.5 * scale, PLANK);
  m.box(-2.3 * scale, y + 1.2, 0, 0.6, 8 * scale, 0.6, WOOD_DARK);
  m.box(2.3 * scale, y + 1.2, 0, 0.6, 8 * scale, 0.6, WOOD_DARK);
  m.box(0, y + 1.2 + 8 * scale, 0, 5.4 * scale, 0.6, 0.6, WOOD_DARK);
  ctx.detail.box(0.8, y + 4.5 * scale, 0, 0.15, 4.6 * scale, 0.15, hex("#a08a60"));
  m.pop();
}

/** Lighthouse tower with lantern. */
export function lighthouse(ctx: CityCtx, x: number, z: number, _yaw: number, scale = 1): number {
  const S = scale;
  const g = ctx.site.height(x, z);
  const y = Math.max(g, WATER_Y + 1) - 2;
  const m = ctx.main;
  m.prism(x, y, z, 4 * S, 3 * S, 12 * S, 8, hex("#f0ece2"));
  m.prism(x, y + 12 * S, z, 3 * S, 2.6 * S, 10 * S, 8, hex("#b8402e"));
  m.box(x, y + 22 * S, z, 6.6 * S, 0.8, 6.6 * S, hex("#3a3a3a"));
  m.prism(x, y + 22.8 * S, z, 2.4 * S, 2.4 * S, 3 * S, 8, hex("#f6e7a0"));
  m.prism(x, y + 25.8 * S, z, 2.8 * S, 0, 2.6 * S, 8, hex("#3a3a3a"));
  return y + 28.4 * S;
}

/** Round riverside tower (Torre del Oro): 12-sided body, smaller upper stage, dome. */
export function roundTower(ctx: CityCtx, x: number, z: number, _yaw: number, scale = 1): number {
  const S = scale;
  const g = ctx.site.height(x, z);
  const y = Math.min(g, WATER_Y) - 2;
  const top = Math.max(g, WATER_Y + 2);
  const c = hex("#d8b878");
  const m = ctx.main;
  m.prism(x, y, z, 7 * S, 6.6 * S, top - y + 14 * S, 12, c, { cap: shade(c, 1.1) });
  m.prism(x, top + 14 * S, z, 4 * S, 4 * S, 7 * S, 12, shade(c, 1.05));
  m.dome(x, top + 21 * S, z, 4 * S, 12, 2, hex("#c9a640"));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.detail.box(x + Math.cos(a) * 7.1 * S, top + 9 * S, z + Math.sin(a) * 7.1 * S, 1.1, 2.4, 1.1, hex("#2a2420"));
  }
  return top + 25 * S;
}

/** Square waterfront tower with a gun platform toward the sea (Belém). */
export function belemTower(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1): number {
  const S = scale;
  const g = ctx.site.height(x, z);
  const y = Math.min(g, WATER_Y) - 2;
  const top = Math.max(g, WATER_Y + 2);
  const c = hex("#efe6d0");
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  m.extrude([[-9 * S, -4 * S], [9 * S, -4 * S], [9 * S, 8 * S], [0, 14 * S], [-9 * S, 8 * S]], y, top - y + 5 * S, c, shade(c, 1.05), 0.5);
  m.box(0, y, -9 * S, 10 * S, top - y + 26 * S, 10 * S, c, { top: shade(c, 0.95) });
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.prism((a * 5 * S), top + 26 * S, -9 * S + b * 5 * S, 1.2 * S, 1.2 * S, 2 * S, 6, c);
    m.dome(a * 5 * S, top + 28 * S, -9 * S + b * 5 * S, 1.3 * S, 6, 2, c);
  }
  for (let i = 0; i < 3; i++) ctx.detail.decal(0, -9 * S, 10 * S, 10 * S, 0, -1.2, 1.2, top + (8 + i * 6) * S, top + (10.6 + i * 6) * S, hex("#2a2a30"));
  m.pop();
  return top + 30 * S;
}

/** Ruined church facade on a stair (Macau's São Paulo / Goa's basilica front). */
export function facade(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1, colorHex = "#c8b89a"): number {
  const S = scale;
  const g = groundSpan(ctx.site, x, z, 24 * S, 14 * S, yaw);
  const c = hex(colorHex);
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  // stairs down the front (+z)
  for (let i = 0; i < 5; i++) m.box(0, g.min - 2, 4 * S + i * 2.2 * S, (20 - i * 1.2) * S, g.max - g.min + 2 + (5 - i) * 0.9 * S, 2.4 * S, hex("#b8ae9c"));
  const y = g.max + 4.5 * S;
  m.box(0, g.min - 2, 0, 22 * S, y - g.min + 2 + 10 * S, 2.4 * S, c);
  m.box(0, y + 10 * S, 0, 17 * S, 8 * S, 2.4 * S, c);
  m.box(0, y + 18 * S, 0, 11 * S, 7 * S, 2.4 * S, c);
  m.poly([[-6 * S, y + 25 * S, 1.21 * S], [6 * S, y + 25 * S, 1.21 * S], [0, y + 30 * S, 1.21 * S]], c, [0, y + 26 * S, -1]);
  m.poly([[-6 * S, y + 25 * S, -1.21 * S], [6 * S, y + 25 * S, -1.21 * S], [0, y + 30 * S, -1.21 * S]], c, [0, y + 26 * S, 1]);
  m.box(0, y + 30 * S, 0, 0.5, 3 * S, 0.5, IRON);
  const d = ctx.detail;
  d.push(x, 0, z, yaw);
  const hole = hex("#7a8aa0"); // sky through the empty windows
  for (const u of [-6, 0, 6]) d.decal(0, 0, 22 * S, 2.4 * S, 0, (u - 1.2) * S, (u + 1.2) * S, y + 1 * S, y + (u === 0 ? 7 : 5.5) * S, u === 0 ? hex("#3a3028") : hole);
  for (const u of [-4, 0, 4]) d.decal(0, 0, 17 * S, 2.4 * S, 0, (u - 1) * S, (u + 1) * S, y + 12 * S, y + 15.5 * S, hole);
  d.decal(0, 0, 11 * S, 2.4 * S, 0, -1.4 * S, 1.4 * S, y + 19.5 * S, y + 23 * S, hole);
  d.pop();
  m.pop();
  return y + 33 * S;
}

/** Square keep with four corner turrets (Tower of London hint). */
export function keep(ctx: CityCtx, x: number, z: number, yaw: number, scale = 1): number {
  const S = scale;
  const g = groundSpan(ctx.site, x, z, 18 * S, 18 * S, yaw);
  const c = hex("#d8d0bc");
  const m = ctx.main;
  m.push(x, 0, z, yaw);
  m.box(0, g.min - 3, 0, 16 * S, g.max - g.min + 3 + 18 * S, 14 * S, c, { top: hex("#8a8478") });
  const y = g.max + 18 * S;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.box((a * 8 * S), y - 2, b * 7 * S, 3 * S, 6 * S, 3 * S, c, { top: false });
    m.prism(a * 8 * S, y + 4 * S - 2, b * 7 * S, 1.9 * S, 0, 3 * S, 6, hex("#5a6060"));
  }
  for (let i = 0; i < 3; i++) ctx.detail.push(x, 0, z, yaw).decal(0, 0, 16 * S, 14 * S, 0, (-5 + i * 5 - 0.7) * S, (-5 + i * 5 + 0.7) * S, y - 8 * S, y - 5 * S, hex("#2a2a30")).pop();
  m.pop();
  return y + 5 * S;
}

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

export function treeKindAt(kind: TreeKind | "auto", lat: number, rng: Rng): Exclude<TreeKind, "mixed"> {
  const a = Math.abs(lat);
  if (kind === "auto") {
    if (a < 26) return rng() < 0.85 ? "palm" : "broadleaf";
    if (a > 47) return rng() < 0.3 ? "conifer" : "broadleaf";
    if (a > 38) return rng() < 0.35 ? "conifer" : "broadleaf";
    return rng() < 0.25 ? "palm" : "broadleaf";
  }
  if (kind === "mixed") return rng() < 0.5 ? "conifer" : "broadleaf";
  return kind;
}

export function tree(ctx: CityCtx, kind: Exclude<TreeKind, "mixed">, x: number, z: number) {
  const m = ctx.main;
  const rng = ctx.rng;
  const g = ctx.site.height(x, z) - 0.5;
  const s = range(rng, 0.8, 1.25);
  if (kind === "palm") {
    const lean = range(rng, -1.6, 1.6), lean2 = range(rng, -1.6, 1.6);
    const h = 11 * s;
    m.prism(x, g, z, 0.6, 0.45, h * 0.55, 5, hex("#8a7050"));
    const tx = x + lean, tz = z + lean2;
    m.prism(tx, g + h * 0.55 - 0.2, tz, 0.45, 0.35, h * 0.45, 5, hex("#8a7050"));
    const ty = g + h;
    const green = vary(rng, "#4a7a32", 0.12);
    const n = 6;
    const a0 = rng() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const L = 6.5 * s;
      m.poly2([[tx - sa * 0.9, ty, tz + ca * 0.9], [tx + sa * 0.9, ty, tz - ca * 0.9], [tx + ca * L, ty - 3.2 * s, tz + sa * L]], green);
    }
  } else if (kind === "conifer") {
    const c = vary(rng, "#2e5a34", 0.1);
    m.prism(x, g, z, 0.5, 0.4, 3 * s, 5, hex("#5a4030"));
    m.prism(x, g + 2.5 * s, z, 4 * s, 0, 8 * s, 6, c);
    m.prism(x, g + 6.5 * s, z, 3 * s, 0, 7 * s, 6, shade(c, 1.1));
  } else {
    const c = vary(rng, "#4a7a3a", 0.12);
    m.prism(x, g, z, 0.6, 0.45, 4 * s, 5, hex("#5a4030"));
    m.prism(x, g + 3.5 * s, z, 2.8 * s, 4.6 * s, 3.2 * s, 7, c, { cap: false, bottom: true });
    m.prism(x, g + 6.7 * s, z, 4.6 * s, 0.8 * s, 4.2 * s, 7, shade(c, 1.08));
  }
}

// ---------------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------------

const NU = 7, NV = 6;

/** Flag cell colour for a nation at (u along the fly 0..1, v top→bottom 0..1). */
export function flagCell(nation: string, u: number, v: number): string {
  switch (nation) {
    case "england":
      return Math.abs(u - 0.5) < 0.08 || Math.abs(v - 0.5) < 0.1 ? "#c8202a" : "#f4f1ea";
    case "spain":
      return Math.abs(u - v) < 0.16 || Math.abs(u - (1 - v)) < 0.16 ? "#b8202a" : "#f4f1ea";
    case "netherlands":
      return v < 1 / 3 ? "#d8562a" : v < 2 / 3 ? "#f4f1ea" : "#24448a";
    case "france":
      return Math.abs(u - 0.5) < 0.1 && Math.abs(v - 0.5) < 0.2 ? "#d8b040" : "#f4f1ea";
    case "portugal":
      return Math.abs(u - 0.5) < 0.12 && Math.abs(v - 0.5) < 0.25 ? (v < 0.5 ? "#24448a" : "#b8202a") : "#f4f1ea";
    case "pirates":
      if (Math.abs(u - 0.5) < 0.1 && v > 0.15 && v < 0.5) return "#f0ece0";
      if (v > 0.55 && v < 0.85 && (Math.abs(u - 0.5 - (v - 0.7)) < 0.08 || Math.abs(u - 0.5 + (v - 0.7)) < 0.08)) return "#f0ece0";
      return "#121212";
    default:
      return "#e6c577";
  }
}

/** Waving flag in the x–y plane: hoist at (x, yTop) on the pole, flying toward +x. */
export function flag(b: MeshBuilder, x: number, yTop: number, z: number, w: number, h: number, nation: string) {
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const u0 = i / NU, u1 = (i + 1) / NU, v0 = j / NV, v1 = (j + 1) / NV;
      const c = hex(flagCell(nation, (u0 + u1) / 2, (v0 + v1) / 2));
      b.poly2(
        [
          [x + u0 * w, yTop - v0 * h, z],
          [x + u1 * w, yTop - v0 * h, z],
          [x + u1 * w, yTop - v1 * h, z],
          [x + u0 * w, yTop - v1 * h, z],
        ],
        c,
        [u0 + 0.001, u1, u1, u0 + 0.001],
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Registry of placeable extras (styles.ts `extras`, cities.ts `extras`)
// ---------------------------------------------------------------------------------------------

export type ExtraPiece = (ctx: CityCtx, x: number, z: number, yaw: number, scale: number) => number | void;

const landmarkPiece = (k: LandmarkKind): ExtraPiece => (ctx, x, z, yaw, s) => landmark(ctx, k, x, z, yaw, s);
const fortPiece = (k: FortKind): ExtraPiece => (ctx, x, z, yaw, s) => fort(ctx, k, x, z, yaw, s);

export const EXTRA_PIECES: Record<string, ExtraPiece> = {
  windmill,
  gallows,
  careened_ship: careenedShip,
  lighthouse,
  round_tower: roundTower,
  belem_tower: belemTower,
  facade,
  basilica_facade: (ctx, x, z, yaw, s) => facade(ctx, x, z, yaw, s, "#9a5a3a"),
  keep,
  ship: (ctx, x, z, yaw, s) => ship(ctx, x, z, yaw, s),
  pirate_ship: (ctx, x, z, yaw, s) => ship(ctx, x, z, yaw, s, "pirates"),
  boat: (ctx, x, z, yaw, s) => boat(ctx, x, z, yaw, s, true),
  church_bell_tower: landmarkPiece("bell_tower"),
  church_twin_towers: landmarkPiece("twin_towers"),
  church_steeple: landmarkPiece("steeple"),
  church_gothic_tower: landmarkPiece("gothic_tower"),
  church_dome: landmarkPiece("dome"),
  pagoda: landmarkPiece("pagoda"),
  chapel: landmarkPiece("chapel"),
  fort_star: fortPiece("star"),
  fort_bastion: fortPiece("bastion"),
  fort_castle: fortPiece("castle"),
  fort_morro: fortPiece("morro"),
  fort_palisade: fortPiece("palisade"),
};

/** Footprint radius (metric) the layout reserves for an extra. */
export function extraRadius(piece: string, scale: number): number {
  if (piece.startsWith("fort_")) return 34 * scale;
  if (piece.startsWith("church_") || piece === "pagoda") return 22 * scale;
  if (piece === "ship" || piece === "pirate_ship") return 22 * scale;
  if (piece === "careened_ship") return 18 * scale;
  if (piece === "facade" || piece === "basilica_facade" || piece === "keep" || piece === "belem_tower") return 18 * scale;
  return 10 * scale;
}
void mixRGB;
