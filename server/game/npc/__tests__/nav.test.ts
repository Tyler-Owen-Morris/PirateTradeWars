import { describe, expect, it } from "vitest";
import { buildSyntheticLand } from "@shared/world/land";
import { geoMetric } from "../metric";
import { planPath, segmentClear } from "../nav";

// A wall of land between two points near the equator, open at its north end only.
const Z0 = 100_000;
const { field } = buildSyntheticLand([{ kind: "rect", x0: 10_000, z0: Z0 - 1000, x1: 10_300, z1: Z0 + 3000 }]);

describe("nav: planPath around land", () => {
  it("finds a clear way round a wall that blocks the straight line", () => {
    const from = { x: 9_200, z: Z0 + 500 };
    const to = { x: 11_100, z: Z0 + 500 };
    expect(segmentClear(field, geoMetric, from.x, from.z, to.x, to.z, 40)).toBe(false);
    const path = planPath(field, geoMetric, from, to, 40)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual(to);
    let ax = from.x;
    let az = from.z;
    for (const p of path) {
      expect(segmentClear(field, geoMetric, ax, az, p.x, p.z, 30)).toBe(true);
      ax = p.x;
      az = p.z;
    }
    // it goes round the north end (z < Z0 − 1000)
    expect(Math.min(...path.map((p) => p.z))).toBeLessThan(Z0 - 1000);
  });

  it("returns null when nothing is reachable", () => {
    const { field: boxed } = buildSyntheticLand([{ kind: "circle", x: 20_000, z: Z0, r: 3000 }]);
    expect(planPath(boxed, geoMetric, { x: 20_000, z: Z0 }, { x: 30_000, z: Z0 }, 40)).toBeNull();
  });
});
