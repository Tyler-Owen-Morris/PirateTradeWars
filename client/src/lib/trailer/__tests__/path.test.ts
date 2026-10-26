import { describe, expect, it } from "vitest";
import { evalPath, pathDuration, smoothstep, type Keyframe, type PathContext } from "../path";
import { WORLD_C } from "@shared/world/geo";

const ctx: PathContext = {
  port: (k) => (k === "a" ? { x: 100, z: 50 } : k === "b" ? { x: 300, z: 150 } : undefined),
  ship: () => ({ x: 10, z: 20, rotationY: Math.PI / 2 }),
};
const O = { x: 0, y: 0, z: 0 };

describe("trailer path", () => {
  it("is a pure function of t and hits the keyframes", () => {
    const p: Keyframe[] = [
      { t: 0, anchor: { port: "a" }, cam: { x: 0, y: 10, z: 0 }, look: O },
      { t: 2, anchor: { port: "b" }, cam: { x: 0, y: 30, z: 0 }, look: O },
    ];
    expect(pathDuration(p)).toBe(2);
    expect(evalPath(p, 0, ctx).fx).toBe(100);
    expect(evalPath(p, 5, ctx).cam.y).toBe(30);
    const mid = evalPath(p, 1, ctx);
    expect(mid).toEqual(evalPath(p, 1, ctx));
    expect(mid.fx).toBeCloseTo(200);
    expect(mid.cam.y).toBeCloseTo(20);
    expect(smoothstep(0.5)).toBe(0.5);
  });
  it("blends across the map seam the short way", () => {
    const c2: PathContext = { ...ctx, port: (k) => ({ x: k === "a" ? WORLD_C - 10 : 10, z: 0 }) };
    const p: Keyframe[] = [
      { t: 0, anchor: { port: "a" }, cam: O, look: O },
      { t: 1, anchor: { port: "b" }, cam: O, look: O },
    ];
    const m = evalPath(p, 0.5, c2).fx;
    expect(Math.min(m, WORLD_C - m)).toBeLessThan(1);
  });
  it("rotates ship-relative offsets and follows the ship", () => {
    const p: Keyframe[] = [{ t: 0, anchor: { ship: true }, cam: { x: 0, y: 5, z: 100 }, look: O, rot: "ship" }];
    const s = evalPath(p, 0, ctx);
    expect(s.fx).toBe(10);
    expect(s.cam.x).toBeCloseTo(100);
    expect(s.cam.z).toBeCloseTo(0);
  });
  it("rejects unknown ports", () => {
    expect(() => evalPath([{ t: 0, anchor: { port: "zz" }, cam: O, look: O }], 0, ctx)).toThrow(/unknown port/);
  });
});
