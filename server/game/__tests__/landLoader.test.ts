// server/game/landLoader.ts: synchronous tile preload with an all-water fallback.
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { landDirCandidates, loadLandSync } from "../landLoader";
import { PX, SDF_FAR, SDF_H, SDF_UNIT, SDF_W, TILE, TILES_X, TILES_Y, tileKey } from "@shared/world/land";
import { Z_ICE_N } from "@shared/world/geo";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ptw-land-"));
}

describe("loadLandSync", () => {
  it("falls back to open ocean + ice when there is no manifest", () => {
    const logs: string[] = [];
    const land = loadLandSync([tmpDir()], (m) => logs.push(m));
    expect(land.version).toBeNull();
    expect(land.field.distance(1000, 100_000)).toBe(SDF_FAR);
    expect(land.field.distance(1000, Z_ICE_N - 10)).toBeCloseTo(-10, 9);
    expect(logs.join(" ")).toMatch(/no manifest/);
  });

  it("loads data tiles, all-water / all-land tiles, and treats unreadable tiles as water", () => {
    const dir = tmpDir();
    const allWater: string[] = [];
    const allLand: string[] = [];
    for (let ty = 0; ty < TILES_Y; ty++) for (let tx = 0; tx < TILES_X; tx++) {
      if (tx === 3 && ty === 7) continue; // data tile
      if (tx === 4 && ty === 7) continue; // missing file
      if (tx === 5 && ty === 7) allLand.push(tileKey(tx, ty));
      else allWater.push(tileKey(tx, ty));
    }
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ version: "abc123", width: SDF_W, height: SDF_H, tile: TILE, px: PX, sdfUnit: SDF_UNIT, iceLat: 70, allWater, allLand }),
    );
    fs.mkdirSync(path.join(dir, "abc123"));
    const data = Buffer.alloc(TILE * TILE);
    data.fill(256 - 25); // Int8 −25 → −100 units (land)
    fs.writeFileSync(path.join(dir, "abc123", "t_3_7.bin"), data);
    const logs: string[] = [];
    const land = loadLandSync([dir], (m) => logs.push(m));
    expect(land.version).toBe("abc123");
    expect(land.tiles).toEqual({ data: 1, water: TILES_X * TILES_Y - 3, land: 1, missing: 1 });
    const centre = (tx: number, ty: number) => [(tx + 0.5) * TILE * PX, (ty + 0.5) * TILE * PX] as const;
    expect(land.field.distance(...centre(3, 7))).toBe(-100);
    expect(land.field.distance(...centre(4, 7))).toBe(SDF_FAR);
    expect(land.field.distance(...centre(5, 7))).toBe(-SDF_FAR);
    expect(logs.join(" ")).toMatch(/tile 4_7 unreadable/);
  });

  it("prefers dist in production and client/public in dev; LAND_DIR overrides", () => {
    expect(landDirCandidates({ NODE_ENV: "production" } as any, "/app")[0]).toContain(path.join("dist", "public"));
    expect(landDirCandidates({ NODE_ENV: "development" } as any, "/app")[0]).toContain(path.join("client", "public"));
    expect(landDirCandidates({ LAND_DIR: "x/y" } as any, "/app")).toEqual([path.resolve("/app", "x/y")]);
  });
});
