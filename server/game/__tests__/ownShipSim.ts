/**
 * Deterministic end-to-end own-ship netcode simulation (bug 2026-10-23, "own ship jumps by km").
 *
 * Wires the REAL client Predictor (client/src/lib/net/prediction.ts) to the REAL server World
 * (server/game/world.ts) and FixedStepLoop (loop.ts) through two simulated TCP links (in-order
 * delivery, latency + seeded jitter + optional head-of-line stalls). 1 ms time resolution.
 *
 * Measures every reconciliation correction (Predictor.reconcile's return value: the distance the
 * predicted ship moved when the snapshot was applied, metric units; 1 unit ~ 100 m) and the signed
 * along-track component (+ = forward warp, − = jumped backwards).
 *
 * Used by ownShipSim.test.ts; also handy for ad-hoc experiments (vitest run that file).
 */
import { World } from "../world";
import { FixedStepLoop } from "../loop";
import { Predictor } from "../../../client/src/lib/net/prediction";
import type { InputMessage, SnapshotMessage } from "@shared/protocol";
import type { ShipInput } from "@shared/physics";
import { WORLD_C, WORLD_H, metricX, wrappedDelta } from "@shared/world/geo";

export interface Window {
  /** start ms (sim time) */
  at: number;
  /** duration ms */
  ms: number;
}

export interface SimOptions {
  /** total simulated ms */
  durationMs: number;
  /** client frame interval ms (16.67 = 60 fps) */
  frameMs?: number;
  /** one-way base latency ms, each direction */
  latencyMs?: number;
  /** extra uniform random delay [0, jitterMs) per packet, each direction (TCP keeps order) */
  jitterMs?: number;
  /** uplink (client → server) head-of-line stalls: nothing arrives during the window, then a burst */
  uplinkStalls?: Window[];
  /** downlink stalls (server → client) */
  downlinkStalls?: Window[];
  /** server event-loop stalls (no timers / no IO during the window) */
  serverStalls?: Window[];
  /** client main-thread hitches (no frames during the window) */
  clientHitches?: Window[];
  /** input script (default: full ahead, straight) */
  input?: (tMs: number) => ShipInput;
  /** start position (default: 3000 units west of the x seam, on the equator, sailing east so a
   *  60 s sloop run crosses the seam). Note forward = NEGATIVE velocity, so the bow vector
   *  (sin r, cos r) points opposite to the motion: r = −π/2 sails east. */
  start?: { x: number; z: number; rotationY: number };
  seed?: number;
  shipType?: string;
}

export interface Correction {
  t: number;
  dist: number;
  /** signed along-track component of the correction, metric units: + = pushed forward along the
   *  direction of travel (warp ahead), − = pushed back (jumped backwards) */
  along: number;
}

export interface SimResult {
  corrections: Correction[];
  maxCorrection: number;
  maxForward: number;
  maxBackward: number;
  /** count of corrections > 1 unit */
  bigCount: number;
  snaps: number;
  /** final |server − client| after letting the links drain (metric units) */
  finalGap: number;
  serverX0: number;
  serverX1: number;
  crossedSeam: boolean;
  inputsSent: number;
  serverTicks: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inWindow = (t: number, ws: Window[] | undefined) => !!ws && ws.some((w) => t >= w.at && t < w.at + w.ms);
const windowEnd = (t: number, ws: Window[] | undefined) => {
  if (!ws) return t;
  for (const w of ws) if (t >= w.at && t < w.at + w.ms) return w.at + w.ms;
  return t;
};

/** In-order link with latency, jitter and stalls. */
class Link<T> {
  private q: { at: number; msg: T }[] = [];
  private lastAt = 0;
  constructor(
    private readonly latency: number,
    private readonly jitter: number,
    private readonly stalls: Window[] | undefined,
    private readonly rng: () => number,
  ) {}
  send(t: number, msg: T): void {
    let at = t + this.latency + Math.floor(this.rng() * this.jitter);
    at = windowEnd(at, this.stalls); // a stall holds everything arriving inside it until it ends
    at = Math.max(at, this.lastAt); // TCP: in order
    this.lastAt = at;
    this.q.push({ at, msg });
  }
  deliver(t: number): T[] {
    const out: T[] = [];
    while (this.q.length && this.q[0].at <= t) out.push(this.q.shift()!.msg);
    return out;
  }
}

export function simulate(o: SimOptions): SimResult {
  const frameMs = o.frameMs ?? 1000 / 60;
  const rng = mulberry32(o.seed ?? 1);
  const up = new Link<InputMessage>(o.latencyMs ?? 50, o.jitterMs ?? 0, o.uplinkStalls, rng);
  const down = new Link<SnapshotMessage>(o.latencyMs ?? 50, o.jitterMs ?? 0, o.downlinkStalls, rng);
  const input = o.input ?? (() => ({ th: 1, ru: 0, f: 0 }) as ShipInput);
  const start = o.start ?? { x: WORLD_C - 3000, z: WORLD_H / 2, rotationY: -Math.PI / 2 };

  let now = 0;
  const world = new World({ rng: () => 0.5, wallClock: () => now });
  const id = "p1";
  const p = world.createPlayer({ id, name: id, shipType: o.shipType ?? "sloop", x: start.x, z: start.z, rotationY: start.rotationY });
  world.attachClient(id);

  const loop = new FixedStepLoop(
    () => {
      world.step();
      const msgs = world.buildMessages(id);
      for (const m of msgs) if ((m as any).t === "s") down.send(now, m as SnapshotMessage);
    },
    { now: () => now },
  );
  // Drive the loop by hand: emulate the self-rescheduling setTimeout.
  let nextWake = 50;
  (loop as any).last = 0;
  (loop as any).acc = 0;

  const pred = new Predictor();
  const corrections: Correction[] = [];
  let nextFrame = 0;
  let lastFrameT = 0;
  let inputsSent = 0;
  let serverTicks = 0;
  const serverX0 = p.x;
  let crossedSeam = false;
  let prevX = p.x;

  const send = (m: InputMessage) => {
    inputsSent++;
    up.send(now, m);
  };

  const end = o.durationMs;
  const drainEnd = end + 2000;
  for (now = 0; now <= drainEnd; now++) {
    const sending = now <= end;
    // --- server process (single event loop): IO (inputs) and the tick timer, unless stalled
    if (!inWindow(now, o.serverStalls)) {
      for (const m of up.deliver(now)) world.queueInput(id, m);
      if (now >= nextWake) {
        const before = world.tick;
        loop.runDue();
        serverTicks += world.tick - before;
        nextWake = now + Math.max(1, 50 - (loop as any).acc);
        if (p.x < prevX - WORLD_C / 2) crossedSeam = true;
        prevX = p.x;
      }
    }
    // --- client: snapshots (WebSocket onmessage between frames)
    for (const s of down.deliver(now)) {
      const before = { x: pred.cur.x, z: pred.cur.z, r: pred.cur.rotationY };
      const wasInit = pred.initialized;
      const dist = pred.reconcile(s.me!, s.a);
      if (wasInit && dist > 0) {
        const dx = wrappedDelta(before.x, pred.cur.x, WORLD_C) * metricX(pred.cur.z);
        const dz = pred.cur.z - before.z;
        // Forward motion (negative velocity) is along −(sin r, cos r).
        const along = -(dx * Math.sin(before.r) + dz * Math.cos(before.r));
        if (sending) corrections.push({ t: now, dist, along }); // ignore the drain phase
      }
    }
    // --- client frames
    if (sending && now >= nextFrame) {
      if (!inWindow(now, o.clientHitches)) {
        const dt = (now - lastFrameT) / 1000;
        lastFrameT = now;
        pred.advance(Math.min(dt, 0.25), input(now), send);
      }
      nextFrame += frameMs;
    }
  }

  let maxCorrection = 0;
  let maxForward = 0;
  let maxBackward = 0;
  let bigCount = 0;
  for (const c of corrections) {
    maxCorrection = Math.max(maxCorrection, c.dist);
    maxForward = Math.max(maxForward, c.along);
    maxBackward = Math.max(maxBackward, -c.along);
    if (c.dist > 1) bigCount++;
  }
  const finalGap = Math.hypot(wrappedDelta(pred.cur.x, p.x, WORLD_C) * metricX(p.z), p.z - pred.cur.z);
  return {
    corrections,
    maxCorrection,
    maxForward,
    maxBackward,
    bigCount,
    snaps: pred.snaps,
    finalGap,
    serverX0,
    serverX1: p.x,
    crossedSeam,
    inputsSent,
    serverTicks,
  };
}
