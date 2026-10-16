// Sea lanes (spec §6): shortest metric paths on a coarse water grid, then string-pulled.
//
// Grid: 2x2 SDF pixels per cell (4096 x 2048 cells, ~97.7 units). A cell's clearance is the MIN of
// its 4 pixel SDF values. A cell is passable when clearance >= LANE_CLEARANCE (100), or >= DOCK_CLEARANCE
// (80) within DOCK_RELAX_R of any port's dock (harbour approaches are narrower than open-sea lanes),
// and it is at least LANE_CLEARANCE from the ice lines. x wraps. 8-connected, metric step costs.
import {
  W, H, PX, WORLD_C, SDF_UNIT, Z_ICE_N, Z_ICE_S, metricDist, metricX, sampleSdf, wrap, wrappedDelta,
} from "./common";
import type { PlacedPort } from "./ports";

export const LANE_CLEARANCE = 100;
export const DOCK_CLEARANCE = 80;
export const DOCK_RELAX_R = 2500;
const GW = W / 2;
const GH = H / 2;
const CELL = PX * 2;
const MAX_SEG = 4000; // max metric segment length so steering along a segment stays near the line

export interface Lane {
  from: string;
  to: string;
  points: [number, number][];
}

const cellX = (ci: number) => (ci + 0.5) * CELL;
const cellZ = (cj: number) => (cj + 0.5) * CELL;
const cellOf = (x: number, z: number) =>
  Math.min(GH - 1, Math.max(0, Math.floor(z / CELL))) * GW + wrap(Math.floor(x / CELL), GW);

export class LaneGrid {
  pass: Uint8Array;
  private g: Float64Array;
  private from: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private epoch = 0;
  private cosRow: Float64Array;
  // binary heap
  private hk = new Float64Array(1 << 20);
  private hv = new Int32Array(1 << 20);
  private hn = 0;

  constructor(private sdf: Int8Array, private docks: { x: number; z: number }[]) {
    this.pass = new Uint8Array(GW * GH);
    this.g = new Float64Array(GW * GH);
    this.from = new Int32Array(GW * GH);
    this.stamp = new Int32Array(GW * GH);
    this.closed = new Int32Array(GW * GH);
    this.cosRow = new Float64Array(GH);
    for (let cj = 0; cj < GH; cj++) this.cosRow[cj] = metricX(cellZ(cj));
    const qLane = LANE_CLEARANCE / SDF_UNIT;
    const qDock = DOCK_CLEARANCE / SDF_UNIT;
    for (let cj = 0; cj < GH; cj++) {
      const z = cellZ(cj);
      if (z - Z_ICE_N < LANE_CLEARANCE || Z_ICE_S - z < LANE_CLEARANCE) continue;
      for (let ci = 0; ci < GW; ci++) {
        const a = (2 * cj) * W + 2 * ci;
        const v = Math.min(sdf[a], sdf[a + 1], sdf[a + W], sdf[a + W + 1]);
        if (v >= qLane) this.pass[cj * GW + ci] = 1;
        else if (v >= qDock && this.nearDock(cellX(ci), z)) this.pass[cj * GW + ci] = 1;
      }
    }
  }

  private nearDock(x: number, z: number) {
    for (const d of this.docks) if (metricDist(x, z, d.x, d.z) <= DOCK_RELAX_R) return true;
    return false;
  }

  /** Required clearance at a point (used when validating simplified segments). */
  clearanceAt(x: number, z: number) {
    return this.nearDock(x, z) ? DOCK_CLEARANCE : LANE_CLEARANCE;
  }

  private push(k: number, v: number) {
    if (this.hn === this.hk.length) {
      const nk = new Float64Array(this.hk.length * 2);
      nk.set(this.hk);
      const nv = new Int32Array(this.hv.length * 2);
      nv.set(this.hv);
      this.hk = nk;
      this.hv = nv;
    }
    let i = this.hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.hk[p] < k || (this.hk[p] === k && this.hv[p] <= v)) break;
      this.hk[i] = this.hk[p];
      this.hv[i] = this.hv[p];
      i = p;
    }
    this.hk[i] = k;
    this.hv[i] = v;
  }

  private pop(): number {
    const top = this.hv[0];
    const k = this.hk[--this.hn];
    const v = this.hv[this.hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.hn) break;
      let c = l;
      const r = l + 1;
      if (r < this.hn && (this.hk[r] < this.hk[l] || (this.hk[r] === this.hk[l] && this.hv[r] < this.hv[l]))) c = r;
      if (this.hk[c] > k || (this.hk[c] === k && this.hv[c] >= v)) break;
      this.hk[i] = this.hk[c];
      this.hv[i] = this.hv[c];
      i = c;
    }
    this.hk[i] = k;
    this.hv[i] = v;
    return top;
  }

  /** Nearest passable cell to a point (small spiral search). */
  snap(x: number, z: number): number {
    const c0 = cellOf(x, z);
    if (this.pass[c0]) return c0;
    const cj0 = Math.floor(c0 / GW);
    const ci0 = c0 - cj0 * GW;
    let best = -1;
    let bd = Infinity;
    for (let dj = -6; dj <= 6; dj++) {
      for (let di = -12; di <= 12; di++) {
        const cj = cj0 + dj;
        if (cj < 0 || cj >= GH) continue;
        const c = cj * GW + wrap(ci0 + di, GW);
        if (!this.pass[c]) continue;
        const d = metricDist(x, z, cellX(c % GW), cellZ(cj));
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    if (best < 0) throw new Error(`no passable lane cell near ${x},${z}`);
    return best;
  }

  /**
   * Dijkstra / A* from `src`. If `goal` >= 0, A* toward it (heuristic: straight metric distance at
   * the more poleward endpoint's scale, scaled by 0.95). Otherwise Dijkstra that stops once `wantK`
   * of `targets` are settled. Returns settled targets in order with their costs.
   */
  search(src: number, targets: Map<number, number>, wantK: number, goal = -1): { cell: number; cost: number }[] {
    this.epoch++;
    this.hn = 0;
    const ep = this.epoch;
    this.g[src] = 0;
    this.stamp[src] = ep;
    this.from[src] = -1;
    let gx = 0;
    let gz = 0;
    let hcos = 1;
    if (goal >= 0) {
      gx = cellX(goal % GW);
      gz = cellZ(Math.floor(goal / GW));
      hcos = 0.95 * Math.min(metricX(gz), metricX(cellZ(Math.floor(src / GW))));
    }
    const h = (c: number) => {
      if (goal < 0) return 0;
      const dx = wrappedDelta(cellX(c % GW), gx, WORLD_C) * hcos;
      const dz = gz - cellZ(Math.floor(c / GW));
      return 0.95 * Math.sqrt(dx * dx + dz * dz);
    };
    this.push(h(src), src);
    const found: { cell: number; cost: number }[] = [];
    while (this.hn > 0) {
      const c = this.pop();
      if (this.closed[c] === ep) continue;
      this.closed[c] = ep;
      const gc = this.g[c];
      if (targets.has(c)) {
        found.push({ cell: c, cost: gc });
        if (found.length >= wantK || c === goal) break;
      }
      const cj = Math.floor(c / GW);
      const ci = c - cj * GW;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= GH) continue;
        const cs = (this.cosRow[cj] + this.cosRow[nj]) / 2;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const n = nj * GW + wrap(ci + di, GW);
          if (!this.pass[n] || this.closed[n] === ep) continue;
          const dx = di * CELL * cs;
          const dz = dj * CELL;
          const ng = gc + Math.sqrt(dx * dx + dz * dz);
          if (this.stamp[n] !== ep || ng < this.g[n]) {
            this.stamp[n] = ep;
            this.g[n] = ng;
            this.from[n] = c;
            this.push(ng + h(n), n);
          }
        }
      }
    }
    return found;
  }

  /** Path (cells, src..dst) from the last search. */
  path(dst: number): number[] {
    const out: number[] = [];
    for (let c = dst; c >= 0; c = this.from[c]) out.push(c);
    return out.reverse();
  }

  /** Converts a cell path to unwrapped [x,z] points from dock `a` to dock `b`, simplified. */
  toLane(from: PlacedPort, to: PlacedPort, cells: number[]): Lane {
    const raw: [number, number][] = [[from.dock.x, from.dock.z]];
    for (const c of cells) raw.push([cellX(c % GW), cellZ(Math.floor(c / GW))]);
    raw.push([to.dock.x, to.dock.z]);
    // unwrap x
    for (let k = 1; k < raw.length; k++) {
      raw[k][0] = raw[k - 1][0] + wrappedDelta(raw[k - 1][0], raw[k][0], WORLD_C);
    }
    const pulled = this.stringPull(raw);
    const pts = subdivide(pulled).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as [number, number]);
    return { from: from.id, to: to.id, points: pts };
  }

  /** True if the straight segment a->b keeps the required clearance (bilinear samples every 20 units). */
  segmentClear(a: [number, number], b: [number, number]): boolean {
    const len = metricDist(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.ceil(len / 20));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const x = wrap(a[0] + (b[0] - a[0]) * t, WORLD_C);
      const z = a[1] + (b[1] - a[1]) * t;
      if (z - Z_ICE_N < LANE_CLEARANCE || Z_ICE_S - z < LANE_CLEARANCE) return false;
      // grid cells guarantee min-of-pixels; for segments allow the bilinear field a 10-unit margin
      if (sampleSdf(this.sdf, x, z) < this.clearanceAt(x, z) - 10) return false;
    }
    return true;
  }

  /**
   * Greedy line-of-sight string pulling (Theta*-style post-process): from each anchor, jump to the
   * farthest following path point whose straight segment keeps clearance (stop at the first
   * blocked one). Turns the octilinear grid staircase into any-angle straight legs.
   */
  private stringPull(p: [number, number][]): [number, number][] {
    const out: [number, number][] = [p[0]];
    let a = 0;
    while (a < p.length - 1) {
      let best = a + 1;
      for (let k = a + 2; k < p.length; k++) {
        if (this.segmentClear(p[a], p[k])) best = k;
        else break;
      }
      out.push(p[best]);
      a = best;
    }
    return out;
  }
}

/** Splits legs longer than MAX_SEG (metric) into equal pieces on the same straight line, so an NPC
 *  steering point-to-point never strays far from the clearance-checked segment. */
function subdivide(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [p[0]];
  for (let k = 1; k < p.length; k++) {
    const [ax, az] = p[k - 1];
    const [bx, bz] = p[k];
    const len = metricDist(wrap(ax, WORLD_C), az, wrap(bx, WORLD_C), bz);
    const n = Math.ceil(len / MAX_SEG);
    for (let s = 1; s < n; s++) out.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    out.push(p[k]);
  }
  return out;
}

export { cellOf };
