// client/src/lib/world/landTiles.ts: tile fetching around the ship with a fake fetch.
import { describe, expect, it } from "vitest";
import { ClientLandTiles, LOAD_RING } from "../landTiles";
import { PX, SDF_FAR, SDF_H, SDF_UNIT, SDF_W, TILE, tileKey, tileOf } from "@shared/world/land";

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeFetch(manifest: unknown | null) {
  const urls: string[] = [];
  const fn = (url: string) => {
    urls.push(url);
    if (url.endsWith("manifest.json")) {
      if (!manifest) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
      return Promise.resolve({ ok: true, status: 200, json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) });
    }
    const buf = new Int8Array(TILE * TILE).fill(-10); // −40 units: land
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => buf.buffer });
  };
  return { fn, urls };
}

describe("ClientLandTiles", () => {
  it("fetches the manifest, then the tiles around the ship (skipping uniform tiles)", async () => {
    const x = 200_000;
    const z = 100_000;
    const { tx, ty } = tileOf(x, z);
    const manifest = { version: "v1", width: SDF_W, height: SDF_H, tile: TILE, px: PX, sdfUnit: SDF_UNIT, iceLat: 70, allWater: [tileKey(tx + 1, ty)], allLand: [] };
    const f = fakeFetch(manifest);
    const land = new ClientLandTiles("/world/land", f.fn);
    expect(land.field.ready(x, z, 100)).toBe(false);
    land.update(x, z);
    await flush();
    land.update(x, z);
    await flush();
    const tiles = f.urls.filter((u) => u.endsWith(".bin"));
    expect(tiles).toContain(`/world/land/v1/t_${tx}_${ty}.bin`);
    expect(tiles).not.toContain(`/world/land/v1/t_${tx + 1}_${ty}.bin`); // all-water: never fetched
    expect(tiles.length).toBe((2 * LOAD_RING + 1) ** 2 - 1);
    expect(land.field.ready(x, z, 2 * TILE * PX)).toBe(true);
    expect(land.field.distance(x, z)).toBeCloseTo(-40, 9);
    // same tile again: no new requests
    const n = f.urls.length;
    land.update(x + 10, z);
    expect(f.urls.length).toBe(n);
  });

  it("no manifest (404) → every tile is water, ready everywhere", async () => {
    const f = fakeFetch(null);
    const land = new ClientLandTiles("/world/land", f.fn);
    land.update(1000, 100_000);
    await flush();
    expect(land.fallback).toBe(true);
    expect(land.field.ready(1000, 100_000, 5000)).toBe(true);
    expect(land.field.distance(1000, 100_000)).toBe(SDF_FAR);
  });
});
