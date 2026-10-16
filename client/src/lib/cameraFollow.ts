/**
 * Chase camera for the own ship (framework-free; GameScene.tsx copies the result onto the Three
 * camera every frame). Unit-tested in `__tests__/cameraFollow.test.ts`.
 *
 * Two smoothed points, both frame-rate independent (`t = 1 − exp(−k·dt)`):
 *  - `focus`  — where the camera looks; chases the rendered (predicted) ship at FOCUS_RATE and is
 *               never more than MAX_FOCUS_ERROR units behind it, so the ship stays near screen centre
 *               even at 9 fps or after a render hitch.
 *  - `cam`    — camera position; chases `focus + CAMERA_OFFSET` (offset rotated by the ship's heading)
 *               at CAMERA_RATE, at most MAX_CAMERA_ERROR away from that target.
 * The rates reproduce the old per-frame lerps (0.1 / 0.05) exactly at 60 fps.
 *
 * Snaps (no easing) on the first update, after `requestSnap()` (GameScene calls it on net `spawned`,
 * i.e. first snapshot after join / reconnect / respawn) and whenever the ship is > SNAP_DISTANCE from
 * the focus (wrap-aware). Map seam: all state is kept in the ship's coordinate frame — when the ship
 * wraps, focus and camera are shifted by the same multiple of the map size, so nothing flies across.
 */
import { wrappedDelta } from "@shared/physics";
import { MAP_HEIGHT, MAP_WIDTH } from "@shared/gameConstants";

/** Camera offset from the focus in the ship's local frame (behind and above). */
export const CAMERA_OFFSET = { x: 0, y: 250, z: 400 } as const;
/** Focus chase rate (1/s); equals a per-frame lerp of 0.1 at 60 fps. */
export const FOCUS_RATE = -60 * Math.log(1 - 0.1);
/** Camera chase rate (1/s); equals a per-frame lerp of 0.05 at 60 fps. */
export const CAMERA_RATE = -60 * Math.log(1 - 0.05);
/** The focus is never further than this (world units) from the ship. */
export const MAX_FOCUS_ERROR = 100;
/** The camera is never further than this (world units, 3D) from focus + rotated offset. */
export const MAX_CAMERA_ERROR = 400;
/** Ship further than this from the focus (teleport, respawn, reconnect) → snap instead of easing. */
export const SNAP_DISTANCE = 500;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Frame-rate independent smoothing factor for a chase rate `k` (1/s) over `dtSec`. */
export function smoothingFactor(k: number, dtSec: number): number {
  return 1 - Math.exp(-k * Math.max(0, dtSec));
}

/** CAMERA_OFFSET rotated about +Y by `rotationY` (same as Vector3.applyQuaternion of a Y rotation). */
export function rotatedOffset(rotationY: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  out.x = CAMERA_OFFSET.x * c + CAMERA_OFFSET.z * s;
  out.y = CAMERA_OFFSET.y;
  out.z = -CAMERA_OFFSET.x * s + CAMERA_OFFSET.z * c;
  return out;
}

export class CameraFollow {
  readonly focus: Vec3 = { x: 0, y: 0, z: 0 };
  readonly cam: Vec3 = { x: 0, y: 0, z: 0 };
  /** Count of snaps (diagnostics / tests). */
  snaps = 0;
  private initialized = false;
  private snapRequested = false;
  private readonly off: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly mapWidth: number = MAP_WIDTH,
    private readonly mapHeight: number = MAP_HEIGHT,
  ) {}

  /** Jump straight to the ship on the next update (spawn / reconnect). */
  requestSnap(): void {
    this.snapRequested = true;
  }

  /**
   * Advance by `dtSec` towards the ship's rendered pose (`x`,`z` world units as drawn,
   * `rotationY` radians). Afterwards read `cam` (camera position) and `focus` (lookAt target).
   */
  update(shipX: number, shipZ: number, rotationY: number, dtSec: number): void {
    const off = rotatedOffset(rotationY, this.off);
    const dx = wrappedDelta(this.focus.x, shipX, this.mapWidth);
    const dz = wrappedDelta(this.focus.z, shipZ, this.mapHeight);

    if (!this.initialized || this.snapRequested || Math.hypot(dx, dz) > SNAP_DISTANCE) {
      this.focus.x = shipX;
      this.focus.y = 0;
      this.focus.z = shipZ;
      this.cam.x = shipX + off.x;
      this.cam.y = off.y;
      this.cam.z = shipZ + off.z;
      this.initialized = true;
      this.snapRequested = false;
      this.snaps++;
      return;
    }

    // Seam: re-express focus/camera in the ship's coordinate frame (shift by a multiple of the map).
    const shiftX = shipX - (this.focus.x + dx);
    const shiftZ = shipZ - (this.focus.z + dz);
    if (shiftX !== 0 || shiftZ !== 0) {
      this.focus.x += shiftX;
      this.focus.z += shiftZ;
      this.cam.x += shiftX;
      this.cam.z += shiftZ;
    }

    // Focus chases the ship, bounded lag.
    const tf = smoothingFactor(FOCUS_RATE, dtSec);
    let ex = (shipX - this.focus.x) * (1 - tf);
    let ez = (shipZ - this.focus.z) * (1 - tf);
    const e = Math.hypot(ex, ez);
    if (e > MAX_FOCUS_ERROR) {
      ex *= MAX_FOCUS_ERROR / e;
      ez *= MAX_FOCUS_ERROR / e;
    }
    this.focus.x = shipX - ex;
    this.focus.z = shipZ - ez;

    // Camera chases focus + offset, bounded lag.
    const tx = this.focus.x + off.x;
    const ty = this.focus.y + off.y;
    const tz = this.focus.z + off.z;
    const tc = smoothingFactor(CAMERA_RATE, dtSec);
    let cx = (this.cam.x - tx) * (1 - tc);
    let cy = (this.cam.y - ty) * (1 - tc);
    let cz = (this.cam.z - tz) * (1 - tc);
    const c = Math.hypot(cx, cy, cz);
    if (c > MAX_CAMERA_ERROR) {
      cx *= MAX_CAMERA_ERROR / c;
      cy *= MAX_CAMERA_ERROR / c;
      cz *= MAX_CAMERA_ERROR / c;
    }
    this.cam.x = tx + cx;
    this.cam.y = ty + cy;
    this.cam.z = tz + cz;
  }
}
