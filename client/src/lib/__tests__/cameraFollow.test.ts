import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import {
  CAMERA_OFFSET,
  CAMERA_RATE,
  CameraFollow,
  FOCUS_RATE,
  MAX_CAMERA_ERROR,
  MAX_FOCUS_ERROR,
  rotatedOffset,
  smoothingFactor,
} from "../cameraFollow";

const W = 10000;
const SPEED = 240; // sloop top speed, units/s (4 u per 1/60 s)

describe("CameraFollow", () => {
  it("smoothing rates reproduce the old per-frame lerps at 60 fps", () => {
    expect(smoothingFactor(FOCUS_RATE, 1 / 60)).toBeCloseTo(0.1, 10);
    expect(smoothingFactor(CAMERA_RATE, 1 / 60)).toBeCloseTo(0.05, 10);
  });

  it("rotatedOffset matches Vector3.applyQuaternion of a Y rotation", () => {
    for (const r of [0, 0.7, -2.1, Math.PI]) {
      const v = new Vector3(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z).applyQuaternion(
        new Quaternion().setFromEuler(new Euler(0, r, 0)),
      );
      const o = rotatedOffset(r);
      expect(o.x).toBeCloseTo(v.x, 6);
      expect(o.y).toBeCloseTo(v.y, 6);
      expect(o.z).toBeCloseTo(v.z, 6);
    }
  });

  it("snaps onto the ship on the first update and after requestSnap()", () => {
    const f = new CameraFollow();
    f.update(1234, 5678, 0, 0.016);
    expect(f.focus).toMatchObject({ x: 1234, z: 5678 });
    expect(f.cam).toMatchObject({ x: 1234, y: CAMERA_OFFSET.y, z: 5678 + CAMERA_OFFSET.z });
    f.requestSnap();
    f.update(1300, 5678, 0, 0.016); // only 66 u away, but a snap was requested (respawn)
    expect(f.focus.x).toBe(1300);
    expect(f.snaps).toBe(2);
  });

  it("snaps when the ship is > 500 u away (reconnect), wrap-aware", () => {
    const f = new CameraFollow();
    f.update(100, 100, 0, 0.016);
    f.update(4000, 100, 0, 0.016);
    expect(f.focus.x).toBe(4000);
    expect(f.snaps).toBe(2);
    // across the seam 9990 → 10 is a 20 u move, not a 9980 u jump: no snap
    f.update(9990, 100, 0, 0.016);
    const snaps = f.snaps;
    f.update(10, 100, 0, 0.016);
    expect(f.snaps).toBe(snaps);
    expect(Math.abs(f.focus.x - 10)).toBeLessThan(25); // re-expressed in the ship's frame
    expect(Math.abs(f.cam.x - 10)).toBeLessThan(1000);
  });

  it("keeps the ship in view at 9 fps with hitches: focus lag ≤ MAX_FOCUS_ERROR", () => {
    const f = new CameraFollow();
    let x = 1000;
    f.update(x, 500, Math.PI / 2, 0);
    const dts = [0.111, 0.111, 0.6, 0.111, 0.35, 0.111, 0.111, 0.25, 0.111];
    for (let i = 0; i < 200; i++) {
      const dt = dts[i % dts.length];
      x = (x + SPEED * dt) % W;
      f.update(x, 500, Math.PI / 2, dt);
      const lag = Math.abs(((x - f.focus.x + W / 2) % W + W) % W - W / 2);
      expect(lag).toBeLessThanOrEqual(MAX_FOCUS_ERROR + 1e-9);
      const off = rotatedOffset(Math.PI / 2);
      const camErr = Math.hypot(f.cam.x - (f.focus.x + off.x), f.cam.y - off.y, f.cam.z - (f.focus.z + off.z));
      expect(camErr).toBeLessThanOrEqual(MAX_CAMERA_ERROR + 1e-9);
    }
  });

  it("is frame-rate independent: 60 fps and 10 fps end at nearly the same lag", () => {
    const run = (fps: number) => {
      const f = new CameraFollow();
      let x = 1000;
      f.update(x, 500, 0, 0);
      const dt = 1 / fps;
      for (let t = 0; t < 2; t += dt) {
        x += 30 * dt; // slow enough not to hit the clamp
        f.update(x, 500, 0, dt);
      }
      return x - f.focus.x;
    };
    // (the old per-frame lerp(0.1) lagged ~4.5 u at 60 fps but ~27 u at 10 fps)
    expect(Math.abs(run(60) - run(10))).toBeLessThan(2);
  });
});
