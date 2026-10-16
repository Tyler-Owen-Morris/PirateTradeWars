/**
 * Server land tiles (docs/world/WORLD_SPEC.md §4.1–4.2): synchronously preloads every SDF tile
 * into memory at boot (≈ 32 MB at most; all-water / all-land tiles cost nothing), BEFORE the tick
 * starts, and returns a `LandField` the World uses for collision, ball splashes and spawn checks.
 *
 * Where the data lives (produced by the W2 pipeline):
 *   <root>/manifest.json            { version, width, height, tile, px, sdfUnit, iceLat, allWater, allLand }
 *   <root>/<version>/t_<tx>_<ty>.bin  raw Int8, row-major, exactly 65536 bytes
 * <root> is `dist/public/world/land` (production build; Vite copies client/public) or
 * `client/public/world/land` (dev). Override with LAND_DIR.
 *
 * If no manifest exists (data not generated yet) or it does not match this build's raster
 * constants, the loader falls back to the all-water field (ocean + polar ice) and logs a warning:
 * the game still runs, just without continents. A tile file that is missing or the wrong size is
 * also treated as water (with a warning), never fatal.
 */
import fs from "fs";
import path from "path";
import {
  ALWAYS_WATER_TEST_FIELD,
  ArrayTileSource,
  LandField,
  SDF_H,
  SDF_UNIT,
  SDF_W,
  TILE,
  TILES_X,
  TILES_Y,
  tileKey,
  type LandManifest,
} from "@shared/world/land";

export interface LoadedLand {
  field: LandField;
  /** Manifest version, or null when running on the all-water fallback. */
  version: string | null;
  /** Directory the tiles were read from (null on fallback). */
  dir: string | null;
  /** Counts for the boot log. */
  tiles: { data: number; water: number; land: number; missing: number };
}

/** Candidate land roots, in priority order. */
export function landDirCandidates(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  if (env.LAND_DIR) return [path.resolve(cwd, env.LAND_DIR)];
  const dist = path.resolve(cwd, "dist", "public", "world", "land");
  const client = path.resolve(cwd, "client", "public", "world", "land");
  return env.NODE_ENV === "production" ? [dist, client] : [client, dist];
}

/** Load the land field synchronously. Never throws; falls back to the all-water field. */
export function loadLandSync(dirs: string[] = landDirCandidates(), log: (msg: string) => void = console.warn): LoadedLand {
  const fallback = (why: string): LoadedLand => {
    log(`[land] ${why} — running with OPEN OCEAN + polar ice only (no continents).`);
    return { field: ALWAYS_WATER_TEST_FIELD, version: null, dir: null, tiles: { data: 0, water: TILES_X * TILES_Y, land: 0, missing: 0 } };
  };

  const dir = dirs.find((d) => fs.existsSync(path.join(d, "manifest.json")));
  if (!dir) return fallback(`no manifest.json in ${dirs.join(" or ")}`);

  let manifest: LandManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  } catch (err) {
    return fallback(`unreadable manifest in ${dir}: ${(err as Error).message}`);
  }
  if (manifest.width !== SDF_W || manifest.height !== SDF_H || manifest.tile !== TILE || manifest.sdfUnit !== SDF_UNIT) {
    return fallback(
      `manifest ${dir} does not match the raster constants (got ${manifest.width}x${manifest.height} tile ${manifest.tile} unit ${manifest.sdfUnit})`,
    );
  }

  const water = new Set(manifest.allWater ?? []);
  const land = new Set(manifest.allLand ?? []);
  const source = new ArrayTileSource();
  const tiles = { data: 0, water: 0, land: 0, missing: 0 };
  const tileDir = path.join(dir, String(manifest.version));
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const key = tileKey(tx, ty);
      if (water.has(key)) {
        source.set(tx, ty, "water");
        tiles.water++;
        continue;
      }
      if (land.has(key)) {
        source.set(tx, ty, "land");
        tiles.land++;
        continue;
      }
      const file = path.join(tileDir, `t_${tx}_${ty}.bin`);
      try {
        const buf = fs.readFileSync(file);
        if (buf.length !== TILE * TILE) throw new Error(`size ${buf.length}`);
        source.set(tx, ty, new Int8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
        tiles.data++;
      } catch (err) {
        log(`[land] tile ${key} unreadable (${(err as Error).message}); treating it as water`);
        source.set(tx, ty, "water");
        tiles.missing++;
      }
    }
  }
  console.log(
    `[land] loaded ${manifest.version} from ${dir}: ${tiles.data} data tiles, ${tiles.water} all-water, ${tiles.land} all-land, ${tiles.missing} missing`,
  );
  return { field: new LandField(source), version: String(manifest.version), dir, tiles };
}
