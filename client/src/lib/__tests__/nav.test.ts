import { describe, it, expect } from "vitest";
import { WORLD_C, WORLD_H, zOfLat, xOfLon, compassHeading, metricX } from "@shared/world/geo";
import { SHIP_STATS } from "@shared/gameConstants";
import {
  formatLatLon,
  formatPosition,
  cardinalOf,
  formatSeaMiles,
  relativeBearing,
  nearestPortTo,
  targetInfo,
  portPoint,
  minimapProject,
  minimapRow,
  stepMinimapRadius,
  minimapSpanLabel,
  speedToKnots,
  KNOTS_PER_SPEED_UNIT,
  clampView,
  mapWorldToScreen,
  mapScreenToWorld,
  zoomAt,
  mapImageOffsets,
  pickPort,
  gridLines,
  placeLabels,
  portLabelPriority,
} from "../nav";
import { PORTS } from "@shared/world/ports";

describe("placeLabels (map label decluttering)", () => {
  const measure = (t: string) => t.length * 6;
  it("keeps every label when nothing overlaps", () => {
    const shown = placeLabels(
      [
        { id: 1, x: 0, y: 0, text: "Havana", priority: 0 },
        { id: 2, x: 200, y: 0, text: "Nassau", priority: 0 },
      ],
      measure,
      12,
    );
    expect([...shown].sort()).toEqual([1, 2]);
  });
  it("drops the lower-priority label of an overlapping pair; the target always wins", () => {
    const c = [
      { id: 30, x: 0, y: 0, text: "Montevideo", priority: 0 },
      { id: 29, x: 10, y: 2, text: "Buenos Aires", priority: portLabelPriority({ key: "buenos_aires", id: 29 }, false) },
    ];
    expect([...placeLabels(c, measure, 12)]).toEqual([29]);
    c[0].priority = portLabelPriority({ key: "montevideo", id: 30 }, true);
    expect([...placeLabels(c, measure, 12)]).toEqual([30]);
  });
  it("thins the real ports out when zoomed out but keeps them all when zoomed in", () => {
    const cands = (scale: number) =>
      PORTS.map((p) => ({ id: p.id, x: p.dock.x * scale, y: p.dock.z * scale, text: p.name, priority: portLabelPriority(p, false) }));
    const far = placeLabels(cands(0.004), measure, 12); // the whole world in ~1600 px
    const near = placeLabels(cands(1), measure, 12);
    expect(far.size).toBeLessThan(PORTS.length);
    expect(far.size).toBeGreaterThan(15);
    expect(near.size).toBe(PORTS.length);
    for (const k of ["port_royal", "london", "callao", "rio_de_janeiro"]) expect(far.has(PORTS.find((p) => p.key === k)!.id), k).toBe(true);
  });
});

describe("formatting", () => {
  it("formats lat/lon", () => {
    expect(formatLatLon(17.9333, -76.8333)).toBe("17°56′N 76°50′W");
    expect(formatLatLon(-33.5, 151.2)).toBe("33°30′S 151°12′E");
    expect(formatLatLon(10.9999, 0)).toBe("11°00′N 0°00′");
  });
  it("formats a world position (Greenwich equator)", () => {
    expect(formatPosition(WORLD_C / 2, WORLD_H / 2)).toBe("0°00′ 0°00′");
  });
  it("cardinals", () => {
    expect(cardinalOf(0)).toBe("N");
    expect(cardinalOf(359)).toBe("N");
    expect(cardinalOf(90)).toBe("E");
    expect(cardinalOf(225)).toBe("SW");
    expect(cardinalOf(compassHeading(-Math.PI / 2))).toBe("E");
  });
  it("sea miles", () => {
    expect(formatSeaMiles(18.52)).toBe("1.0 nm");
    expect(formatSeaMiles(1852)).toBe("100 nm");
    expect(formatSeaMiles(92_600)).toBe("5,000 nm");
  });
});

describe("targeting", () => {
  it("relative bearing wraps", () => {
    expect(relativeBearing(10, 350)).toBeCloseTo(20);
    expect(relativeBearing(350, 10)).toBeCloseTo(-20);
    expect(Math.abs(relativeBearing(180, 0))).toBeCloseTo(180);
  });
  it("portPoint prefers dock", () => {
    expect(portPoint({ x: 1, z: 2, dock: { x: 3, z: 4 } })).toEqual({ x: 3, z: 4 });
    expect(portPoint({ x: 1, z: 2 })).toEqual({ x: 1, z: 2 });
  });
  it("nearest port across the seam, via dock", () => {
    const z = zOfLat(0);
    const ports = [
      { id: 1, name: "far", x: 200_000, z },
      { id: 2, name: "seam", x: 5, z, dock: { x: WORLD_C - 100, z } },
    ];
    expect(nearestPortTo(WORLD_C - 500, z, ports)?.id).toBe(2);
    expect(nearestPortTo(0, 0, [])).toBeNull();
  });
  it("bearing/distance east across the seam", () => {
    const z = zOfLat(0);
    const t = targetInfo(WORLD_C - 100, z, 0, { id: 1, name: "p", x: 300, z });
    expect(t.bearing).toBeCloseTo(90);
    expect(t.distance).toBeCloseTo(400, 3);
    expect(t.relative).toBeCloseTo(90);
  });
  it("high latitude: east-west distance shrinks by cos(lat)", () => {
    const z = zOfLat(60);
    const t = targetInfo(1000, z, 0, { id: 1, name: "p", x: 2000, z });
    expect(t.distance).toBeCloseTo(1000 * metricX(z), 3);
  });
});

describe("minimap", () => {
  it("centre maps to the middle; east is right, north is up", () => {
    const z = zOfLat(0);
    expect(minimapProject(1000, z, 1000, z, 6000, 200)).toEqual({ x: 100, y: 100 });
    const e = minimapProject(1000, z, 1000 + 3000, z, 6000, 200);
    expect(e.x).toBeCloseTo(150);
    const n = minimapProject(1000, z, 1000, z - 3000, 6000, 200);
    expect(n.y).toBeCloseTo(50);
  });
  it("projects across the seam", () => {
    const z = zOfLat(0);
    const p = minimapProject(WORLD_C - 1000, z, 1000, z, 6000, 200);
    expect(p.x).toBeCloseTo(100 + (2000 / 6000) * 100);
  });
  it("x offsets scale by cos(lat) at high latitude", () => {
    const z = zOfLat(60);
    const p = minimapProject(1000, z, 1000 + 4000, z, 6000, 200);
    expect(p.x).toBeCloseTo(100 + ((4000 * metricX(z)) / 6000) * 100);
  });
  it("row segments: single in the middle, split at the seam", () => {
    const mid = minimapRow(WORLD_C / 2, zOfLat(0), 100, 6000, 200, 1024, 512);
    expect(mid.segments).toHaveLength(1);
    expect(mid.segments[0].dw).toBe(200);
    const seam = minimapRow(0, zOfLat(0), 100, 6000, 200, 1024, 512);
    expect(seam.segments).toHaveLength(2);
    const total = seam.segments.reduce((s, g) => s + g.dw, 0);
    expect(total).toBeCloseTo(200);
    expect(seam.segments[0].sx + seam.segments[0].sw).toBeCloseTo(1024);
    expect(seam.segments[1].sx).toBe(0);
    expect(seam.segments[1].dx).toBeCloseTo(seam.segments[0].dw);
  });
  it("high latitude rows show a wider image span", () => {
    const eq = minimapRow(WORLD_C / 2, zOfLat(0), 100, 6000, 200, 1024, 512);
    const hi = minimapRow(WORLD_C / 2, zOfLat(65), 100, 6000, 200, 1024, 512);
    expect(hi.segments[0].sw).toBeGreaterThan(eq.segments[0].sw * 2);
    expect(hi.srcY).toBeLessThan(512 / 2);
  });
  it("zoom steps clamp", () => {
    expect(stepMinimapRadius(6000, 1)).toBe(3000);
    expect(stepMinimapRadius(1500, 1)).toBe(1500);
    expect(stepMinimapRadius(24000, -1)).toBe(24000);
  });
  it("F1/B5: HUD knots use the documented display scale (fastest ship ≈ 13.5 kn)", () => {
    expect(KNOTS_PER_SPEED_UNIT).toBe(1.5);
    expect(speedToKnots(-4)).toBeCloseTo(6, 9); // sloop at full ahead (velocity is negative)
    expect(speedToKnots(2)).toBeCloseTo(3, 9); // reverse reads positive
    const fastest = Math.max(...Object.values(SHIP_STATS).map((s) => s.speed));
    expect(speedToKnots(fastest)).toBeGreaterThanOrEqual(12);
    expect(speedToKnots(fastest)).toBeLessThanOrEqual(14);
  });
  it("F1/B4: the scale caption is the full span (2 × radius), not the radius", () => {
    expect(minimapSpanLabel(6000)).toBe("1200 km across"); // was "Edge = 600.0 km"
    expect(minimapSpanLabel(1500)).toBe("300 km across");
    expect(minimapSpanLabel(24000)).toBe("4800 km across");
    expect(minimapSpanLabel(400)).toBe("80.0 km across");
  });
});

describe("world map", () => {
  const W = 1200;
  const H = 600;
  const v0 = clampView({ cx: xOfLon(0), cz: WORLD_H / 2, k: 0.003 }, H);

  it("clamps zoom and vertical pan", () => {
    const v = clampView({ cx: -10, cz: -5000, k: 1e-9 }, H);
    expect(v.k).toBeCloseTo(H / WORLD_H);
    expect(v.cz).toBe(WORLD_H / 2);
    expect(v.cx).toBe(WORLD_C - 10);
    const z = clampView({ cx: 0, cz: 0, k: 0.01 }, H);
    expect(z.cz).toBeCloseTo(H / 2 / 0.01);
  });
  it("world <-> screen roundtrip, and wrap picks the short way", () => {
    const s = mapWorldToScreen(v0, W, H, xOfLon(10), zOfLat(20));
    const w = mapScreenToWorld(v0, W, H, s.x, s.y);
    expect(w.x).toBeCloseTo(xOfLon(10), 3);
    expect(w.z).toBeCloseTo(zOfLat(20), 3);
    const v = { ...v0, cx: WORLD_C - 100 };
    expect(mapWorldToScreen(v, W, H, 100, v.cz).x).toBeCloseTo(W / 2 + 200 * v.k);
  });
  it("zoomAt keeps the anchor fixed", () => {
    const sx = 900;
    const sy = 200;
    const before = mapScreenToWorld(v0, W, H, sx, sy);
    const z = zoomAt(v0, W, H, sx, sy, 1.5);
    expect(z.k).toBeCloseTo(v0.k * 1.5);
    const after = mapScreenToWorld(z, W, H, sx, sy);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.z).toBeCloseTo(before.z, 2);
  });
  it("image copies cover the viewport at the seam", () => {
    const v = clampView({ cx: 0, cz: WORLD_H / 2, k: 0.004 }, H);
    const offs = mapImageOffsets(v, W);
    const mapW = WORLD_C * v.k;
    expect(offs.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...offs)).toBeLessThanOrEqual(0);
    expect(Math.max(...offs) + mapW).toBeGreaterThanOrEqual(W);
    for (let i = 1; i < offs.length; i++) expect(offs[i] - offs[i - 1]).toBeCloseTo(mapW);
  });
  it("picks ports by dock point", () => {
    const ports = [
      { id: 1, name: "a", x: 0, z: 0, dock: { x: v0.cx, z: v0.cz } },
      { id: 2, name: "b", x: v0.cx + 50000, z: v0.cz },
    ];
    expect(pickPort(v0, W, H, W / 2 + 3, H / 2 - 2, ports)?.id).toBe(1);
    expect(pickPort(v0, W, H, 5, 5, ports)).toBeNull();
  });
  it("grid every 30 degrees", () => {
    const g = gridLines(30);
    expect(g.lons).toHaveLength(12);
    expect(g.lats).toEqual([-60, -30, 0, 30, 60]);
  });
});
