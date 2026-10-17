// F1 / Q1 B4: the minimap texture (1024) is rendered without the 15° graticule, which showed as dark
// stripes in the zoomed-in minimap; the world map (4096) keeps it.
import { describe, expect, it } from "vitest";
import { H, W } from "../common";
import { renderMap } from "../map";

describe("renderMap graticule option", () => {
  // All open sea (positive SDF everywhere): any variation along an equatorial row is the grid.
  const sdf = new Int8Array(W * H).fill(100);
  const rowSpread = (img: Uint8Array, width: number, v: number) => {
    let lo = 255;
    let hi = 0;
    for (let u = 0; u < width; u++) {
      const r = img[(v * width + u) * 3];
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    return hi - lo;
  };

  it("draws dark grid columns by default and none with graticule: false", () => {
    const width = 256;
    const v = width / 4 + 3; // an equatorial row that is not itself a grid row
    const withGrid = renderMap(sdf, width);
    const noGrid = renderMap(sdf, width, { graticule: false });
    expect(rowSpread(withGrid, width, v)).toBeGreaterThan(5);
    expect(rowSpread(noGrid, width, v)).toBe(0);
  });
});
