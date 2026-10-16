// Port placement on the SDF (spec §5). For each real port:
//   1. dock  = nearest pixel centre (metric, from the real site) that is open water reachable from the
//              ocean (`ocean` mask) with 100 <= sdf <= 400.
//   2. town  = the real site if it is land (bilinear sdf in [-300,-10]) and <= 700 from the dock;
//              otherwise the land pixel (-200 <= sdf <= -20) nearest the real site that is <= 500
//              from the dock (rivers like the Guadalquivir and Thames are narrower than a pixel).
//   3. spawn = nearest ocean pixel to the dock with sdf >= 160.
import {
  W, H, PX, SDF_UNIT, latToZ, lonToX, metricDist, metricX, pixX, pixZ, sampleSdf, wrap,
} from "./common";
import type { PortDef } from "../portDefs";

export interface PlacedPort extends PortDef {
  x: number;
  z: number;
  dock: { x: number; z: number };
  spawn: { x: number; z: number };
  safeRadius: number;
  /** diagnostics only (not written to ports.json) */
  _townMoved: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Scan pixels within `radius` (metric) of (x,z); return the one minimising cost() among those
 *  passing ok(). Deterministic (row-major scan, strict <). */
function bestPixel(
  x: number,
  z: number,
  radius: number,
  ok: (idx: number, px: number, pz: number) => boolean,
  cost: (px: number, pz: number) => number,
): { idx: number; x: number; z: number } | null {
  const jc = Math.floor(z / PX);
  const rows = Math.ceil(radius / PX) + 1;
  let best: { idx: number; x: number; z: number } | null = null;
  let bestCost = Infinity;
  for (let j = Math.max(0, jc - rows); j <= Math.min(H - 1, jc + rows); j++) {
    const pz = pixZ(j);
    const cols = Math.min(W / 2, Math.ceil(radius / (PX * Math.max(0.05, metricX(pz)))) + 1);
    const ic = Math.floor(x / PX);
    for (let u = ic - cols; u <= ic + cols; u++) {
      const i = wrap(u, W);
      const px = pixX(i);
      if (metricDist(x, z, px, pz) > radius) continue;
      const idx = j * W + i;
      if (!ok(idx, px, pz)) continue;
      const c = cost(px, pz);
      if (c < bestCost) {
        bestCost = c;
        best = { idx, x: px, z: pz };
      }
    }
  }
  return best;
}

export function placePorts(defs: PortDef[], sdf: Int8Array, ocean: Uint8Array): PlacedPort[] {
  const q = (units: number) => units / SDF_UNIT;
  return defs.map((def) => {
    const rx = lonToX(def.lon);
    const rz = latToZ(def.lat);
    const dock = bestPixel(
      rx, rz, 6000,
      (idx) => ocean[idx] === 1 && sdf[idx] >= q(100) && sdf[idx] <= q(400),
      (px, pz) => metricDist(rx, rz, px, pz),
    );
    if (!dock) throw new Error(`port ${def.id}: no dock water within 6000 units`);

    // judge the real site by the same bilinear sample the runtime uses
    const realD = sampleSdf(sdf, rx, rz);
    let tx = rx;
    let tz = rz;
    if (!(realD <= -10 && realD >= -300 && metricDist(rx, rz, dock.x, dock.z) <= 700)) {
      const town = bestPixel(
        rx, rz, 6000,
        (idx, px, pz) =>
          sdf[idx] <= -q(20) && sdf[idx] >= -q(200) && metricDist(px, pz, dock.x, dock.z) <= 500,
        (px, pz) => metricDist(rx, rz, px, pz),
      );
      if (!town) throw new Error(`port ${def.id}: no town land near the dock`);
      tx = town.x;
      tz = town.z;
    }

    const spawn = bestPixel(
      dock.x, dock.z, 8000,
      (idx) => ocean[idx] === 1 && sdf[idx] >= q(160),
      (px, pz) => metricDist(dock.x, dock.z, px, pz),
    );
    if (!spawn) throw new Error(`port ${def.id}: no spawn water`);

    return {
      ...def,
      x: r1(tx),
      z: r1(tz),
      dock: { x: r1(dock.x), z: r1(dock.z) },
      spawn: { x: r1(spawn.x), z: r1(spawn.z) },
      safeRadius: 600,
      _townMoved: Math.round(metricDist(rx, rz, tx, tz)),
    };
  });
}

/**
 * Ocean-connectivity mask: 4-connected flood over pixels with sdf >= minUnits, from `seed`, x wraps,
 * rows beyond the ice lines (plus margin) excluded. Used so docks are never placed in a lake or a
 * pocket the lane graph cannot reach.
 */
export function oceanMask(
  sdf: Int8Array,
  minUnits: number,
  seedX: number,
  seedZ: number,
  jMin: number,
  jMax: number,
): Uint8Array {
  const m = new Uint8Array(W * H);
  const qmin = minUnits / SDF_UNIT;
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const s = Math.floor(seedZ / PX) * W + wrap(Math.floor(seedX / PX), W);
  if (sdf[s] < qmin) throw new Error("ocean seed is not open water");
  m[s] = 1;
  queue[tail++] = s;
  while (head < tail) {
    const idx = queue[head++];
    const j = (idx / W) | 0;
    const i = idx - j * W;
    const nb = [
      j * W + (i === 0 ? W - 1 : i - 1),
      j * W + (i === W - 1 ? 0 : i + 1),
      j > jMin ? idx - W : -1,
      j < jMax ? idx + W : -1,
    ];
    for (const n of nb) {
      if (n < 0 || m[n] || sdf[n] < qmin) continue;
      m[n] = 1;
      queue[tail++] = n;
    }
  }
  return m;
}
