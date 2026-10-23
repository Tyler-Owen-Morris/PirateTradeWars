/**
 * Client land tiles (docs/world/WORLD_SPEC.md §4.1–4.2). Framework-free.
 *
 * Fetches `/world/land/manifest.json`, then the SDF tiles (`/world/land/<version>/t_<tx>_<ty>.bin`,
 * raw Int8 65536 bytes; or `.bin.gz` gunzipped with DecompressionStream when the manifest says
 * `"encoding": "gzip"`) in a square of LOAD_RING tiles around the ship (2 tiles + a 1-tile prefetch
 * ring), caches them, and exposes ONE `LandField` over that cache. The same field drives own-ship
 * prediction (so coast slides predict exactly like the server) and can be used by rendering (W3
 * terrain) and UI (W5).
 *
 * Missing tiles (still loading) read as water and `field.ready(x, z, r)` reports false; the server
 * is authoritative, so the prediction just reconciles once the tile arrives. All-water / all-land
 * tiles from the manifest are never fetched. If there is no manifest (land data not generated yet),
 * every tile is treated as water — the same fallback the server uses.
 *
 * Usage: `clientLand.update(x, z)` every frame (cheap unless the ship changed tile);
 * `clientLand.field` is the LandQuery.
 */
import {
  ArrayTileSource,
  LandField,
  SDF_H,
  SDF_UNIT,
  SDF_W,
  TILE,
  TILES_X,
  TILES_Y,
  tileKey,
  tileOf,
  type LandManifest,
} from "@shared/world/land";

/** Tiles fetched in each direction around the ship's tile (2 needed + 1 prefetch). */
export const LOAD_RING = 3;
/** Data tiles kept in memory at most (64 KB each); the farthest are evicted first. */
export const MAX_CACHED_TILES = 128;
/** Retry a failed manifest fetch after this long (ms). */
export const MANIFEST_RETRY_MS = 30_000;

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class ClientLandTiles {
  readonly source = new ArrayTileSource();
  readonly field = new LandField(this.source);
  manifest: LandManifest | null = null;
  /** True when running without land data (no manifest): every tile is water. */
  fallback = false;
  private manifestState: "idle" | "loading" | "done" = "idle";
  private manifestRetryAt = 0;
  private readonly inflight = new Set<number>();
  private readonly dataTiles = new Set<number>();
  private uniform = new Set<number>();
  private centerKey = -1;
  /** Dev city camera (lib/world/cityDebug.ts): load around this point instead of the ship. */
  centerOverride: { x: number; z: number } | null = null;
  /** Bumps whenever a tile arrives (renderers can watch it). */
  version = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly baseUrl: string = "/world/land",
    private readonly fetchFn: FetchFn = (url) => (globalThis as any).fetch(url),
    private readonly now: () => number = () => Date.now(),
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error("[land] listener failed", err);
      }
    });
  }

  /** Make sure the tiles around (x, z) are loaded or loading. Call every frame. */
  update(x: number, z: number): void {
    if (this.centerOverride) {
      x = this.centerOverride.x;
      z = this.centerOverride.z;
    }
    if (this.manifestState !== "done") {
      this.loadManifest();
      return;
    }
    if (this.fallback) return;
    const { tx, ty } = tileOf(x, z);
    const key = ty * TILES_X + tx;
    if (key === this.centerKey) return;
    this.centerKey = key;
    for (let dy = -LOAD_RING; dy <= LOAD_RING; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= TILES_Y) continue;
      for (let dx = -LOAD_RING; dx <= LOAD_RING; dx++) {
        const xx = (((tx + dx) % TILES_X) + TILES_X) % TILES_X;
        this.request(xx, y);
      }
    }
    this.evict(tx, ty);
  }

  private loadManifest(): void {
    if (this.manifestState === "loading" || this.now() < this.manifestRetryAt) return;
    this.manifestState = "loading";
    let p: Promise<any>;
    try {
      p = this.fetchFn(`${this.baseUrl}/manifest.json`);
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(async (res) => {
      if (res.status === 404) {
        this.useFallback("no land manifest (404)");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = (await res.json()) as LandManifest;
      if (m.width !== SDF_W || m.height !== SDF_H || m.tile !== TILE || m.sdfUnit !== SDF_UNIT) {
        this.useFallback("land manifest does not match the raster constants");
        return;
      }
      this.applyManifest(m);
    }).catch((err) => {
      console.warn("[land] manifest fetch failed, retrying later:", err);
      this.manifestState = "idle";
      this.manifestRetryAt = this.now() + MANIFEST_RETRY_MS;
    });
  }

  /** Install a manifest (public for tests): uniform tiles are set immediately. */
  applyManifest(m: LandManifest): void {
    this.manifest = m;
    this.fallback = false;
    this.uniform = new Set<number>();
    for (const k of m.allWater ?? []) this.setUniform(k, "water");
    for (const k of m.allLand ?? []) this.setUniform(k, "land");
    this.manifestState = "done";
    this.centerKey = -1;
    this.bump();
  }

  private setUniform(k: string, v: "water" | "land"): void {
    const [tx, ty] = k.split("_").map(Number);
    if (!(tx >= 0 && tx < TILES_X && ty >= 0 && ty < TILES_Y)) return;
    this.source.set(tx, ty, v);
    this.uniform.add(ty * TILES_X + tx);
  }

  private useFallback(why: string): void {
    console.warn(`[land] ${why} — open ocean + polar ice only`);
    this.fallback = true;
    for (let ty = 0; ty < TILES_Y; ty++) for (let tx = 0; tx < TILES_X; tx++) this.source.set(tx, ty, "water");
    this.manifestState = "done";
    this.bump();
  }

  private request(tx: number, ty: number): void {
    const key = ty * TILES_X + tx;
    if (this.uniform.has(key) || this.dataTiles.has(key) || this.inflight.has(key) || !this.manifest) return;
    this.inflight.add(key);
    const gzip = this.manifest.encoding === "gzip";
    const url = `${this.baseUrl}/${this.manifest.version}/t_${tx}_${ty}.bin${gzip ? ".gz" : ""}`;
    let p: Promise<any>;
    try {
      p = this.fetchFn(url);
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      // A server may send `.bin.gz` with `Content-Encoding: gzip` (Vite dev does), in which case the
      // browser has already inflated it: only gunzip when the gzip magic bytes are present.
      const head = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
      const isGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
      const buf = gzip && isGzip ? await gunzip(raw) : raw;
      if (buf.byteLength !== TILE * TILE) throw new Error(`tile ${tileKey(tx, ty)} has ${buf.byteLength} bytes`);
      this.source.set(tx, ty, new Int8Array(buf));
      this.dataTiles.add(key);
      this.bump();
    })
      .catch((err) => console.warn(`[land] tile ${tileKey(tx, ty)} failed (will retry on the next tile change):`, err))
      .finally(() => this.inflight.delete(key));
  }

  /** Drop the farthest data tiles when over MAX_CACHED_TILES. */
  private evict(cx: number, cy: number): void {
    if (this.dataTiles.size <= MAX_CACHED_TILES) return;
    const dist = (key: number) => {
      const tx = key % TILES_X;
      const ty = (key - tx) / TILES_X;
      let dx = Math.abs(tx - cx);
      if (dx > TILES_X / 2) dx = TILES_X - dx;
      return Math.max(dx, Math.abs(ty - cy));
    };
    const sorted = Array.from(this.dataTiles).sort((a, b) => dist(b) - dist(a));
    for (const key of sorted) {
      if (this.dataTiles.size <= MAX_CACHED_TILES) break;
      if (dist(key) <= LOAD_RING) break;
      const tx = key % TILES_X;
      this.source.set(tx, (key - tx) / TILES_X, undefined);
      this.dataTiles.delete(key);
    }
  }
}

/** Gunzip with the browser's DecompressionStream (also in Node ≥ 18). */
async function gunzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  const DS = (globalThis as any).DecompressionStream;
  const R = (globalThis as any).Response;
  if (!DS || !R) throw new Error("DecompressionStream unavailable: cannot read gzip land tiles");
  const stream = new R(data).body.pipeThrough(new DS("gzip"));
  return new R(stream).arrayBuffer();
}

/** App-wide land tile cache; `clientLand.field` is the client's LandQuery. */
export const clientLand = new ClientLandTiles();
