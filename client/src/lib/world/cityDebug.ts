/**
 * Dev-only "city camera" (docs/proposals/2026-10-23-cities/NOTES.md). Enabled in Vite dev builds or
 * with `?citydebug=1`; otherwise every hook here is inert.
 *
 * From the browser console (or Playwright):
 *   __cityCam("havana")                         // look at Havana from the sea (its dock side)
 *   __cityCam("havana", { dist: 500, height: 160, yaw: 30 })  // closer, lower, orbit 30 deg
 *   __cityCam(null)                             // back to following the own ship
 *   __cityHide(true)                            // unmount all ports (perf baseline); false = back
 *   __ptwRenderInfo()                           // { calls, triangles, geometries, textures } of the last frame
 *   await __ptwFrameStats(3000)                 // { frames, avgMs, p95Ms } over 3 s
 *
 * While active, Player.tsx uses `cityDebug.fx/fz` as the floating-origin focus (the own ship is drawn
 * there), GameScene places the camera at `cityDebug.cam` looking at `cityDebug.look` (render space,
 * relative to the focus), and `clientLand` loads tiles around the focus instead of the ship.
 */
import { metricX, wrappedDelta, WORLD_C, wrap } from "@shared/world/geo";

export interface CityDebugState {
  enabled: boolean;
  active: boolean;
  /** Raw world focus. */
  fx: number;
  fz: number;
  /** Camera position and look-at target in render space (relative to the focus). */
  cam: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
  /** Dev: unmount every port (Ports.tsx) to measure the scene without them. */
  hidePorts: boolean;
}

const listeners = new Set<() => void>();
/** Subscribe to setCityDebugHidePorts changes (useSyncExternalStore). */
export function subscribeCityDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setCityDebugHidePorts(hide: boolean): void {
  cityDebug.hidePorts = hide;
  listeners.forEach((fn) => fn());
}

function detectEnabled(): boolean {
  try {
    if ((import.meta as any).env?.DEV) return true;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("citydebug") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export const cityDebug: CityDebugState = {
  enabled: detectEnabled(),
  active: false,
  fx: 0,
  fz: 0,
  cam: { x: 0, y: 0, z: 0 },
  look: { x: 0, y: 0, z: 0 },
  hidePorts: false,
};

export interface CityCamPort {
  key?: string;
  name: string;
  x: number;
  z: number;
  dock?: { x: number; z: number };
}

export interface CityCamOptions {
  /** Horizontal metric distance of the camera from the town (default 650). */
  dist?: number;
  /** Camera height (default 200). */
  height?: number;
  /** Orbit the viewpoint around the town by this many degrees from the dock direction (default 0). */
  yaw?: number;
}

/** Point the debug camera at a port's town, from the sea side. Pure apart from writing `state`. */
export function aimCityCam(port: CityCamPort, opts: CityCamOptions = {}, state: CityDebugState = cityDebug): void {
  const dist = opts.dist ?? 650;
  const height = opts.height ?? 200;
  const yaw = ((opts.yaw ?? 0) * Math.PI) / 180;
  const dock = port.dock ?? { x: port.x, z: port.z + 1 };
  const mx = metricX(port.z);
  let ux = wrappedDelta(port.x, dock.x, WORLD_C) * mx;
  let uz = dock.z - port.z;
  const len = Math.hypot(ux, uz) || 1;
  ux /= len;
  uz /= len;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = ux * c - uz * s;
  const rz = ux * s + uz * c;
  state.fx = wrap(port.x + (rx * dist) / mx, WORLD_C);
  state.fz = port.z + rz * dist;
  state.cam = { x: 0, y: height, z: 0 };
  state.look = { x: -rx * dist, y: 0, z: -rz * dist };
  state.active = true;
}
