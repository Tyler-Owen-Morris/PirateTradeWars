import { describe, expect, it } from "vitest";
import {
  WORLD_C,
  WORLD_H,
  Z_ICE_N,
  Z_ICE_S,
  metricX,
  latOfZ,
  toRenderInto,
  setRenderFocus,
  resetRenderFocus,
  inRenderRange,
  RENDER_CULL_DISTANCE,
  type RenderFocus,
} from "../renderSpace";
import { CameraFollow, MAX_FOCUS_ERROR } from "../../cameraFollow";

const EQ = WORLD_H / 2; // equator z
const newFocus = (): RenderFocus => ({ x: 0, z: 0, valid: false, shiftX: 0, shiftZ: 0, travelX: 0, travelZ: 0 });

describe("renderSpace", () => {
  it("spec constants (WORLD_SPEC §2)", () => {
    expect(WORLD_C).toBe(400_000);
    expect(WORLD_H).toBe(200_000);
    expect(Z_ICE_N).toBeCloseTo(22_222.2, 1);
    expect(Z_ICE_S).toBeCloseTo(177_777.8, 1);
    expect(latOfZ(0)).toBe(90);
    expect(latOfZ(EQ)).toBe(0);
    expect(latOfZ(WORLD_H)).toBe(-90);
  });

  it("metricX = cos(lat): 1 at the equator, 0.5 at ±60°, cos70 at the ice lines", () => {
    expect(metricX(EQ)).toBeCloseTo(1, 12);
    const z60n = ((90 - 60) / 180) * WORLD_H;
    const z60s = ((90 + 60) / 180) * WORLD_H;
    expect(metricX(z60n)).toBeCloseTo(0.5, 12);
    expect(metricX(z60s)).toBeCloseTo(0.5, 12);
    expect(metricX(Z_ICE_N)).toBeCloseTo(Math.cos((70 * Math.PI) / 180), 12);
    expect(metricX(0)).toBeGreaterThan(0); // geo clamps to MIN_METRIC_X beyond the ice
    expect(metricX(0)).toBeLessThan(0.02);
  });

  it("own focus renders at the origin", () => {
    const r = toRenderInto(12345.6, 98765.4, { x: 12345.6, z: 98765.4 }, { x: 0, z: 0 });
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.z).toBeCloseTo(0, 9);
  });

  it("seam continuity: a point just across the seam renders adjacent, not C away", () => {
    const out = { x: 0, z: 0 };
    // focus 10 u west of the seam, target 15 u east of it → 25 u east
    toRenderInto(15, EQ, { x: WORLD_C - 10, z: EQ }, out);
    expect(out.x).toBeCloseTo(25, 9);
    expect(out.z).toBe(0);
    // and the other way round
    toRenderInto(WORLD_C - 10, EQ, { x: 15, z: EQ }, out);
    expect(out.x).toBeCloseTo(-25, 9);
    // continuity: sweeping a target across the seam moves the rendered point smoothly
    let prev = toRenderInto(WORLD_C - 50, EQ, { x: WORLD_C - 5, z: EQ }, { x: 0, z: 0 }).x;
    for (let x = WORLD_C - 49; x < WORLD_C + 50; x++) {
      const r = toRenderInto(x % WORLD_C, EQ, { x: WORLD_C - 5, z: EQ }, out).x;
      expect(r - prev).toBeCloseTo(1, 6);
      prev = r;
    }
  });

  it("x offsets are scaled by metricX of the OBJECT's z", () => {
    const z60 = ((90 - 60) / 180) * WORLD_H;
    const out = { x: 0, z: 0 };
    toRenderInto(1000, z60, { x: 0, z: z60 }, out);
    expect(out.x).toBeCloseTo(500, 6);
    // object north of the focus uses its own latitude, not the focus's
    toRenderInto(1000, z60, { x: 0, z: EQ }, out);
    expect(out.x).toBeCloseTo(500, 6);
    expect(out.z).toBeCloseTo(z60 - EQ, 9);
  });

  it("setRenderFocus records the frame shift and accumulates travel, seam-safe", () => {
    const f = newFocus();
    setRenderFocus(WORLD_C - 2, EQ, f);
    expect(f.shiftX).toBe(0); // first set: no shift
    setRenderFocus(3, EQ + 1, f); // crossed the seam eastwards: 5 u, 1 u south
    expect(f.shiftX).toBeCloseTo(5, 6);
    expect(f.shiftZ).toBeCloseTo(1, 9);
    expect(f.x).toBe(3);
    setRenderFocus(WORLD_C + 7, EQ + 1, f); // unwrapped input is normalized
    expect(f.x).toBeCloseTo(7, 9);
    expect(f.travelX).toBeCloseTo(9, 6);
    resetRenderFocus(f);
    setRenderFocus(100_000, EQ, f);
    expect(f.shiftX).toBe(0);
  });

  it("inRenderRange", () => {
    expect(inRenderRange({ x: 0, z: RENDER_CULL_DISTANCE })).toBe(true);
    expect(inRenderRange({ x: 1, z: RENDER_CULL_DISTANCE })).toBe(false);
  });

  it("camera in render space never jumps while the ship crosses the seam", () => {
    const f = newFocus();
    const cam = new CameraFollow();
    const SPEED = 240; // u/s
    const dt = 1 / 60;
    let x = WORLD_C - 300;
    setRenderFocus(x, EQ, f);
    cam.update(0, 0, Math.PI / 2, 0);
    let prevCamX = cam.cam.x;
    let prevCamZ = cam.cam.z;
    for (let i = 0; i < 300; i++) {
      x = (x + SPEED * dt) % WORLD_C;
      setRenderFocus(x, EQ, f);
      cam.shiftOrigin(f.shiftX, f.shiftZ);
      cam.update(0, 0, Math.PI / 2, dt);
      // camera moves (relative to the moving origin) by less than a frame's travel plus easing
      expect(Math.abs(cam.cam.x - prevCamX)).toBeLessThan(SPEED * dt + 1);
      expect(Math.abs(cam.cam.z - prevCamZ)).toBeLessThan(1);
      expect(Math.hypot(cam.focus.x, cam.focus.z)).toBeLessThanOrEqual(MAX_FOCUS_ERROR + 1e-9);
      prevCamX = cam.cam.x;
      prevCamZ = cam.cam.z;
    }
    expect(cam.snaps).toBe(1);
    expect(x).toBeLessThan(1000); // really crossed
  });
});
