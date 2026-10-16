/**
 * NPC2: local path planning around land (pure; no World access).
 *
 * Lanes (shared/world/lanes.json) are clear of land, so an NPC on its lane just steers along it.
 * After a chase or a flight it can end up far off the lane with land in between (the Bahamas
 * banks, a bay, the far side of an island) where steering alone loops forever. `planPath` runs a
 * bounded 8-connected A* over a local metric grid (cell CELL units, at most MAX_CELLS cells) on the
 * SDF and returns a short list of waypoints (line-of-sight simplified). Cost is ~0.2–2 ms per plan;
 * the NPC system caps plans per tick.
 */
import type { NpcMetric } from "./metric";
import type { LandQuery } from "./steering";

/** Grid cell size, metric units. */
export const NAV_CELL = 80;
/** Largest grid (cells per side) — bounds the cost of one plan. */
export const NAV_MAX_SIDE = 160;
/** Extra margin around the start/goal bounding box, metric units. */
export const NAV_MARGIN = 2000;
/** Cost caps: A* node expansions per plan, and how many cells one simplified leg may span. */
export const NAV_MAX_EXPANSIONS = 12_000;
export const NAV_SIMPLIFY_SPAN = 40;

export interface NavPoint {
  x: number;
  z: number;
}

/** True if the straight metric segment a→b keeps at least `clearance` from land (sampled). */
export function segmentClear(
  land: LandQuery,
  m: NpcMetric,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  clearance: number,
  sample = 40,
): boolean {
  const d = m.delta(ax, az, bx, bz);
  const len = Math.hypot(d.dx, d.dz);
  const n = Math.max(1, Math.ceil(len / sample));
  const pt = { x: 0, z: 0 };
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    m.offset(ax, az, d.dx * f, d.dz * f, pt);
    if (land.distance(pt.x, pt.z) < clearance) return false;
  }
  return true;
}

/** Binary min-heap of cell indices keyed by f-score. */
class Heap {
  private idx: number[] = [];
  private key: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(i: number, k: number): void {
    const a = this.idx;
    const b = this.key;
    a.push(i);
    b.push(k);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (b[p] <= b[c]) break;
      [a[p], a[c]] = [a[c], a[p]];
      [b[p], b[c]] = [b[c], b[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.idx;
    const b = this.key;
    const top = a[0];
    const li = a.pop()!;
    const lk = b.pop()!;
    if (a.length > 0) {
      a[0] = li;
      b[0] = lk;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let s = c;
        if (l < a.length && b[l] < b[s]) s = l;
        if (r < a.length && b[r] < b[s]) s = r;
        if (s === c) break;
        [a[s], a[c]] = [a[c], a[s]];
        [b[s], b[c]] = [b[c], b[s]];
        c = s;
      }
    }
    return top;
  }
}

/**
 * A* from `from` to `to` keeping `clearance` from land. The grid is a local metric frame anchored
 * at the box's corner (x offsets go through `m.offset`, so it wraps and scales with latitude).
 * Returns waypoints (excluding `from`, ending at `to` or the reachable cell nearest it), or null if
 * nothing better than the start is reachable inside the window.
 */
export function planPath(land: LandQuery, m: NpcMetric, from: NavPoint, to: NavPoint, clearance: number): NavPoint[] | null {
  const g = m.delta(from.x, from.z, to.x, to.z);
  // Local frame: origin = `from`; box covers both points plus a margin, capped in size.
  let minX = Math.min(0, g.dx) - NAV_MARGIN;
  let maxX = Math.max(0, g.dx) + NAV_MARGIN;
  let minZ = Math.min(0, g.dz) - NAV_MARGIN;
  let maxZ = Math.max(0, g.dz) + NAV_MARGIN;
  const span = NAV_MAX_SIDE * NAV_CELL;
  if (maxX - minX > span) {
    const c = g.dx / 2;
    minX = c - span / 2;
    maxX = c + span / 2;
  }
  if (maxZ - minZ > span) {
    const c = g.dz / 2;
    minZ = c - span / 2;
    maxZ = c + span / 2;
  }
  const W = Math.ceil((maxX - minX) / NAV_CELL);
  const H = Math.ceil((maxZ - minZ) / NAV_CELL);
  const N = W * H;
  const pos = { x: 0, z: 0 };
  const cellCenter = (i: number, j: number) => m.offset(from.x, from.z, minX + (i + 0.5) * NAV_CELL, minZ + (j + 0.5) * NAV_CELL, pos);
  const cellOf = (dx: number, dz: number) => {
    const i = Math.floor((dx - minX) / NAV_CELL);
    const j = Math.floor((dz - minZ) / NAV_CELL);
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  const start = cellOf(0, 0);
  let goal = cellOf(g.dx, g.dz);
  if (start < 0) return null;
  // 0 = unknown, 1 = water, 2 = blocked
  const pass = new Uint8Array(N);
  const passable = (c: number) => {
    let v = pass[c];
    if (v === 0) {
      const p = cellCenter(c % W, (c / W) | 0);
      v = land.distance(p.x, p.z) >= clearance ? 1 : 2;
      pass[c] = v;
    }
    return v === 1;
  };
  pass[start] = 1; // we are here
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gi = goal >= 0 ? goal % W : 0;
  const gj = goal >= 0 ? (goal / W) | 0 : 0;
  const tgx = goal >= 0 ? gi : Math.floor((g.dx - minX) / NAV_CELL);
  const tgz = goal >= 0 ? gj : Math.floor((g.dz - minZ) / NAV_CELL);
  const h = (c: number) => {
    const dx = Math.abs((c % W) - tgx);
    const dz = Math.abs(((c / W) | 0) - tgz);
    return (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz)) * NAV_CELL;
  };
  const heap = new Heap();
  gScore[start] = 0;
  heap.push(start, h(start));
  let best = start;
  let bestH = h(start);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1];
  const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let expanded = 0;
  while (heap.size > 0 && expanded++ < NAV_MAX_EXPANSIONS) {
    const c = heap.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) {
      best = c;
      break;
    }
    const hc = h(c);
    if (hc < bestH) {
      bestH = hc;
      best = c;
    }
    const ci = c % W;
    const cj = (c / W) | 0;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DI[k];
      const nj = cj + DJ[k];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (closed[n] || !passable(n)) continue;
      // no corner cutting on diagonals
      if (k >= 4 && (!passable(cj * W + ni) || !passable(nj * W + ci))) continue;
      const ng = gScore[c] + (k >= 4 ? 1.4142 : 1) * NAV_CELL;
      if (ng < gScore[n]) {
        gScore[n] = ng;
        came[n] = c;
        heap.push(n, ng + h(n));
      }
    }
  }
  if (best === start) return null;
  // Reconstruct, then keep only the cells where line of sight breaks.
  const cells: number[] = [];
  for (let c = best; c !== -1 && c !== start; c = came[c]) cells.push(c);
  cells.reverse();
  const pts: NavPoint[] = cells.map((c) => {
    const p = cellCenter(c % W, (c / W) | 0);
    return { x: p.x, z: p.z };
  });
  if (best === goal) pts[pts.length - 1] = { x: to.x, z: to.z };
  const out: NavPoint[] = [];
  let ax = from.x;
  let az = from.z;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && j - i < NAV_SIMPLIFY_SPAN && segmentClear(land, m, ax, az, pts[j + 1].x, pts[j + 1].z, clearance)) j++;
    out.push(pts[j]);
    ax = pts[j].x;
    az = pts[j].z;
    i = j + 1;
  }
  return out;
}
