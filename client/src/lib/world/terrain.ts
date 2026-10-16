/**
 * Land terrain chunks (WORLD_SPEC §4, §7). Builds heightfield meshes from the land SDF around the
 * camera focus and draws them in floating-origin render space. Uses THREE for geometry/materials but
 * no WebGL, so it is unit-tested in node (`__tests__/terrain.test.ts`). React glue: `Terrain.tsx`.
 *
 * Chunks
 * - A chunk is CHUNK_PX × CHUNK_PX SDF pixels (16 px = 781.25 coordinate units), so it lies inside a
 *   single 256-px tile. Key = cz * CHUNKS_X + cx.
 * - Geometry is in chunk-local COORDINATE units: position = (x − x0, y, z − z0). The vertex shader
 *   turns it into render space with per-chunk uniforms computed in float64 on the CPU:
 *       uOrigin = (wrappedDelta(F.x, x0, C), z0 − F.z),  uChunkZ0 = z0
 *       rx = (uOrigin.x + local.x) * metricX(z0 + local.z),  rz = uOrigin.y + local.z
 *   i.e. exactly renderSpace.toRender per vertex (metricX per vertex), with small float32 values.
 * - Height/colour from `terrainHeight.ts`; normals from a one-pixel-wider height grid in metric
 *   units (seamless across chunks); a skirt hangs from every edge to hide LOD cracks.
 * - LOD by metric distance from the focus: LOD_STEPS vertices per side (33 / 17 / 9).
 * - Chunks in all-water tiles are never built (manifest `allWater`, or every SDF sample > SKIP_SDF).
 *   Chunks whose tiles are still loading are built as water-for-now and rebuilt once
 *   `field.ready()` turns true (clientLand.version changes).
 * - Only chunks within VIEW_DISTANCE (metric) are kept; beyond VIEW_DISTANCE + DISPOSE_MARGIN they
 *   are disposed. Builds are time-sliced: `update(…, budgetMs)` builds nearest-first until the
 *   budget is spent (default 1 ms), always at least one per call.
 * - Terrain is drawn only between the ice lines (± a margin); the polar ice is `ice.ts`.
 */
import * as THREE from "three";
import { WORLD_C, WORLD_H, Z_ICE_N, Z_ICE_S, metricX, wrappedDelta } from "@shared/world/geo";
import { PX, SDF_W, SDF_H, TILE, type LandField, type TileSource } from "@shared/world/land";
import { CAMERA_FAR } from "./renderSpace";
import { WATER_Y, fbm, terrainColor, terrainHeight } from "./terrainHeight";

export const CHUNK_PX = 16;
/** Chunk edge in coordinate units (781.25). */
export const CHUNK = CHUNK_PX * PX;
export const CHUNKS_X = SDF_W / CHUNK_PX; // 512
export const CHUNKS_Z = SDF_H / CHUNK_PX; // 256
/** Vertices per chunk side for each LOD level. */
export const LOD_STEPS = [33, 17, 9] as const;
/** Metric distance (focus → nearest chunk point) below which each LOD is used. */
export const LOD_DISTANCES = [900, 1900, Infinity] as const;
/** Chunks are kept within this metric distance of the focus. */
export const VIEW_DISTANCE = CAMERA_FAR + 300;
export const DISPOSE_MARGIN = 600;
/** A chunk whose every SDF sample is above this (metric, water) has nothing visible: skipped. */
export const SKIP_SDF = 60;
/** Skirt depth below each edge vertex. */
export const SKIRT_DEPTH = 40;
/** No terrain chunks further than this beyond the ice lines (the ice covers them). */
export const ICE_TERRAIN_MARGIN = 1500;
/** Default per-frame build budget (ms). */
export const DEFAULT_BUDGET_MS = 1.0;

export interface ChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array | Uint16Array;
  /** Smallest SDF sample in the chunk (metric). > SKIP_SDF means all water. */
  minSdf: number;
}

/** Tile (or undefined) that contains chunk (cx, cz). */
function chunkTile(source: TileSource, cx: number, cz: number) {
  const per = TILE / CHUNK_PX;
  return source.get(Math.floor(cx / per), Math.floor(cz / per));
}

/**
 * Build a chunk's geometry arrays (local coordinate units). `n` = vertices per side.
 * Pure apart from reading `field`; returns null if the whole chunk is open water.
 */
export function buildChunkData(field: LandField, cx: number, cz: number, n: number): ChunkGeometryData | null {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const step = CHUNK / (n - 1);
  const g = n + 2; // height grid with a one-vertex ring for normals
  const heights = new Float32Array(g * g);
  const sdfs = new Float32Array(g * g);
  const hills = new Float32Array(g * g);
  let minSdf = Infinity;
  for (let j = 0; j < g; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < g; i++) {
      const x = x0 + (i - 1) * step;
      const d = field.sdf(x, z);
      const k = j * g + i;
      sdfs[k] = d;
      if (i > 0 && j > 0 && i <= n && j <= n && d < minSdf) minSdf = d;
    }
  }
  if (minSdf > SKIP_SDF) return null;
  for (let j = 0; j < g; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < g; i++) {
      const k = j * g + i;
      const d = sdfs[k];
      // hills only matter inland; skip the noise on the water side
      const hill = d < -60 ? fbm(x0 + (i - 1) * step, z) : 0;
      hills[k] = hill;
      heights[k] = terrainHeight(d, x0 + (i - 1) * step, z, hill);
    }
  }

  const edgeVerts = 4 * n;
  const vcount = n * n + edgeVerts;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  for (let j = 0; j < n; j++) {
    const lz = j * step;
    const mx = metricX(z0 + lz);
    const dxm = 2 * step * mx;
    const dzm = 2 * step;
    for (let i = 0; i < n; i++) {
      const k = (j + 1) * g + (i + 1);
      const v = j * n + i;
      const h = heights[k];
      positions[v * 3] = i * step;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = lz;
      const gx = (heights[k + 1] - heights[k - 1]) / dxm;
      const gz = (heights[k + g] - heights[k - g]) / dzm;
      const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      normals[v * 3] = -gx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -gz * inv;
      const slope = Math.sqrt(gx * gx + gz * gz);
      // forest mask: separate noise channel (cheap: reuse hill noise of a shifted lattice)
      const forest = sdfs[k] < -40 ? fbm(x0 + i * step + 5000, z0 + lz, 7) : 0;
      terrainColor(sdfs[k], h - WATER_Y, slope, forest, colors, v * 3);
    }
  }
  // skirts: edges in order top (j=0), bottom (j=n-1), left (i=0), right (i=n-1)
  const edgeIndex = (e: number, t: number): number => {
    if (e === 0) return t; // j = 0, i = t
    if (e === 1) return (n - 1) * n + t; // j = n-1
    if (e === 2) return t * n; // i = 0, j = t
    return t * n + (n - 1); // i = n-1
  };
  let s = n * n;
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < n; t++, s++) {
      const src = edgeIndex(e, t);
      positions[s * 3] = positions[src * 3];
      positions[s * 3 + 1] = positions[src * 3 + 1] - SKIRT_DEPTH;
      positions[s * 3 + 2] = positions[src * 3 + 2];
      normals[s * 3] = normals[src * 3];
      normals[s * 3 + 1] = normals[src * 3 + 1];
      normals[s * 3 + 2] = normals[src * 3 + 2];
      colors[s * 3] = colors[src * 3];
      colors[s * 3 + 1] = colors[src * 3 + 1];
      colors[s * 3 + 2] = colors[src * 3 + 2];
    }
  }

  const tris = (n - 1) * (n - 1) * 2 + 4 * (n - 1) * 2;
  const indices = vcount > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + n;
      const c = a + 1;
      const d = b + 1;
      indices[o++] = a;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = d;
    }
  }
  for (let e = 0; e < 4; e++) {
    const base = n * n + e * n;
    for (let t = 0; t < n - 1; t++) {
      const a = edgeIndex(e, t);
      const b = edgeIndex(e, t + 1);
      const sa = base + t;
      const sb = base + t + 1;
      indices[o++] = a;
      indices[o++] = b;
      indices[o++] = sa;
      indices[o++] = sa;
      indices[o++] = b;
      indices[o++] = sb;
    }
  }
  return { positions, normals, colors, indices, minSdf };
}

// ---------------------------------------------------------------------------------------------
// Material: render-space transform in the vertex shader (WORLD_SPEC §7)
// ---------------------------------------------------------------------------------------------

/** GLSL that maps chunk-local coordinates to render space; must match renderSpace.toRender. */
export const RENDER_TRANSFORM_GLSL = /* glsl */ `
uniform vec2 uOrigin;
uniform float uChunkZ0;
uniform float uWorldH;
vec3 toRenderSpace(vec3 local) {
  float zAbs = uChunkZ0 + local.z;
  float mx = max(sin(zAbs * 3.141592653589793 / uWorldH), 0.01);
  return vec3((uOrigin.x + local.x) * mx, local.y, uOrigin.y + local.z);
}
`;

const SUN_DIR = new THREE.Vector3(50, 100, 50).normalize();

export function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "TerrainChunk",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOrigin: { value: new THREE.Vector2() },
        uChunkZ0: { value: 0 },
        uWorldH: { value: WORLD_H },
        uSunDir: { value: SUN_DIR.clone() },
        uSunColor: { value: new THREE.Color(0.8, 0.78, 0.72) },
        uAmbient: { value: new THREE.Color(0.42, 0.45, 0.5) },
      },
    ]),
    vertexShader: /* glsl */ `
      ${RENDER_TRANSFORM_GLSL}
      attribute vec3 aColor;
      varying vec3 vColor;
      varying vec3 vNormal;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = toRenderSpace(position);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vColor = aColor;
        vNormal = normal;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uAmbient;
      varying vec3 vColor;
      varying vec3 vNormal;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize(vNormal);
        float diff = max(dot(n, uSunDir), 0.0);
        vec3 base = pow(vColor, vec3(2.2)); // sRGB vertex colours -> linear
        gl_FragColor = vec4(base * (uAmbient + uSunColor * diff), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Chunk manager
// ---------------------------------------------------------------------------------------------

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh | null;
  material: THREE.ShaderMaterial | null;
  /** All tiles under the chunk were loaded when it was built. */
  complete: boolean;
  /** Land version it was built at. */
  builtVersion: number;
}

export interface TerrainStats {
  chunks: number;
  meshes: number;
  builtThisFrame: number;
  queued: number;
  lastUpdateMs: number;
}

export class TerrainManager {
  readonly group = new THREE.Group();
  readonly stats: TerrainStats = { chunks: 0, meshes: 0, builtThisFrame: 0, queued: 0, lastUpdateMs: 0 };
  private readonly chunks = new Map<number, Chunk>();
  private readonly baseMaterial = createTerrainMaterial();
  private readonly queue: { key: number; cx: number; cz: number; lod: number; dist: number }[] = [];

  constructor(
    private readonly field: LandField,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.group.name = "Terrain";
  }

  /** Metric distance from (fx, fz) to the nearest point of chunk (cx, cz). */
  static chunkDistance(fx: number, fz: number, cx: number, cz: number): number {
    const z0 = cz * CHUNK;
    const z1 = z0 + CHUNK;
    const dz = fz < z0 ? z0 - fz : fz > z1 ? fz - z1 : 0;
    const zn = fz < z0 ? z0 : fz > z1 ? z1 : fz;
    const x0 = cx * CHUNK;
    const a = wrappedDelta(fx, x0, WORLD_C);
    const b = a + CHUNK;
    const dxc = a > 0 ? a : b < 0 ? -b : 0;
    return Math.hypot(dxc * metricX(zn), dz);
  }

  /**
   * Per frame: choose chunks around the focus (raw world coords), build nearest-first within
   * `budgetMs`, dispose far ones, and update every mesh's render-space uniforms.
   * `version` = land tile version (clientLand.version); a change triggers rebuilds of incomplete chunks.
   */
  update(fx: number, fz: number, version: number, budgetMs = DEFAULT_BUDGET_MS): void {
    const t0 = this.now();
    const czMin = Math.max(0, Math.floor((Math.max(fz - VIEW_DISTANCE, Z_ICE_N - ICE_TERRAIN_MARGIN)) / CHUNK));
    const czMax = Math.min(CHUNKS_Z - 1, Math.floor((Math.min(fz + VIEW_DISTANCE, Z_ICE_S + ICE_TERRAIN_MARGIN)) / CHUNK));
    const fcx = Math.floor(fx / CHUNK);
    this.queue.length = 0;
    const wanted = new Set<number>();
    for (let cz = czMin; cz <= czMax; cz++) {
      const z0 = cz * CHUNK;
      const mx = Math.min(metricX(z0), metricX(z0 + CHUNK));
      const span = Math.ceil(VIEW_DISTANCE / mx / CHUNK) + 1;
      for (let k = -span; k <= span; k++) {
        const cx = (((fcx + k) % CHUNKS_X) + CHUNKS_X) % CHUNKS_X;
        const dist = TerrainManager.chunkDistance(fx, fz, cx, cz);
        if (dist > VIEW_DISTANCE) continue;
        const key = cz * CHUNKS_X + cx;
        if (wanted.has(key)) continue; // tiny spans can wrap onto themselves
        wanted.add(key);
        const lod = dist < LOD_DISTANCES[0] ? 0 : dist < LOD_DISTANCES[1] ? 1 : 2;
        const c = this.chunks.get(key);
        const stale = !c || (c.mesh && c.lod !== lod) || (!c.complete && c.builtVersion !== version);
        if (stale) this.queue.push({ key, cx, cz, lod, dist });
      }
    }

    // build nearest first, within budget (at least one)
    this.queue.sort((a, b) => a.dist - b.dist);
    let built = 0;
    for (const q of this.queue) {
      if (built > 0 && this.now() - t0 >= budgetMs) break;
      this.build(q.key, q.cx, q.cz, q.lod, version);
      built++;
    }

    // dispose far chunks
    this.chunks.forEach((c, key) => {
      if (wanted.has(key)) return;
      if (TerrainManager.chunkDistance(fx, fz, c.cx, c.cz) > VIEW_DISTANCE + DISPOSE_MARGIN) this.dispose(key, c);
    });

    // render-space uniforms (float64 on the CPU → small float32 on the GPU)
    let meshes = 0;
    this.chunks.forEach((c) => {
      if (!c.mesh || !c.material) return;
      meshes++;
      const u = c.material.uniforms;
      (u.uOrigin.value as THREE.Vector2).set(wrappedDelta(fx, c.cx * CHUNK, WORLD_C), c.cz * CHUNK - fz);
      c.mesh.visible = TerrainManager.chunkDistance(fx, fz, c.cx, c.cz) <= VIEW_DISTANCE + 200;
    });

    this.stats.chunks = this.chunks.size;
    this.stats.meshes = meshes;
    this.stats.builtThisFrame = built;
    this.stats.queued = this.queue.length - built;
    this.stats.lastUpdateMs = this.now() - t0;
  }

  private build(key: number, cx: number, cz: number, lod: number, version: number): void {
    const old = this.chunks.get(key);
    const tile = chunkTile(this.field.source, cx, cz);
    const r = CHUNK * 0.75;
    const complete = this.field.ready(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2, r);
    let data: ChunkGeometryData | null = null;
    if (tile !== "water" && tile !== undefined) data = buildChunkData(this.field, cx, cz, LOD_STEPS[lod]);
    else if (tile === undefined && !complete) data = null; // loading: water for now, retried on version change

    if (old) this.disposeMesh(old);
    const chunk: Chunk = { cx, cz, lod, mesh: null, material: null, complete, builtVersion: version };
    if (data) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      geom.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
      geom.setAttribute("aColor", new THREE.BufferAttribute(data.colors, 3));
      geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const material = this.baseMaterial.clone();
      material.uniforms.uChunkZ0.value = cz * CHUNK;
      const mesh = new THREE.Mesh(geom, material);
      mesh.frustumCulled = false; // vertices are moved in the shader; the manager culls by distance
      mesh.matrixAutoUpdate = false;
      mesh.name = `chunk_${cx}_${cz}_l${lod}`;
      this.group.add(mesh);
      chunk.mesh = mesh;
      chunk.material = material;
    }
    this.chunks.set(key, chunk);
  }

  private disposeMesh(c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    c.material?.dispose();
    c.mesh = null;
    c.material = null;
  }

  private dispose(key: number, c: Chunk): void {
    this.disposeMesh(c);
    this.chunks.delete(key);
  }

  /** Dispose everything (component unmount). */
  disposeAll(): void {
    this.chunks.forEach((c, key) => this.dispose(key, c));
    this.baseMaterial.dispose();
  }

  /** Debug/test: the chunk record for (cx, cz). */
  getChunk(cx: number, cz: number): { lod: number; hasMesh: boolean; complete: boolean } | undefined {
    const c = this.chunks.get(cz * CHUNKS_X + cx);
    return c && { lod: c.lod, hasMesh: !!c.mesh, complete: c.complete };
  }
}
