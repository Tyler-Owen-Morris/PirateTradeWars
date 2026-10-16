/**
 * Polar ice (WORLD_SPEC §4.2, §7): an ice-shelf wall at each ice line plus pack ice beyond it.
 * THREE objects, no WebGL needed (unit-tested in `__tests__/terrain.test.ts`). React glue: Terrain.tsx.
 *
 * Why this is cheap: the ice lines are lines of constant z, so in render space each one is a
 * straight line parallel to x at rz = Z_ICE − F.z, and metricX is the same constant (cos 70°) along
 * it. So the wall is one rigid mesh, translated per frame; no per-vertex transform is needed.
 *
 * World anchoring: along the line, metric arc length is s = x·MX_ICE. The jagged profile and the
 * floe texture repeat with period ICE_PERIOD, which divides the line's circumference exactly
 * (WORLD_C·MX_ICE), so the pattern is continuous across the x wrap. Each frame the mesh is shifted
 * by −(s_F mod ICE_PERIOD) (float64), so local s = 0 is always a multiple of the period in the world:
 * the ice stays put as you sail along it.
 *
 * Geometry (north line; the south group is mirrored with scale.z = −1): the wall face is at local
 * z ∈ [−WALL_JAG, 0] (never on the water side of the physics ice line, so ships stopped by the
 * ice, at distance ≥ hullRadius, never overlap it), its top slopes back to z = −WALL_DEPTH, and the
 * pack-ice plane runs from there to z = −PACK_DEPTH.
 */
import * as THREE from "three";
import { WORLD_C, Z_ICE_N, Z_ICE_S, metricX, wrap } from "@shared/world/geo";
import { CAMERA_FAR } from "./renderSpace";
import { WATER_Y } from "./terrainHeight";

/** metricX at the ice lines (cos 70°; equal for both by symmetry). */
export const MX_ICE = metricX(Z_ICE_N);
/** Circumference of the ice line in metric units (≈ 136 808). */
export const ICE_CIRCUMFERENCE = WORLD_C * MX_ICE;
/** Pattern period along the line: ≈ 2000, dividing the circumference exactly. */
export const ICE_PERIOD = ICE_CIRCUMFERENCE / Math.round(ICE_CIRCUMFERENCE / 2000);
/** The wall mesh extends ± this along the line (whole periods, covers the camera range + 1 period). */
export const ICE_HALF_LENGTH = Math.ceil((CAMERA_FAR + 600) / ICE_PERIOD + 1) * ICE_PERIOD;
export const WALL_SEGMENT = 12;
export const WALL_JAG = 10;
export const WALL_DEPTH = 80;
export const PACK_DEPTH = 3500;
/** Floe texture repeats this many times per period. */
export const FLOE_REPEATS = 5;

const TAU = Math.PI * 2;

/** Periodic profile in [−1, 1] along the line (integer frequencies per ICE_PERIOD). */
export function iceProfile(s: number, seed: number): number {
  const p = (s / ICE_PERIOD) * TAU;
  return (
    0.45 * Math.sin(13 * p + seed) +
    0.3 * Math.sin(37 * p + 2.1 * seed) +
    0.17 * Math.sin(91 * p + 0.7 * seed) +
    0.08 * Math.sin(211 * p + 1.3 * seed)
  );
}

/** Local-x shift that anchors the pattern for a focus at world x `fx` (−(s_F mod period)). */
export function iceShift(fx: number): number {
  return -wrap(wrap(fx, WORLD_C) * MX_ICE, ICE_PERIOD);
}

function buildWallGeometry(): THREE.BufferGeometry {
  const n = Math.round((2 * ICE_HALF_LENGTH) / WALL_SEGMENT);
  const pos: number[] = [];
  const col: number[] = [];
  const cols: [number, number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const s = -ICE_HALF_LENGTH + k * WALL_SEGMENT;
    const top = WATER_Y + 26 + 12 * iceProfile(s, 1);
    const face = -WALL_JAG * (0.5 + 0.5 * iceProfile(s, 4)); // ≤ 0: into the ice
    cols.push([s, top, face]);
  }
  const push = (x: number, y: number, z: number, shade: number) => {
    pos.push(x, y, z);
    col.push(0.82 * shade, 0.9 * shade, 0.97 * shade);
  };
  for (let k = 0; k < n; k++) {
    const [s0, t0, f0] = cols[k];
    const [s1, t1, f1] = cols[k + 1];
    const b = WATER_Y - 20;
    // front face (two triangles), slightly blue at the waterline
    push(s0, b, f0, 0.8);
    push(s1, b, f1, 0.8);
    push(s0, t0, f0 - 3, 1);
    push(s0, t0, f0 - 3, 1);
    push(s1, b, f1, 0.8);
    push(s1, t1, f1 - 3, 1);
    // top, sloping back into the shelf
    const back0 = WATER_Y + 6 + 4 * iceProfile(s0, 9);
    const back1 = WATER_Y + 6 + 4 * iceProfile(s1, 9);
    push(s0, t0, f0 - 3, 1);
    push(s1, t1, f1 - 3, 1);
    push(s0, back0, -WALL_DEPTH, 0.97);
    push(s0, back0, -WALL_DEPTH, 0.97);
    push(s1, t1, f1 - 3, 1);
    push(s1, back1, -WALL_DEPTH, 0.97);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); // non-indexed → faceted, icy look
  return g;
}

/** Voronoi floe texture (tileable): white floes, blue-grey cracks. */
export function buildFloeTexture(size = 256, cells = 7, seed = 3): THREE.DataTexture {
  const pts: [number, number][] = [];
  let h = seed * 9973;
  const rnd = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) | 0;
    return ((h >>> 0) % 100000) / 100000;
  };
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rnd()) / cells, (j + rnd()) / cells]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let d1 = 9;
      let d2 = 9;
      let id = 0;
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          const i = ci + oi;
          const j = cj + oj;
          const wi = ((i % cells) + cells) % cells;
          const wj = ((j % cells) + cells) % cells;
          const k = wj * cells + wi;
          // feature point of the wrapped cell, shifted into this neighbour's position (tileable)
          const dx = pts[k][0] + (i - wi) / cells - u;
          const dy = pts[k][1] + (j - wj) / cells - v;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = k;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // 0 on cracks
      const crack = Math.min(1, edge * cells * 6);
      const tint = 0.9 + 0.1 * ((id * 37) % 10) / 10;
      const o = (y * size + x) * 4;
      data[o] = Math.round((60 + (230 * tint - 60) * crack) * 1);
      data[o + 1] = Math.round(90 + (240 * tint - 90) * crack);
      data[o + 2] = Math.round(120 + (250 - 120) * crack);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildPackGeometry(): THREE.BufferGeometry {
  const len = 2 * ICE_HALF_LENGTH;
  const g = new THREE.PlaneGeometry(len, PACK_DEPTH - WALL_DEPTH + 20, 1, 1);
  g.rotateX(-Math.PI / 2); // plane in xz, +y normal; local z ∈ [−d/2, d/2]
  g.translate(0, WATER_Y + 4, -(WALL_DEPTH - 20) - (PACK_DEPTH - WALL_DEPTH + 20) / 2);
  // UVs anchored to local coordinates: FLOE_REPEATS tiles per ICE_PERIOD in both directions
  const tile = ICE_PERIOD / FLOE_REPEATS;
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  uv.needsUpdate = true;
  return g;
}

export class PolarIce {
  readonly group = new THREE.Group();
  readonly north = new THREE.Group();
  readonly south = new THREE.Group();
  private readonly wallGeom = buildWallGeometry();
  private readonly packGeom = buildPackGeometry();
  private readonly floe = buildFloeTexture();
  private readonly wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private readonly packMat = new THREE.MeshLambertMaterial({ map: this.floe, side: THREE.DoubleSide });

  constructor() {
    this.group.name = "PolarIce";
    for (const g of [this.north, this.south]) {
      const wall = new THREE.Mesh(this.wallGeom, this.wallMat);
      const pack = new THREE.Mesh(this.packGeom, this.packMat);
      wall.frustumCulled = false; // the line spans the view; cheaper than bounds churn
      pack.frustumCulled = false;
      g.add(wall, pack);
      this.group.add(g);
    }
    this.south.scale.z = -1; // the southern shelf faces north
  }

  /** Place both shelves for focus (fx, fz) (raw world coords). */
  update(fx: number, fz: number): void {
    const shift = iceShift(fx);
    const range = CAMERA_FAR + PACK_DEPTH;
    const rzN = Z_ICE_N - fz;
    const rzS = Z_ICE_S - fz;
    this.north.visible = Math.abs(rzN) < range;
    this.south.visible = Math.abs(rzS) < range;
    this.north.position.set(shift, 0, rzN);
    // mirrored: local x is unchanged, so the same shift anchors it
    this.south.position.set(shift, 0, rzS);
  }

  dispose(): void {
    this.wallGeom.dispose();
    this.packGeom.dispose();
    this.floe.dispose();
    this.wallMat.dispose();
    this.packMat.dispose();
  }
}
