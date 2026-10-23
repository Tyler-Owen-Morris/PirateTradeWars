/**
 * Port-city layout (README.md): turns a port + its terrain into three merged geometry layers.
 * Pure and deterministic (seeded by the port key); no three.js. Unit-tested in __tests__/city.test.ts.
 *
 * Frame: local METRIC coordinates around the town anchor (port x/z): +x east, +z south (world z),
 * y = render height. The component (PortCity.tsx) converts x to world x-units and draws the layers
 * through the floating-origin transform, so they sit exactly on the terrain.
 *
 * Order (waterfront first, town climbing inland, landmark/fort on top):
 *   1. coast point C on the line town -> dock; seaward normal n; tangent t; "a(s, q)" = C + t·s − n·q
 *   2. stone quay along the coast, piers into the water with boats, warehouses behind the quay
 *   3. plaza + main landmark inland of the quay; harbour fort at the mouth (or high point)
 *   4. extras (style + city), optional ramparts, then houses on a street grid (densest at the core,
 *      only on land, not on steep ground), then trees by climate, flags.
 */
import { MeshBuilder, hex, shade, type BuiltLayer } from "./meshBuilder";
import {
  EXTRA_PIECES,
  WATER_Y,
  boat,
  extraRadius,
  flagpole,
  fort,
  groundSpan,
  house,
  landmark,
  pick,
  rampart,
  range,
  rngFor,
  ship,
  tree,
  treeKindAt,
  wallTower,
  warehouse,
  type CityCtx,
  type CitySite,
} from "./pieces";
import { STYLES, styleIdForPort, type CityStyle, type ExtraRef } from "./styles";
import { CITY_CUSTOM, type CityCustom } from "./cities";

export type { CitySite } from "./pieces";

export interface CityInput {
  key: string;
  name: string;
  nation?: string;
  region?: string;
  /** Latitude in degrees (climate: palms / conifers). */
  lat: number;
  /** Dock point in local metric coordinates (relative to the town anchor). */
  dock: { x: number; z: number };
}

export interface CityBuild {
  styleId: string;
  main: BuiltLayer;
  detail: BuiltLayer;
  flags: BuiltLayer;
  /** Metric radius that contains the whole city (for culling). */
  radius: number;
  /** Suggested y for the name label. */
  labelY: number;
  stats: { houses: number; warehouses: number; trees: number; extras: number; piers: number; ms: number; placed: string[]; missed: string[] };
}

/** Effective style for a port: style table + per-city tweaks. */
export function resolveCityStyle(input: Pick<CityInput, "key" | "nation" | "region">): { style: CityStyle; custom: CityCustom | undefined; size: number } {
  const custom = CITY_CUSTOM[input.key];
  const base = STYLES[styleIdForPort(input.nation, input.region, custom?.style)];
  const style: CityStyle = { ...base, ...(custom?.tweak ?? {}) };
  return { style, custom, size: custom?.size ?? 1 };
}

/** Occupancy grid (4-unit cells) so pieces don't overlap. */
class Occupancy {
  private cells = new Set<number>();
  private static key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  private each(x: number, z: number, w: number, d: number, yaw: number, fn: (k: number) => boolean | void): boolean {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const nu = Math.max(1, Math.ceil(w / 3)), nv = Math.max(1, Math.ceil(d / 3));
    for (let a = 0; a <= nu; a++) {
      for (let b = 0; b <= nv; b++) {
        const u = -w / 2 + (a * w) / nu, v = -d / 2 + (b * d) / nv;
        const px = x + u * c + v * s, pz = z - u * s + v * c;
        if (fn(Occupancy.key(Math.floor(px / 4), Math.floor(pz / 4))) === false) return false;
      }
    }
    return true;
  }
  free(x: number, z: number, w: number, d: number, yaw: number): boolean {
    return this.each(x, z, w, d, yaw, (k) => !this.cells.has(k));
  }
  mark(x: number, z: number, w: number, d: number, yaw: number): void {
    this.each(x, z, w, d, yaw, (k) => {
      this.cells.add(k);
    });
  }
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildCity(input: CityInput, site: CitySite): CityBuild {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { style: st, custom, size } = resolveCityStyle(input);
  const rng = rngFor(input.key);
  const ctx: CityCtx = {
    main: new MeshBuilder(),
    detail: new MeshBuilder(),
    flags: new MeshBuilder(),
    style: st,
    rng,
    nation: input.nation ?? "england",
    lat: input.lat,
    site,
  };
  const occ = new Occupancy();
  const R = st.radius * Math.sqrt(size);
  const stats = { houses: 0, warehouses: 0, trees: 0, extras: 0, piers: 0, ms: 0, placed: [] as string[], missed: [] as string[] };
  let labelY = 40;

  // --- 1. coast frame ---------------------------------------------------------------------------
  const grad = (x: number, z: number) => {
    const h = 4;
    const gx = (site.sdf(x + h, z) - site.sdf(x - h, z)) / (2 * h);
    const gz = (site.sdf(x, z + h) - site.sdf(x, z - h)) / (2 * h);
    const l = Math.hypot(gx, gz);
    return l > 1e-6 ? { x: gx / l, z: gz / l } : { x: 0, z: 1 };
  };
  const project = (x: number, z: number): { x: number; z: number } | null => {
    for (let i = 0; i < 6; i++) {
      const d = site.sdf(x, z);
      if (Math.abs(d) < 0.5) break;
      const g = grad(x, z);
      x -= g.x * d;
      z -= g.z * d;
    }
    return Math.abs(site.sdf(x, z)) < 3 ? { x, z } : null;
  };
  let ux = input.dock.x, uz = input.dock.z;
  const ul = Math.hypot(ux, uz);
  if (ul > 1e-6) {
    ux /= ul;
    uz /= ul;
  } else {
    ux = 0;
    uz = 1;
  }
  let C: { x: number; z: number } | null = null;
  if (site.sdf(0, 0) < 0) {
    let prev = 0;
    for (let tt = 4; tt < 1600; tt += 4) {
      if (site.sdf(ux * tt, uz * tt) >= 0) {
        let a = prev, b = tt;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          if (site.sdf(ux * m, uz * m) >= 0) b = m;
          else a = m;
        }
        C = { x: ux * b, z: uz * b };
        break;
      }
      prev = tt;
    }
  }
  if (!C) C = project(0, 0) ?? { x: ux * 40, z: uz * 40 };
  const n = grad(C.x, C.z); // seaward
  const tx = -n.z, tz = n.x; // along the coast
  const at = (s: number, q: number) => ({ x: C!.x + tx * s - n.x * q, z: C!.z + tz * s - n.z * q });
  const yawOf = (nx: number, nz: number) => Math.atan2(nx, nz);
  const yawSea = yawOf(n.x, n.z);
  const isLand = (x: number, z: number, margin = 0) => site.sdf(x, z) < -margin;

  // --- 2. waterfront ----------------------------------------------------------------------------
  const L = (st.piers >= 3 ? 230 : 180) * Math.sqrt(size);
  const quay: ({ x: number; z: number; nx: number; nz: number; s: number } | null)[] = [];
  for (let s = -L / 2; s <= L / 2 + 0.01; s += 10) {
    const a = at(s, 0);
    const p = project(a.x, a.z);
    if (!p || Math.hypot(p.x - a.x, p.z - a.z) > 40) {
      quay.push(null);
      continue;
    }
    const g = grad(p.x, p.z);
    quay.push(g.x * n.x + g.z * n.z > 0.3 ? { ...p, nx: g.x, nz: g.z, s } : null);
  }
  const quayStone = hex(st.id === "pirate_haven" ? "#7a6448" : "#8f8574");
  const quayTop = st.id === "pirate_haven" ? hex("#8a6a48") : hex("#b0a690");
  const QY = WATER_Y + 4;
  for (let i = 0; i + 1 < quay.length; i++) {
    const a = quay[i], b = quay[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    if (l > 16 || a.nx * b.nx + a.nz * b.nz < 0.7) continue; // the coast jumps (spit, corner): leave a gap
    const ex = (dx / l) * 1.2, ez = (dz / l) * 1.2;
    const ax = a.x - a.nx * 3.5 - ex, az = a.z - a.nz * 3.5 - ez;
    const bx = b.x - b.nx * 3.5 + ex, bz = b.z - b.nz * 3.5 + ez;
    if (st.id === "pirate_haven") ctx.main.segment(ax, az, bx, bz, QY - 1.2, 1.2, 15, quayStone, quayTop);
    else ctx.main.segment(ax, az, bx, bz, WATER_Y - 5, QY - WATER_Y + 5, 17, quayStone, quayTop);
    occ.mark((ax + bx) / 2, (az + bz) / 2, l + 2, 18, yawOf(a.nx, a.nz));
    if (i % 2 === 0) ctx.detail.prism(a.x + a.nx * 4.2, QY, a.z + a.nz * 4.2, 0.55, 0.5, 1.3, 6, hex("#2e2e30"));
  }
  // piers + boats
  const valid = quay.map((q, i) => (q ? i : -1)).filter((i) => i >= 0);
  let boatsLeft = st.boats;
  const pierDeck = hex("#8a6a48");
  for (let k = 0; k < st.piers && valid.length > 2; k++) {
    const want = Math.round(((k + 1) / (st.piers + 1)) * (quay.length - 1));
    const idx = valid.reduce((b, i) => (Math.abs(i - want) < Math.abs(b - want) ? i : b), valid[0]);
    const q = quay[idx]!;
    let Lp = range(rng, 45, 75);
    for (let s = 8; s <= Lp; s += 5) {
      if (site.sdf(q.x + q.nx * s, q.z + q.nz * s) < 5) {
        Lp = s - 6;
        break;
      }
    }
    if (Lp < 18) continue;
    stats.piers++;
    const x0 = q.x + q.nx * 4, z0 = q.z + q.nz * 4, x1 = q.x + q.nx * Lp, z1 = q.z + q.nz * Lp;
    ctx.main.segment(x0, z0, x1, z1, QY - 1.8, 1.1, 6.5, pierDeck);
    for (let s = 8; s <= Lp; s += 8) {
      for (const side of [-1, 1]) {
        ctx.detail.prism(q.x + q.nx * s - q.nz * side * 3.3, WATER_Y - 4, q.z + q.nz * s + q.nx * side * 3.3, 0.45, 0.45, QY - WATER_Y + 3.4, 5, hex("#4a3624"));
      }
    }
    const yaw = yawOf(q.nx, q.nz);
    for (const side of [-1, 1]) {
      if (boatsLeft <= 0) break;
      const s = Lp * range(rng, 0.45, 0.8);
      boat(ctx, q.x + q.nx * s - q.nz * side * 6.6, q.z + q.nz * s + q.nx * side * 6.6, yaw + (rng() - 0.5) * 0.1, range(rng, 0.9, 1.25), rng() < 0.3);
      boatsLeft--;
    }
  }
  // flag on the quay
  {
    const mid = quay[Math.floor(quay.length / 2)] ?? valid.map((i) => quay[i]).find(Boolean);
    if (mid) flagpole(ctx, mid.x - mid.nx * 6, QY, mid.z - mid.nz * 6, 13);
  }
  // warehouses behind the quay
  for (let s = -L / 2 + 6, placed = 0; s < L / 2 - 10 && placed < Math.round(st.warehouses * Math.sqrt(size)); ) {
    const w = range(rng, 22, 30), d = range(rng, 13, 16);
    const a = at(s + w / 2, 0);
    const p = project(a.x, a.z);
    s += w + range(rng, 2, 6);
    if (!p) continue;
    const g = grad(p.x, p.z);
    const q = 16 + d / 2;
    const cx = p.x - g.x * q, cz = p.z - g.z * q;
    const yaw = yawOf(g.x, g.z);
    if (!isLand(cx, cz, d / 2) || !occ.free(cx, cz, w + 2, d + 2, yaw)) continue;
    const gs = groundSpan(site, cx, cz, w, d, yaw);
    if (gs.max - gs.min > 6) continue;
    warehouse(ctx, cx, cz, yaw, w, d);
    occ.mark(cx, cz, w + 3, d + 5, yaw);
    placed++;
    stats.warehouses++;
  }

  // --- 3. plaza, landmark, fort ------------------------------------------------------------------
  // plaza: first point inland of the quay with 30 units of land around it, else the most inland one
  let qPlaza = 55 + R * 0.2;
  {
    let bestQ = qPlaza, bestD = Infinity;
    for (let q = Math.min(qPlaza, 30); q < R; q += 8) {
      const p = at(0, q);
      const d = site.sdf(p.x, p.z);
      if (q >= qPlaza && d < -30) {
        bestQ = q;
        bestD = d;
        break;
      }
      if (d < bestD) {
        bestD = d;
        bestQ = q;
      }
    }
    qPlaza = bestQ;
  }
  const P = at(0, qPlaza);
  {
    const gs = groundSpan(site, P.x, P.z, 26, 22, yawSea);
    ctx.main.push(P.x, 0, P.z, yawSea);
    ctx.main.box(0, gs.min - 2, 0, 26, gs.max - gs.min + 2.3, 22, shade(hex("#a89c84"), 0.9), { top: hex("#c4b89c") });
    ctx.main.pop();
    occ.mark(P.x, P.z, 26, 22, yawSea);
  }
  if (st.landmark !== "none") {
    const lm = { x: P.x - n.x * (27 * (custom?.landmarkScale ?? 1)), z: P.z - n.z * (27 * (custom?.landmarkScale ?? 1)) };
    const big = st.landmark === "dome" ? 1.25 : 1;
    const ls = custom?.landmarkScale ?? (size > 1.15 ? 1.15 : 1);
    const top = landmark(ctx, st.landmark, lm.x, lm.z, yawSea, big * ls);
    occ.mark(lm.x, lm.z, 36 * big * ls, 40 * big * ls, yawSea);
    labelY = Math.max(labelY, top);
  }

  // high ground (for forts / extras)
  const highSpots = (clear: number) => {
    let best: { x: number; z: number; h: number } | null = null;
    for (let x = -R * 1.2; x <= R * 1.2; x += 12) {
      for (let z = -R * 1.2; z <= R * 1.2; z += 12) {
        const px = P.x + x, pz = P.z + z;
        if (x * x + z * z > R * R * 1.44) continue;
        if (!isLand(px, pz, clear * 0.7)) continue;
        if (!occ.free(px, pz, clear * 2, clear * 2, 0)) continue;
        const h = site.height(px, pz);
        if (!best || h > best.h) best = { x: px, z: pz, h };
      }
    }
    return best;
  };
  const coastSpot = (side: number, startS: number, clear: number, inland: number, preferSeaward: boolean) => {
    let best: { x: number; z: number; yaw: number; score: number } | null = null;
    for (let k = 0; k < 8; k++) {
      const s = side * (startS + k * 22);
      const a = at(s, 0);
      const p = project(a.x, a.z);
      if (!p) continue;
      const g = grad(p.x, p.z);
      const cx = p.x - g.x * inland, cz = p.z - g.z * inland;
      if (!isLand(cx, cz, Math.min(inland * 0.5, 12))) continue;
      const yaw = yawOf(g.x, g.z);
      if (!occ.free(cx, cz, clear * 2, clear * 2, yaw)) continue;
      const score = (preferSeaward ? p.x * ux + p.z * uz : 0) - k * 4;
      if (!best || score > best.score) best = { x: cx, z: cz, yaw, score };
    }
    return best;
  };
  let fortSide = custom?.fortSide ?? 0;
  if (st.fort !== "none") {
    const fs = custom?.fortScale ?? 1;
    const Rf = (st.fort === "star" ? 40 : st.fort === "morro" ? 38 : st.fort === "castle" ? 30 : 26) * fs;
    let spot: { x: number; z: number; yaw: number } | null = null;
    if (custom?.fortWhere === "highpoint") {
      const h = highSpots(Rf);
      if (h) spot = { x: h.x, z: h.z, yaw: yawSea };
    }
    if (!spot) {
      const sides = fortSide ? [fortSide] : [1, -1];
      let best: { x: number; z: number; yaw: number; score: number } | null = null;
      for (const sd of sides) {
        const c = coastSpot(sd, L / 2 + Rf * 0.6, Rf, Rf * 0.75, true);
        if (c && (!best || c.score > best.score)) {
          best = c;
          fortSide = sd;
        }
      }
      spot = best;
    }
    if (!spot) {
      const h = highSpots(Rf);
      if (h) spot = { x: h.x, z: h.z, yaw: yawSea };
    }
    if (!spot) stats.missed.push(`fort_${st.fort}`);
    else stats.placed.push(`fort_${st.fort}`);
    if (spot) {
      const top = fort(ctx, st.fort, spot.x, spot.z, spot.yaw, fs);
      occ.mark(spot.x, spot.z, Rf * 2.4, Rf * 2.4, spot.yaw);
      labelY = Math.max(labelY, top * 0.8);
      stats.extras++;
    }
  }
  if (!fortSide) fortSide = 1;

  // --- 4. extras ---------------------------------------------------------------------------------
  const extras: ExtraRef[] = [...st.extras, ...(custom?.extras ?? [])];
  let anchorYaw = yawSea + Math.PI / 2 + (rng() - 0.5) * 0.6;
  const placeExtra = (ref: ExtraRef) => {
    const fn = EXTRA_PIECES[ref.piece];
    if (!fn) return;
    const sc = ref.scale ?? 1;
    const r = extraRadius(ref.piece, sc);
    let spot: { x: number; z: number; yaw: number } | null = null;
    switch (ref.where) {
      case "highpoint": {
        const h = highSpots(r);
        if (h) spot = { x: h.x, z: h.z, yaw: yawSea };
        break;
      }
      case "coast":
      case "mouth": {
        const side = ref.where === "mouth" ? -fortSide : rng() < 0.5 ? 1 : -1;
        const inland = ref.piece.includes("tower") || ref.piece === "careened_ship" || ref.piece === "lighthouse" ? r * 0.3 : r * 0.9;
        spot = coastSpot(side, L / 2 + r + 6, r, inland, ref.where === "mouth") ?? coastSpot(-side, L / 2 + r + 6, r, inland, false);
        break;
      }
      case "plaza": {
        outer: for (const off of [16, 30, 46, 64]) {
          for (const inl of [10, 30, -6]) {
            for (const side of [1, -1]) {
              const x = P.x + tx * side * (r + off) - n.x * inl, z = P.z + tz * side * (r + off) - n.z * inl;
              if (isLand(x, z, r * 0.5) && occ.free(x, z, r * 2, r * 2, yawSea)) {
                spot = { x, z, yaw: yawSea };
                break outer;
              }
            }
          }
        }
        break;
      }
      case "water": {
        for (let i = 0; i < 30 && !spot; i++) {
          const off = range(rng, 90, 230), side = range(rng, -170, 170);
          const x = C!.x + n.x * off + tx * side, z = C!.z + n.z * off + tz * side;
          const dd = Math.hypot(x - input.dock.x, z - input.dock.z);
          if (site.sdf(x, z) > 35 && dd > 70 && occ.free(x, z, r * 2, r * 2, 0)) spot = { x, z, yaw: anchorYaw + (rng() - 0.5) * 0.3 };
        }
        break;
      }
      case "outskirts":
      default: {
        for (let i = 0; i < 60 && !spot; i++) {
          const a = rng() * Math.PI * 2, dist = R * range(rng, 0.75, 1.15);
          const x = P.x + Math.cos(a) * dist, z = P.z + Math.sin(a) * dist;
          if (isLand(x, z, r) && occ.free(x, z, r * 2, r * 2, 0)) spot = { x, z, yaw: yawSea + (rng() - 0.5) };
        }
      }
    }
    if (!spot && ref.where !== "water" && ref.where !== "outskirts" && ref.where !== "highpoint") {
      // fallback: anywhere on the edge of town
      for (let i = 0; i < 80 && !spot; i++) {
        const a = rng() * Math.PI * 2, dist = R * range(rng, 0.5, 1.2);
        const x = P.x + Math.cos(a) * dist, z = P.z + Math.sin(a) * dist;
        if (isLand(x, z, r * 0.5) && occ.free(x, z, r * 2, r * 2, 0)) spot = { x, z, yaw: yawSea };
      }
    }
    if (!spot) {
      stats.missed.push(ref.piece);
      return;
    }
    stats.placed.push(ref.piece);
    const top = fn(ctx, spot.x, spot.z, spot.yaw, sc);
    occ.mark(spot.x, spot.z, r * 2, r * 2, spot.yaw);
    if (typeof top === "number" && ref.where !== "water") labelY = Math.max(labelY, top * 0.85);
    stats.extras++;
  };
  for (const ref of extras) for (let i = 0; i < (ref.count ?? 1); i++) placeExtra(ref);
  for (let i = 0; i < st.shipsAtAnchor; i++) placeExtra({ piece: st.id === "pirate_haven" ? "pirate_ship" : "ship", where: "water", scale: range(rng, 0.8, 1.05) });
  void anchorYaw;
  anchorYaw = 0;

  // --- 5. ramparts -------------------------------------------------------------------------------
  const Rw = R * 0.95;
  if (st.cityWalls) {
    const N = 20;
    const pts = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      return { x: P.x + Math.cos(a) * Rw, z: P.z + Math.sin(a) * Rw };
    });
    const ok = pts.map((p) => isLand(p.x, p.z, 3));
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = pts[i], b = pts[j];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (!ok[i] || !ok[j] || !isLand(mid.x, mid.z, 3)) continue;
      rampart(ctx, a.x, a.z, b.x, b.z);
      occ.mark(mid.x, mid.z, Math.hypot(b.x - a.x, b.z - a.z) + 4, 9, yawOf(b.z - a.z, -(b.x - a.x)));
      if (i % 2 === 0) wallTower(ctx, a.x, a.z);
    }
  }

  // --- 6. houses -----------------------------------------------------------------------------------
  const maxHouses = Math.round(st.maxHouses * size);
  const rowPitch = st.houseD[1] + (st.house === "canal" ? 8 : 5.5);
  const gap = st.house === "canal" || st.id === "english" ? 0.25 : 1.6;
  const candidates: { x: number; z: number; yaw: number; w: number; d: number; dist: number; core: number }[] = [];
  const cols = Math.ceil((R * 1.2) / st.lot);
  for (let q = 34, row = 0; q < qPlaza + R * 1.2; q += rowPitch, row++) {
    for (let c = -cols; c <= cols; c++) {
      const street = Math.floor(c / st.streetEvery) * 6;
      const jit = st.irregularity;
      const s = c * st.lot + street + (rng() - 0.5) * jit * st.lot * 0.8 + (row % 2) * jit * st.lot * 0.5;
      const qq = q + (rng() - 0.5) * jit * rowPitch * 0.6;
      const p = at(s, qq);
      const dist = Math.hypot(p.x - P.x, p.z - P.z);
      if (dist > R * 1.15) continue;
      if (st.cityWalls && dist > Rw - 9) continue; // walled towns stay inside their ramparts
      const core = 1 - smooth(R * 0.45, R * 1.15, dist);
      const w = Math.min(range(rng, st.houseW[0], st.houseW[1]), st.lot - gap);
      const d = range(rng, st.houseD[0], st.houseD[1]);
      candidates.push({ x: p.x, z: p.z, yaw: yawSea + (rng() - 0.5) * jit * 0.9, w, d, dist, core });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  // narrow land (thin islands, spits): relax the on-land margins
  let deepest = 0;
  for (let x = -R; x <= R; x += 20) for (let z = -R; z <= R; z += 20) deepest = Math.min(deepest, site.sdf(P.x + x, P.z + z));
  const narrow = deepest > -70;
  const stilts = st.house === "shack";
  for (const h of candidates) {
    if (stats.houses >= maxHouses) break;
    if (rng() > st.density * (0.12 + 0.88 * h.core)) continue;
    if (stilts) {
      // pirate shacks may stand on stilts over the shallows
      if (site.sdf(h.x, h.z) > 16) continue;
    } else {
      if (!isLand(h.x, h.z, narrow ? 4 : 8)) continue;
      const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
      let onLand = true;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (!isLand(h.x + (u * h.w * c) / 2 + (v * h.d * s) / 2, h.z - (u * h.w * s) / 2 + (v * h.d * c) / 2, narrow ? 1 : 3)) onLand = false;
      }
      if (!onLand) continue;
    }
    const gs = groundSpan(site, h.x, h.z, h.w, h.d, h.yaw);
    if (gs.max - gs.min > 7) continue;
    if (!occ.free(h.x, h.z, h.w + gap * 0.5, h.d + 2, h.yaw)) continue;
    let floors = Math.round(range(rng, st.floors[0] - 0.49, st.floors[1] + 0.49));
    if (h.core > 0.8 && rng() < 0.35) floors = Math.min(floors + 1, st.floors[1] + 1);
    house(ctx, h.x, h.z, h.yaw, { w: h.w, d: h.d, floors });
    occ.mark(h.x, h.z, h.w + gap * 0.5, h.d + 2, h.yaw);
    stats.houses++;
  }

  // --- 7. trees --------------------------------------------------------------------------------------
  const nTrees = Math.round(st.treeCount * Math.sqrt(size));
  for (let i = 0; i < nTrees * 6 && stats.trees < nTrees; i++) {
    const a = rng() * Math.PI * 2;
    const r = R * (0.35 + 1.05 * Math.sqrt(rng()));
    const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
    if (!isLand(x, z, narrow ? 4 : 10) || !occ.free(x, z, 5, 5, 0)) continue;
    tree(ctx, treeKindAt(st.trees, input.lat, rng), x, z);
    occ.mark(x, z, 5, 5, 0);
    stats.trees++;
  }
  // a few palms along the beach either side of the quay
  if (treeKindAt(st.trees, input.lat, () => 0) === "palm") {
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      const a = at(side * (L / 2 + 10 + rng() * 120), 0);
      const p = project(a.x, a.z);
      if (!p) continue;
      const g = grad(p.x, p.z);
      const x = p.x - g.x * range(rng, 12, 30), z = p.z - g.z * range(rng, 12, 30);
      if (!isLand(x, z, narrow ? 3 : 8) || !occ.free(x, z, 4, 4, 0)) continue;
      tree(ctx, "palm", x, z);
      occ.mark(x, z, 4, 4, 0);
      stats.trees++;
    }
  }

  // --- 8. mooring at the dock (posts + a small float) ---------------------------------------------
  {
    const dx = input.dock.x, dz = input.dock.z;
    const yaw = Math.atan2(-dx, -dz);
    ctx.main.push(dx, 0, dz, yaw);
    ctx.main.box(0, WATER_Y - 0.6, 0, 5, 1.3, 14, pierDeck);
    ctx.main.pop();
    ctx.detail.push(dx, 0, dz, yaw);
    for (const [u, v] of [[-3.4, -6], [3.4, -6], [-3.4, 6], [3.4, 6]]) ctx.detail.prism(u, WATER_Y - 3, v, 0.5, 0.45, 5.5, 5, hex("#4a3624"));
    ctx.detail.pop();
  }

  const main = ctx.main.finish();
  const detail = ctx.detail.finish();
  const flags = ctx.flags.finish();
  stats.ms = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 10) / 10;
  const dockDist = Math.hypot(input.dock.x, input.dock.z);
  void pick;
  void ship;
  return {
    styleId: st.id,
    main,
    detail,
    flags,
    radius: Math.max(R * 1.4, dockDist + 40, 280),
    labelY: labelY + 22,
    stats,
  };
}
