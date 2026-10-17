// client/src/lib/world/minimapLand.ts: SDF-rendered minimap land (sharp coasts at close zoom).
import { describe, expect, it } from "vitest";
import { renderMinimapLand } from "../minimapLand";
import { ArrayTileSource, LandField, buildSyntheticLand } from "@shared/world/land";
import { WORLD_C, zOfLat } from "@shared/world/geo";

const isLand = (px: Uint8ClampedArray, o: number) => px[o] > 190 && px[o + 2] < 170; // parchment
const isSea = (px: Uint8ClampedArray, o: number) => px[o + 2] > px[o]; // blue-green

describe("minimap land from the SDF", () => {
  const z = zOfLat(20);
  const x = WORLD_C / 2;
  const { field } = buildSyntheticLand([{ kind: "circle", x, z, r: 400 }]);

  it("draws an island at close zoom with a sharp, round coast", () => {
    // closest minimap zoom: radius 1500 across 200 CSS px at dpr 2 → 400 device px, 7.5 units/px
    const size = 400;
    const scale = size / 2 / 1500;
    const px = renderMinimapLand(field, x, z, scale, size);
    const at = (u: number, v: number) => (v * size + u) * 4;
    expect(isLand(px, at(200, 200))).toBe(true);
    expect(isSea(px, at(10, 10))).toBe(true);
    // the coast is ~400 units = ~53 px from the centre along every axis (not a blocky square)
    let edge = 0;
    for (let u = 200; u < size; u++) if (!isLand(px, at(u, 200))) { edge = u - 200; break; }
    expect(edge).toBeGreaterThan(45);
    expect(edge).toBeLessThan(62);
    let diag = 0;
    for (let k = 0; k < 200; k++) if (!isLand(px, at(200 + k, 200 + k))) { diag = Math.hypot(k, k); break; }
    expect(Math.abs(diag - edge)).toBeLessThan(6);
    // anti-aliased: the land fades into the ink line across a few pixels, no hard 7-px steps
    for (let u = 1; u < size; u++) {
      const a = at(u - 1, 200);
      const b = at(u, 200);
      expect(Math.abs(px[a] - px[b])).toBeLessThan(90);
    }
  });

  it("leaves unloaded tiles transparent so the texture shows through", () => {
    const empty = new LandField(new ArrayTileSource());
    const px = renderMinimapLand(empty, x, z, 0.1, 16);
    expect(px.every((v) => v === 0)).toBe(true);
  });

  it("wraps across the x seam", () => {
    const seam = buildSyntheticLand([{ kind: "circle", x: 200, z, r: 400 }]).field;
    const size = 200;
    const px = renderMinimapLand(seam, WORLD_C - 100, z, size / 2 / 1500, size);
    // island centre is 300 x-units east of the view centre: 300·cos(20°)·scale ≈ 19 px right
    const o = (100 * size + 119) * 4;
    expect(isLand(px, o)).toBe(true);
  });
});
