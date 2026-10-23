/**
 * Tiny low-poly mesh builder for the port-city kit (README.md next to this file). Framework-free and
 * allocation-light: pieces append flat-shaded triangles with per-vertex sRGB colours into number
 * arrays; `finish()` packs them into typed arrays for ONE BufferGeometry per city layer.
 *
 * - Coordinates are in a local "frame" (origin + yaw about +Y) that pieces push/pop, so a piece is
 *   written once in its own axes (x = width, z = depth, y = up) and placed anywhere.
 * - Winding is fixed automatically: every polygon is given a point INSIDE the solid it bounds and is
 *   flipped if its normal faces that point. Pieces never think about CCW order.
 * - Normals are per triangle (flat shading, the stylised look) and written by `finish()`.
 * - An optional per-vertex `wave` weight (0 = rigid) drives the flag shader (cityMaterial.ts).
 */

export type RGB = readonly [number, number, number];
export type V3 = readonly [number, number, number];

const hexCache = new Map<string, RGB>();

/** "#rrggbb" -> sRGB triple in [0, 1] (cached). */
export function hex(c: string): RGB {
  let v = hexCache.get(c);
  if (!v) {
    const n = parseInt(c.slice(1), 16);
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    hexCache.set(c, v);
  }
  return v;
}

/** Multiply a colour (clamped). */
export function shade(c: RGB, f: number): RGB {
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface BuiltLayer {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Present only if any vertex has a non-zero wave weight. */
  wave: Float32Array | null;
  triangles: number;
}

interface Frame {
  ox: number;
  oy: number;
  oz: number;
  c: number;
  s: number;
}

export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private wav: number[] = [];
  private anyWave = false;
  private f: Frame = { ox: 0, oy: 0, oz: 0, c: 1, s: 0 };
  private stack: Frame[] = [];

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** Enter a child frame at local (x, y, z), rotated by `yaw` radians about +Y. */
  push(x: number, y: number, z: number, yaw = 0): this {
    const f = this.f;
    this.stack.push(f);
    const [wx, wz] = this.rot(x, z);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.f = { ox: f.ox + wx, oy: f.oy + y, oz: f.oz + wz, c: f.c * c - f.s * s, s: f.s * c + f.c * s };
    return this;
  }

  pop(): this {
    const f = this.stack.pop();
    if (f) this.f = f;
    return this;
  }

  /** Rotate a local (x, z) by the current frame's yaw (three.js convention: +yaw turns +x toward −z). */
  private rot(x: number, z: number): [number, number] {
    const { c, s } = this.f;
    return [x * c + z * s, -x * s + z * c];
  }

  /** Local point -> builder (city) coordinates. */
  toCity(x: number, y: number, z: number): [number, number, number] {
    const [rx, rz] = this.rot(x, z);
    return [this.f.ox + rx, this.f.oy + y, this.f.oz + rz];
  }

  /**
   * Convex (or star-shaped about its first vertex) polygon in local coordinates. `inside` is any point
   * on the inner side; the polygon is flipped if it faces it. `waves` = per-vertex wave weights.
   */
  poly(pts: V3[], color: RGB, inside: V3, waves?: number[]): this {
    if (pts.length < 3) return this;
    const w = pts.map((p) => this.toCity(p[0], p[1], p[2]));
    const ins = this.toCity(inside[0], inside[1], inside[2]);
    // polygon normal (Newell) and centroid
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < w.length; i++) {
      const a = w[i];
      const b = w[(i + 1) % w.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0];
      cy += a[1];
      cz += a[2];
    }
    cx /= w.length;
    cy /= w.length;
    cz /= w.length;
    const flip = nx * (cx - ins[0]) + ny * (cy - ins[1]) + nz * (cz - ins[2]) < 0;
    const order = w.map((_, i) => i);
    if (flip) order.reverse();
    for (let i = 1; i + 1 < order.length; i++) {
      for (const k of [order[0], order[i], order[i + 1]]) {
        const p = w[k];
        this.pos.push(p[0], p[1], p[2]);
        this.col.push(color[0], color[1], color[2]);
        const wv = waves ? waves[k] : 0;
        this.wav.push(wv);
        if (wv) this.anyWave = true;
      }
    }
    return this;
  }

  /** Same polygon, both faces (thin things: sails, leaves, flags). */
  poly2(pts: V3[], color: RGB, waves?: number[]): this {
    // a point just off the plane on either side
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const e = 0.01 / l;
    this.poly(pts, color, [a[0] + nx * e, a[1] + ny * e, a[2] + nz * e], waves);
    this.poly(pts, color, [a[0] - nx * e, a[1] - ny * e, a[2] - nz * e], waves);
    return this;
  }

  /** Axis-aligned box: x/z centred on (cx, cz), y from y0 to y0+h. No bottom face unless asked. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: RGB, opts: { top?: RGB | false; bottom?: boolean; sideShade?: number } = {}): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const ins: V3 = [cx, y0 + h / 2, cz];
    const side = opts.sideShade ? shade(color, opts.sideShade) : color;
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, ins);
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], color, ins);
    this.poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], side, ins);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side, ins);
    if (opts.top !== false) this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], opts.top ?? color, ins);
    if (opts.bottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], color, ins);
    return this;
  }

  /** Box between two points on the ground plane (a beam/wall segment), y from y0 to y0+h, thickness t. */
  segment(ax: number, az: number, bx: number, bz: number, y0: number, h: number, t: number, color: RGB, top?: RGB): this {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return this;
    const yaw = Math.atan2(-(bz - az), bx - ax);
    this.push((ax + bx) / 2, 0, (az + bz) / 2, yaw);
    this.box(0, y0, 0, len, h, t, color, { top: top ?? color });
    return this.pop();
  }

  /**
   * Frustum / prism around +Y: `n` sides, radius r0 at y0 to r1 at y0+h (r1 = 0: cone).
   * `cap` adds the top (and `bottom` the bottom) face.
   */
  prism(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, n: number, color: RGB, opts: { cap?: RGB | false; bottom?: boolean; phase?: number } = {}): this {
    const ph = opts.phase ?? Math.PI / n;
    const ins: V3 = [cx, y0 + h * 0.3, cz];
    const ring = (r: number, y: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < n; i++) {
        const a = ph + (i / n) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      return out;
    };
    const lo = ring(r0, y0);
    const hi = ring(r1, y0 + h);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (r1 > 1e-4) this.poly([lo[i], lo[j], hi[j], hi[i]], color, ins);
      else this.poly([lo[i], lo[j], [cx, y0 + h, cz]], color, ins);
    }
    if (r1 > 1e-4 && opts.cap !== false) this.poly(hi, opts.cap ?? color, ins);
    if (opts.bottom) this.poly(lo, color, ins);
    return this;
  }

  /** Hipped roof (or pyramid when the plan is square): eave rectangle w × d at y0 (+ overhang), ridge `rise` up. */
  hip(cx: number, y0: number, cz: number, w: number, d: number, rise: number, oh: number, color: RGB, under?: RGB): this {
    const W = w / 2 + oh, D = d / 2 + oh;
    const drop = oh * (rise / Math.max(1, Math.min(w, d) / 2));
    const ye = y0 - drop;
    const yr = y0 + rise;
    const ins: V3 = [cx, y0, cz];
    const alongX = w >= d;
    const r = alongX ? (w - d) / 2 : (d - w) / 2;
    if (alongX) {
      const a: V3 = [cx - r, yr, cz], b: V3 = [cx + r, yr, cz];
      this.poly([[cx - W, ye, cz + D], [cx + W, ye, cz + D], b, a], color, ins);
      this.poly([[cx - W, ye, cz - D], [cx + W, ye, cz - D], b, a], color, ins);
      this.poly([[cx + W, ye, cz - D], [cx + W, ye, cz + D], b], color, ins);
      this.poly([[cx - W, ye, cz - D], [cx - W, ye, cz + D], a], color, ins);
    } else {
      const a: V3 = [cx, yr, cz - r], b: V3 = [cx, yr, cz + r];
      this.poly([[cx + W, ye, cz - D], [cx + W, ye, cz + D], b, a], color, ins);
      this.poly([[cx - W, ye, cz - D], [cx - W, ye, cz + D], b, a], color, ins);
      this.poly([[cx - W, ye, cz + D], [cx + W, ye, cz + D], b], color, ins);
      this.poly([[cx - W, ye, cz - D], [cx + W, ye, cz - D], a], color, ins);
    }
    if (oh > 0) this.poly([[cx - W, ye, cz - D], [cx + W, ye, cz - D], [cx + W, ye, cz + D], [cx - W, ye, cz + D]], under ?? shade(color, 0.6), [cx, ye + 1, cz]);
    return this;
  }

  /**
   * Gable roof, ridge along local x: two slopes over w × d (+ overhang `oh` at the eaves and `ohEnd`
   * past the gable ends) and two triangular gable walls in `wall` colour.
   */
  gable(cx: number, y0: number, cz: number, w: number, d: number, rise: number, oh: number, color: RGB, wall: RGB, ohEnd = oh * 0.5): this {
    const W = w / 2, X = W + ohEnd, D = d / 2 + oh;
    const ye = y0 - oh * (rise / Math.max(1, d / 2));
    const yr = y0 + rise;
    const ins: V3 = [cx, y0 + rise * 0.3, cz];
    this.poly([[cx - X, ye, cz + D], [cx + X, ye, cz + D], [cx + X, yr, cz], [cx - X, yr, cz]], color, ins);
    this.poly([[cx - X, ye, cz - D], [cx + X, ye, cz - D], [cx + X, yr, cz], [cx - X, yr, cz]], color, ins);
    this.poly([[cx + W, y0, cz - d / 2], [cx + W, y0, cz + d / 2], [cx + W, yr - 0.05, cz]], wall, ins);
    this.poly([[cx - W, y0, cz - d / 2], [cx - W, y0, cz + d / 2], [cx - W, yr - 0.05, cz]], wall, ins);
    // underside of the eaves
    const under = shade(color, 0.55);
    this.poly([[cx - X, ye, cz - D], [cx + X, ye, cz - D], [cx + X, ye, cz + D], [cx - X, ye, cz + D]], under, [cx, ye + 1, cz]);
    return this;
  }

  /** Mono-pitch (lean-to) roof over w × d: high at −z, low at +z. */
  shed(cx: number, y0: number, cz: number, w: number, d: number, rise: number, oh: number, color: RGB, wall: RGB): this {
    const X = w / 2 + oh, D = d / 2 + oh;
    const ins: V3 = [cx, y0 - 1, cz];
    const yHi = y0 + rise, yLo = y0 - oh * (rise / d);
    this.poly([[cx - X, yHi + oh * (rise / d), cz - D], [cx + X, yHi + oh * (rise / d), cz - D], [cx + X, yLo, cz + D], [cx - X, yLo, cz + D]], color, ins);
    this.poly([[cx - X, yHi + oh * (rise / d), cz - D], [cx + X, yHi + oh * (rise / d), cz - D], [cx + X, yLo, cz + D], [cx - X, yLo, cz + D]], shade(color, 0.55), [cx, yHi + 5, cz]);
    // triangular side walls + the high back wall
    const W = w / 2;
    this.poly([[cx + W, y0, cz - d / 2], [cx + W, y0, cz + d / 2], [cx + W, y0 + rise, cz - d / 2]], wall, [cx, y0, cz]);
    this.poly([[cx - W, y0, cz - d / 2], [cx - W, y0, cz + d / 2], [cx - W, y0 + rise, cz - d / 2]], wall, [cx, y0, cz]);
    this.poly([[cx - W, y0, cz - d / 2], [cx + W, y0, cz - d / 2], [cx + W, y0 + rise, cz - d / 2], [cx - W, y0 + rise, cz - d / 2]], wall, [cx, y0, cz]);
    return this;
  }

  /** Low-poly dome (hemisphere) of radius r on y0, `n` sides, `rings` latitude bands. */
  dome(cx: number, y0: number, cz: number, r: number, n: number, rings: number, color: RGB, squash = 1): this {
    const ins: V3 = [cx, y0 + r * 0.2, cz];
    for (let k = 0; k < rings; k++) {
      const a0 = (k / rings) * (Math.PI / 2), a1 = ((k + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(a0) * r, r1 = Math.cos(a1) * r;
      const y0k = y0 + Math.sin(a0) * r * squash, y1k = y0 + Math.sin(a1) * r * squash;
      for (let i = 0; i < n; i++) {
        const b0 = (i / n) * Math.PI * 2, b1 = ((i + 1) / n) * Math.PI * 2;
        const p00: V3 = [cx + Math.cos(b0) * r0, y0k, cz + Math.sin(b0) * r0];
        const p01: V3 = [cx + Math.cos(b1) * r0, y0k, cz + Math.sin(b1) * r0];
        if (k === rings - 1) this.poly([p00, p01, [cx, y1k, cz]], color, ins);
        else this.poly([p00, p01, [cx + Math.cos(b1) * r1, y1k, cz + Math.sin(b1) * r1], [cx + Math.cos(b0) * r1, y1k, cz + Math.sin(b0) * r1]], color, ins);
      }
    }
    return this;
  }

  /**
   * Extruded closed outline (star-shaped about its centroid), walls battered inward by `batter` at the
   * top. Fills the top. Used for forts, bastions, platforms.
   */
  extrude(outline: [number, number][], y0: number, h: number, color: RGB, top: RGB, batter = 0): this {
    const n = outline.length;
    let cx = 0, cz = 0;
    for (const p of outline) {
      cx += p[0];
      cz += p[1];
    }
    cx /= n;
    cz /= n;
    const topPts: V3[] = outline.map(([x, z]) => {
      const dx = x - cx, dz = z - cz;
      const l = Math.hypot(dx, dz) || 1;
      const k = Math.max(0, l - batter) / l;
      return [cx + dx * k, y0 + h, cz + dz * k];
    });
    const ins: V3 = [cx, y0 + h / 2, cz];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([[outline[i][0], y0, outline[i][1]], [outline[j][0], y0, outline[j][1]], topPts[j], topPts[i]], color, ins);
    }
    // top as a fan from the centroid (works for star-shaped outlines)
    const c: V3 = [cx, y0 + h, cz];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([c, topPts[i], topPts[j]], top, [cx, y0, cz]);
    }
    return this;
  }

  /** Rectangle decal on a box face (windows, doors): face 0 = +z, 1 = −z, 2 = +x, 3 = −x. */
  decal(cx: number, cz: number, w: number, d: number, face: 0 | 1 | 2 | 3, u0: number, u1: number, v0: number, v1: number, color: RGB, off = 0.12): this {
    if (face === 0 || face === 1) {
      const z = cz + (face === 0 ? d / 2 + off : -d / 2 - off);
      this.poly([[cx + u0, v0, z], [cx + u1, v0, z], [cx + u1, v1, z], [cx + u0, v1, z]], color, [cx, (v0 + v1) / 2, cz]);
    } else {
      const x = cx + (face === 2 ? w / 2 + off : -w / 2 - off);
      this.poly([[x, v0, cz + u0], [x, v0, cz + u1], [x, v1, cz + u1], [x, v1, cz + u0]], color, [cx, (v0 + v1) / 2, cz]);
    }
    return this;
  }

  finish(): BuiltLayer {
    const position = new Float32Array(this.pos);
    const color = new Float32Array(this.col);
    const normal = new Float32Array(position.length);
    for (let i = 0; i < position.length; i += 9) {
      const ux = position[i + 3] - position[i], uy = position[i + 4] - position[i + 1], uz = position[i + 5] - position[i + 2];
      const vx = position[i + 6] - position[i], vy = position[i + 7] - position[i + 1], vz = position[i + 8] - position[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      for (let k = 0; k < 3; k++) {
        normal[i + k * 3] = nx;
        normal[i + k * 3 + 1] = ny;
        normal[i + k * 3 + 2] = nz;
      }
    }
    return { position, normal, color, wave: this.anyWave ? new Float32Array(this.wav) : null, triangles: position.length / 9 };
  }
}
