/**
 * Remote-ship interpolation (PROTOCOL §7). Framework-free.
 *
 * Each remote entity (eid) has an InterpolationBuffer of timestamped samples (server time `st`, ms).
 * The renderer samples it at `renderTime = serverNow − INTERP_DELAY_MS`:
 *   - between two samples → lerp of x across the wrap seam (`lerpWrapped`, x only — z does not wrap),
 *     plain lerp of z, and shortest-arc `lerpAngle` of r;
 *   - past the newest sample (underrun) → extrapolate along the heading with the last velocity for at
 *     most MAX_EXTRAPOLATION_MS (metric motion: x advances by v·sin r / metricX(z)), then hold;
 *   - before the oldest sample → hold the oldest.
 *
 * `RemoteWorld` owns the buffers plus entity metadata from `ent` / `gone`, and exposes a
 * `version` counter that bumps only when the set of renderable entities or their metadata changes —
 * React subscribes to that, never to positions.
 */
import { lerpAngle, lerpWrapped, FRAMES_PER_SECOND } from "@shared/physics";
import { WORLD_C, clampZ, metricX, wrap } from "@shared/world/geo";
import {
  MAX_EXTRAPOLATION_MS,
  FLAG_SUNK,
  type EntityRow,
  type EntMessage,
} from "@shared/protocol";

export interface RemoteSample {
  /** server time (ms) */
  t: number;
  x: number;
  z: number;
  r: number;
  v: number;
  hp: number;
  flags: number;
}

export interface RemotePose {
  x: number;
  z: number;
  r: number;
  v: number;
  hp: number;
  flags: number;
  /** true when the pose is extrapolated or held past the newest sample */
  extrapolated: boolean;
}

/** Max samples kept per entity (~1.5 s at 20 Hz). */
export const MAX_SAMPLES = 32;

export class InterpolationBuffer {
  samples: RemoteSample[] = [];

  /** Add a sample. Out-of-order or duplicate timestamps are ignored. */
  push(s: RemoteSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) {
      if (s.t === last.t) this.samples[this.samples.length - 1] = s;
      return;
    }
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  get latest(): RemoteSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Drop samples that can no longer be needed for `renderTime` (keeps one at/before it). */
  prune(renderTime: number): void {
    let i = 0;
    while (i + 1 < this.samples.length && this.samples[i + 1].t <= renderTime) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  /** Pose at `renderTime` (server ms). Returns null if the buffer is empty. */
  sample(renderTime: number, out?: RemotePose): RemotePose | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const o: RemotePose = out ?? { x: 0, z: 0, r: 0, v: 0, hp: 0, flags: 0, extrapolated: false };
    const first = this.samples[0];
    const last = this.samples[n - 1];

    if (renderTime <= first.t) {
      return assign(o, first, false);
    }

    if (renderTime >= last.t) {
      // Underrun: extrapolate with velocity for at most MAX_EXTRAPOLATION_MS, then hold.
      const dtMs = Math.min(renderTime - last.t, MAX_EXTRAPOLATION_MS);
      assign(o, last, renderTime > last.t);
      if (dtMs > 0 && last.v !== 0 && !(last.flags & FLAG_SUNK)) {
        const dist = last.v * FRAMES_PER_SECOND * (dtMs / 1000);
        o.z = clampZ(last.z + Math.cos(last.r) * dist);
        o.x = wrap(last.x + (Math.sin(last.r) * dist) / metricX(o.z), WORLD_C);
      }
      return o;
    }

    // Find a, b with a.t <= renderTime < b.t (buffers are short; linear scan from the end).
    let j = n - 1;
    while (j > 0 && this.samples[j - 1].t > renderTime) j--;
    const a = this.samples[j - 1];
    const b = this.samples[j];
    const span = b.t - a.t;
    const t = span > 0 ? (renderTime - a.t) / span : 1;
    o.x = lerpWrapped(a.x, b.x, t, WORLD_C);
    o.z = a.z + (b.z - a.z) * t;
    o.r = lerpAngle(a.r, b.r, t);
    o.v = a.v + (b.v - a.v) * t;
    o.hp = t < 1 ? a.hp : b.hp;
    o.flags = b.flags;
    o.extrapolated = false;
    return o;
  }
}

function assign(o: RemotePose, s: RemoteSample, extrapolated: boolean): RemotePose {
  o.x = s.x;
  o.z = s.z;
  o.r = s.r;
  o.v = s.v;
  o.hp = s.hp;
  o.flags = s.flags;
  o.extrapolated = extrapolated;
  return o;
}

/** Metadata for a remote entity (from `ent`). */
export interface RemoteMeta {
  eid: number;
  id: string;
  name: string;
  shipType: string;
  maxHp: number;
}

export interface RemoteEntity {
  eid: number;
  meta: RemoteMeta | null;
  buffer: InterpolationBuffer;
  /** local ms when the entity last appeared in a snapshot */
  lastSeenLocal: number;
  /** latest hp/flags from snapshots or events (hit/sunk) — for UI that doesn't interpolate */
  hp: number;
  flags: number;
}

export class RemoteWorld {
  readonly entities = new Map<number, RemoteEntity>();
  /** Bumps when the renderable set or any metadata changes (not on position updates). */
  version = 0;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private getOrCreate(eid: number, localNow: number): RemoteEntity {
    let e = this.entities.get(eid);
    if (!e) {
      e = {
        eid,
        meta: null,
        buffer: new InterpolationBuffer(),
        lastSeenLocal: localNow,
        hp: 0,
        flags: 0,
      };
      this.entities.set(eid, e);
    }
    return e;
  }

  onEnt(m: EntMessage, localNow: number): void {
    const e = this.getOrCreate(m.eid, localNow);
    const prev = e.meta;
    if (
      !prev ||
      prev.id !== m.id ||
      prev.name !== m.name ||
      prev.shipType !== m.shipType ||
      prev.maxHp !== m.maxHp
    ) {
      e.meta = { eid: m.eid, id: m.id, name: m.name, shipType: m.shipType, maxHp: m.maxHp };
      this.bump();
    }
  }

  onGone(eid: number): void {
    const e = this.entities.get(eid);
    if (!e) return;
    this.entities.delete(eid);
    if (e.meta) this.bump();
  }

  /** Feed one snapshot's entity rows at server time `st`. */
  onSnapshot(st: number, rows: EntityRow[], localNow: number): void {
    let changed = false;
    for (const row of rows) {
      const [eid, x, z, r, v, hp, flags] = row;
      const e = this.getOrCreate(eid, localNow);
      e.buffer.push({ t: st, x, z, r, v, hp, flags });
      e.lastSeenLocal = localNow;
      if (e.meta && (e.flags & FLAG_SUNK) !== (flags & FLAG_SUNK)) changed = true;
      e.hp = hp;
      e.flags = flags;
    }
    // No staleness pruning: the server always sends `gone`, sunk/disconnected ships stay visible
    // (flags), and snapshots may be skipped under backpressure -- dropping an entity here would lose
    // its metadata, which is only re-sent on view entry.
    if (changed) this.bump();
  }

  /** Apply a `hit` (hp after the hit) to a remote entity. */
  setHp(eid: number, hp: number): void {
    const e = this.entities.get(eid);
    if (e) e.hp = hp;
  }

  /** Apply a `sunk` event to a remote entity. */
  markSunk(eid: number): void {
    const e = this.entities.get(eid);
    if (e && !(e.flags & FLAG_SUNK)) {
      e.flags |= FLAG_SUNK;
      if (e.meta) this.bump();
    }
  }

  /** Entities that have metadata (i.e. can be rendered). */
  renderable(): RemoteEntity[] {
    const out: RemoteEntity[] = [];
    this.entities.forEach((e) => {
      if (e.meta) out.push(e);
    });
    return out;
  }

  /** Pose of `eid` at `renderTime` (server ms); prunes old samples. */
  sample(eid: number, renderTime: number, out?: RemotePose): RemotePose | null {
    const e = this.entities.get(eid);
    if (!e) return null;
    const pose = e.buffer.sample(renderTime, out);
    e.buffer.prune(renderTime);
    return pose;
  }

  clear(): void {
    const had = this.entities.size > 0;
    this.entities.clear();
    if (had) this.bump();
  }
}
