import { describe, it, expect } from "vitest";
import { wrappedDelta } from "@shared/physics";
import { MAP_WIDTH } from "@shared/gameConstants";
import { zOfLat } from "@shared/world/geo";
import { MAX_EXTRAPOLATION_MS, FLAG_SUNK } from "@shared/protocol";
import { InterpolationBuffer, RemoteWorld } from "../interpolation";

function sample(t: number, x: number, z: number, r = 0, v = 0, flags = 0) {
  return { t, x, z, r, v, hp: 100, flags };
}

describe("InterpolationBuffer", () => {
  it("lerps between the two samples around renderTime", () => {
    const b = new InterpolationBuffer();
    b.push(sample(1000, 100, 200, 0));
    b.push(sample(1050, 110, 220, 0.5));
    const p = b.sample(1025)!;
    expect(p.x).toBeCloseTo(105, 6);
    expect(p.z).toBeCloseTo(210, 6);
    expect(p.r).toBeCloseTo(0.25, 6);
    expect(p.extrapolated).toBe(false);
  });

  it("interpolates across the x wrap seam along the short path; z is a plain lerp (no wrap)", () => {
    const b = new InterpolationBuffer();
    b.push(sample(0, MAP_WIDTH - 10, 100_000));
    b.push(sample(50, 10, 100_020));
    const p = b.sample(25)!;
    // Midpoint is the seam itself (0 / MAP_WIDTH), never the map center.
    expect(Math.abs(wrappedDelta(0, p.x, MAP_WIDTH))).toBeLessThan(1e-6);
    expect(p.z).toBeCloseTo(100_010, 6);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThan(MAP_WIDTH);
    const q = b.sample(12.5)!;
    expect(q.x).toBeCloseTo(MAP_WIDTH - 5, 6);
  });

  it("interpolates rotation along the shortest arc across ±π", () => {
    const b = new InterpolationBuffer();
    b.push(sample(0, 0, 0, Math.PI - 0.1));
    b.push(sample(50, 0, 0, -Math.PI + 0.1));
    const p = b.sample(25)!;
    expect(Math.abs(Math.abs(p.r) - Math.PI)).toBeLessThan(1e-6);
  });

  it("extrapolates with velocity on underrun for at most MAX_EXTRAPOLATION_MS, then holds", () => {
    const b = new InterpolationBuffer();
    // Heading r=0 → (0, 1); v=-4 (forward) → moves −z at 4 units/frame = 240 units/s.
    b.push(sample(0, 500, 500, 0, -4));
    b.push(sample(50, 500, 488, 0, -4));
    const at100 = b.sample(100)!; // 50 ms past the newest sample
    expect(at100.extrapolated).toBe(true);
    expect(at100.x).toBeCloseTo(500, 6);
    expect(at100.z).toBeCloseTo(488 - 240 * 0.05, 6);
    const atMax = b.sample(50 + MAX_EXTRAPOLATION_MS)!;
    const later = b.sample(50 + MAX_EXTRAPOLATION_MS + 500)!;
    expect(atMax.z).toBeCloseTo(488 - 240 * (MAX_EXTRAPOLATION_MS / 1000), 6);
    // Held: no further movement after the cap.
    expect(later.z).toBeCloseTo(atMax.z, 9);
    expect(later.x).toBeCloseTo(atMax.x, 9);
  });

  it("extrapolation wraps x across the seam and is metric (2x in x at lat 60)", () => {
    const b = new InterpolationBuffer();
    // r = −π/2 → heading (−1, 0); v = −4 (forward) → east (+x)
    b.push(sample(0, MAP_WIDTH - 5, zOfLat(60), -Math.PI / 2, -4));
    const p = b.sample(100)!; // 24 metric units east = 48 coordinate units at lat 60
    expect(p.x).toBeCloseTo(43, 6);
    expect(p.z).toBeCloseTo(zOfLat(60), 6);
  });

  it("does not extrapolate a sunk ship", () => {
    const b = new InterpolationBuffer();
    b.push(sample(0, 500, 500, 0, -4, FLAG_SUNK));
    expect(b.sample(150)!.z).toBe(500);
  });

  it("holds the oldest sample before the buffer starts; ignores out-of-order samples", () => {
    const b = new InterpolationBuffer();
    b.push(sample(100, 1, 1));
    b.push(sample(50, 999, 999));
    expect(b.samples).toHaveLength(1);
    expect(b.sample(0)!.x).toBe(1);
  });

  it("prunes samples older than the one bracketing renderTime", () => {
    const b = new InterpolationBuffer();
    for (let t = 0; t <= 500; t += 50) b.push(sample(t, t, 0));
    b.prune(260);
    expect(b.samples[0].t).toBe(250);
    expect(b.sample(260)!.x).toBeCloseTo(260, 6);
  });
});

describe("RemoteWorld", () => {
  it("bumps version on metadata / membership changes only, not on position updates", () => {
    const w = new RemoteWorld();
    let calls = 0;
    w.subscribe(() => calls++);
    w.onSnapshot(0, [[7, 1, 1, 0, 0, 100, 0]], 0);
    expect(w.renderable()).toHaveLength(0); // no metadata yet
    w.onEnt({ t: "ent", eid: 7, id: "p7", name: "Bob", shipType: "sloop", maxHp: 50 }, 0);
    expect(calls).toBe(1);
    expect(w.renderable().map((e) => e.meta!.name)).toEqual(["Bob"]);
    w.onSnapshot(50, [[7, 2, 2, 0, 0, 100, 0]], 50);
    w.onSnapshot(100, [[7, 3, 3, 0, 0, 90, 0]], 100);
    expect(calls).toBe(1);
    w.onEnt({ t: "ent", eid: 7, id: "p7", name: "Bob", shipType: "sloop", maxHp: 50 }, 100);
    expect(calls).toBe(1); // identical metadata
    w.onSnapshot(150, [[7, 3, 3, 0, 0, 0, FLAG_SUNK]], 150);
    expect(calls).toBe(2); // sunk flag flips → re-render
    w.onGone(7);
    expect(calls).toBe(3);
    expect(w.entities.size).toBe(0);
  });

  it("keeps entities (and metadata) through skipped snapshots; only `gone` removes them", () => {
    const w = new RemoteWorld();
    w.onEnt({ t: "ent", eid: 1, id: "a", name: "A", shipType: "sloop", maxHp: 50 }, 0);
    w.onSnapshot(0, [[1, 1, 1, 0, 0, 50, 0]], 0);
    w.onSnapshot(5000, [], 5000);
    expect(w.renderable()).toHaveLength(1);
    w.onGone(1);
    expect(w.entities.size).toBe(0);
  });
});
