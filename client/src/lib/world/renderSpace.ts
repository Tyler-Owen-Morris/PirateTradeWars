/**
 * Floating-origin render space (WORLD_SPEC §7). Framework-free; unit-tested in `__tests__/renderSpace.test.ts`.
 *
 * The scene origin is the camera focus F = the own ship's predicted render position (raw world
 * coordinates). Every world object at (x, z) is drawn at
 *     rx = wrappedDelta(F.x, x, C) * metricX(z)
 *     rz = z − F.z
 * so the own ship sits at (0, 0), the wrap seam is invisible (a point just across it renders next to
 * you, not C away), and float32 precision never degrades. metricX is evaluated per object (per vertex
 * for terrain), not at F, so rendered contacts match the metric physics.
 *
 * Usage:
 *  - Player.tsx (useFrame priority −1, right after prediction) calls `setRenderFocus(x, z)` once per
 *    frame. Everything else (priority 0) calls `toRender(x, z)` / `toRenderInto(...)`.
 *  - `renderFocus.shiftX/shiftZ` = where this frame's F was in LAST frame's render space. The camera
 *    (GameScene + CameraFollow.shiftOrigin) subtracts it so its smoothing state carries across frames.
 *  - `renderFocus.travelX/travelZ` = accumulated rendered travel of F (float64). The ocean samples its
 *    wave pattern at (renderPos + travel) so waves stay put in the world while the plane follows us.
 */
import { WORLD_C, WORLD_H, Z_ICE_N, Z_ICE_S, ICE_LAT, metricX, latOf, wrap, wrappedDelta } from "@shared/world/geo";

// Re-exported so renderers import everything world-geometric from one place.
export { WORLD_C, WORLD_H, Z_ICE_N, Z_ICE_S, ICE_LAT, metricX, wrappedDelta };
/** Latitude (degrees) of coordinate z (= geo.latOf). */
export const latOfZ = latOf;

/** Camera far plane (App.tsx). Objects beyond ~this from the origin are not drawn. */
export const CAMERA_FAR = 2500;
/** y where objects wait (out of sight, below the ocean) until their first useFrame places them. */
export const PARKED_Y = -1000;
/** Render-space distance beyond which world props (ports, gold) are hidden. */
export const RENDER_CULL_DISTANCE = CAMERA_FAR + 500;

export interface RenderFocus {
  /** Raw world coordinates of the focus (own predicted ship). */
  x: number;
  z: number;
  /** True once a focus has been set this session. */
  valid: boolean;
  /** This frame's focus expressed in last frame's render space (0 on the first set). */
  shiftX: number;
  shiftZ: number;
  /** Accumulated rendered travel of the focus (float64; for stable world-anchored patterns). */
  travelX: number;
  travelZ: number;
}

/** The app-wide focus, written by Player.tsx every frame. */
export const renderFocus: RenderFocus = { x: 0, z: 0, valid: false, shiftX: 0, shiftZ: 0, travelX: 0, travelZ: 0 };

export interface RenderXZ {
  x: number;
  z: number;
}

/** Render-space position of world point (x, z) relative to `focus`. Writes into `out`. */
export function toRenderInto(x: number, z: number, focus: { x: number; z: number }, out: RenderXZ): RenderXZ {
  out.x = wrappedDelta(focus.x, x, WORLD_C) * metricX(z);
  out.z = z - focus.z;
  return out;
}

const tmp: RenderXZ = { x: 0, z: 0 };

/**
 * Render-space position of (x, z) relative to the app focus. Returns a SHARED scratch object unless
 * `out` is given: copy the fields before the next call.
 */
export function toRender(x: number, z: number, out: RenderXZ = tmp): RenderXZ {
  return toRenderInto(x, z, renderFocus, out);
}

/** Move the focus to world (x, z) and record the frame-to-frame shift (see RenderFocus). */
export function setRenderFocus(x: number, z: number, focus: RenderFocus = renderFocus): void {
  if (focus.valid) {
    toRenderInto(x, z, focus, tmp); // new F in the old frame
    focus.shiftX = tmp.x;
    focus.shiftZ = tmp.z;
    focus.travelX += tmp.x;
    focus.travelZ += tmp.z;
  } else {
    focus.shiftX = 0;
    focus.shiftZ = 0;
  }
  focus.x = wrap(x, WORLD_C);
  focus.z = z;
  focus.valid = true;
}

/** Forget the focus (next set records no shift). */
export function resetRenderFocus(focus: RenderFocus = renderFocus): void {
  focus.valid = false;
  focus.shiftX = focus.shiftZ = 0;
}

/** True if a render-space point is within RENDER_CULL_DISTANCE of the origin. */
export function inRenderRange(r: RenderXZ, dist = RENDER_CULL_DISTANCE): boolean {
  return r.x * r.x + r.z * r.z <= dist * dist;
}
