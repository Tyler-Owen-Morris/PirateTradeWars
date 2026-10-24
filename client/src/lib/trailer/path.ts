/**
 * Trailer camera paths (DEV ONLY tooling, see docs/trailer/NOTES.md). Pure maths, no DOM, unit-tested in
 * `__tests__/path.test.ts`. The browser glue is `components/game/useTrailerHooks.ts`.
 *
 * A path is a list of keyframes. Each keyframe has a time `t` (seconds), an `anchor` (the world point
 * the shot is built around) and a camera + look-at position RELATIVE to that anchor, in render units
 * (x east, y up, z south; 1 unit = 100 m, same as the game). Between keyframes the anchor (map-seam
 * aware), camera and look-at are blended with smoothstep, so `evalPath(path, t)` is a pure function of
 * `t` (plus the own ship's pose for ship anchors): the capture script can ask for any `t` and get the
 * same frame every time.
 *
 * `rot: "ship"` on a keyframe rotates its offsets with the own ship's heading (chase / orbit shots that
 * stay behind the ship); the default is world axes (north up).
 */
import { WORLD_C, wrap, wrappedDelta } from "@shared/world/geo";

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type Anchor =
  | { port: string } // port key (e.g. "havana"): its dock if it has one, else the port point
  | { ship: true } // the own ship (resolved on every call, so the shot follows it)
  | { x: number; z: number } // raw world coords
  | { lat: number; lon: number };

export interface Keyframe {
  t: number;
  anchor: Anchor;
  cam: V3;
  look: V3;
  /** "ship": rotate cam/look offsets by the own ship's rotationY. Default "world". */
  rot?: "world" | "ship";
  /** Easing of the segment that STARTS at this keyframe: "smooth" (default, smoothstep) or "linear". */
  ease?: "smooth" | "linear";
}

export interface ShipPose {
  x: number;
  z: number;
  rotationY: number;
}

export interface PathContext {
  /** Port lookup (key or lowercase name) -> world point. */
  port(key: string): { x: number; z: number } | undefined;
  ship(): ShipPose;
}

export interface CamSample {
  fx: number;
  fz: number;
  cam: V3;
  look: V3;
}

export const smoothstep = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/** Latitude/longitude -> raw world coords (equirectangular, shared/world/geo.ts: C = 400000, H = 200000). */
function fromLatLon(lat: number, lon: number): { x: number; z: number } {
  return { x: ((lon + 180) / 360) * WORLD_C, z: ((90 - lat) / 180) * 200_000 };
}

export function resolveAnchor(a: Anchor, ctx: PathContext): { x: number; z: number } {
  if ("port" in a) {
    const p = ctx.port(a.port);
    if (!p) throw new Error(`trailer path: unknown port "${a.port}"`);
    return p;
  }
  if ("ship" in a) {
    const s = ctx.ship();
    return { x: s.x, z: s.z };
  }
  if ("lat" in a) return fromLatLon(a.lat, a.lon);
  return { x: a.x, z: a.z };
}

function rotY(v: V3, r: number): V3 {
  // Same convention as lib/cameraFollow.ts rotatedOffset().
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpV = (a: V3, b: V3, u: number): V3 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });

/** Offsets of a keyframe in render axes (applies the ship rotation if asked). */
function offsets(k: Keyframe, ctx: PathContext): { cam: V3; look: V3 } {
  if (k.rot === "ship") {
    const r = ctx.ship().rotationY;
    return { cam: rotY(k.cam, r), look: rotY(k.look, r) };
  }
  return { cam: k.cam, look: k.look };
}

/** Total length of a path in seconds. */
export function pathDuration(path: readonly Keyframe[]): number {
  return path.length ? path[path.length - 1].t : 0;
}

/** Camera state at time `t` (clamped to the path). Keyframes must be sorted by `t`. */
export function evalPath(path: readonly Keyframe[], t: number, ctx: PathContext): CamSample {
  if (path.length === 0) throw new Error("trailer path: empty");
  let i = 0;
  while (i < path.length - 1 && t >= path[i + 1].t) i++;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const span = b.t - a.t;
  const raw = span > 0 ? (t - a.t) / span : 0;
  const u = a.ease === "linear" ? Math.min(1, Math.max(0, raw)) : smoothstep(raw);
  const pa = resolveAnchor(a.anchor, ctx);
  const pb = resolveAnchor(b.anchor, ctx);
  const oa = offsets(a, ctx);
  const ob = offsets(b, ctx);
  // Blend anchors in raw world units, taking the short way across the map seam (x wraps).
  const fx = wrap(pa.x + wrappedDelta(pa.x, pb.x, WORLD_C) * u, WORLD_C);
  const fz = lerp(pa.z, pb.z, u);
  return { fx, fz, cam: lerpV(oa.cam, ob.cam, u), look: lerpV(oa.look, ob.look, u) };
}
