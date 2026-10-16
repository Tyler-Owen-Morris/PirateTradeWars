import { describe, it, expect } from "vitest";
import {
  TICK_DT,
  stepShip,
  shipPhysicsStats,
  wrappedDelta,
  type ShipInput,
  type ShipKinematics,
} from "@shared/physics";
import { MAP_WIDTH } from "@shared/gameConstants";
import type { InputMessage } from "@shared/protocol";
import { Predictor } from "../prediction";

const stats = shipPhysicsStats("sloop");

/** Deterministic input script: ahead, turning left for a while, then right, then reverse. */
function scriptedInput(i: number): ShipInput {
  if (i < 30) return { th: 1, ru: 0, f: 0 };
  if (i < 60) return { th: 1, ru: 1, f: 0 };
  if (i < 80) return { th: 0, ru: -1, f: 0 };
  return { th: -1, ru: 0, f: 0 };
}

interface Snap {
  me: { x: number; z: number; r: number; v: number; shipType: string };
  a: number;
}

/**
 * Fake authoritative server: one stepShip per tick consuming one queued input (re-using the last
 * input with f:0 when the queue is empty), exactly as PROTOCOL §5 describes.
 */
class FakeServer {
  state: ShipKinematics;
  queue: InputMessage[] = [];
  lastSeq = 0;
  lastInput: ShipInput = { th: 0, ru: 0, f: 0 };
  /** optional authoritative nudge applied on a given tick (e.g. a collision the client can't know) */
  nudgeAtTick: number | null = null;
  nudge = { x: 0, z: 0 };
  tickNo = 0;
  constructor(start: ShipKinematics) {
    this.state = { ...start };
  }
  receive(m: InputMessage) {
    if (m.s > this.lastSeq && !this.queue.some((q) => q.s === m.s)) this.queue.push(m);
  }
  tick(): Snap {
    this.tickNo++;
    const m = this.queue.shift();
    if (m) {
      this.lastSeq = m.s;
      this.lastInput = { th: m.th, ru: m.ru, f: m.f };
    }
    this.state = stepShip(this.state, m ? this.lastInput : { ...this.lastInput, f: 0 }, stats);
    if (this.nudgeAtTick === this.tickNo) {
      this.state = { ...this.state, x: this.state.x + this.nudge.x, z: this.state.z + this.nudge.z };
    }
    return {
      me: { x: this.state.x, z: this.state.z, r: this.state.rotationY, v: this.state.velocity, shipType: "sloop" },
      a: this.lastSeq,
    };
  }
}

/**
 * Run client + server in lock-step at 20 Hz with `latencyTicks` one-way delay in both directions.
 * The client renders at 60 fps (3 frames per tick).
 */
function simulate(opts: { ticks: number; latencyTicks: number; server: FakeServer; client: Predictor; onTick?: (i: number) => void }) {
  const { server, client, latencyTicks } = opts;
  const toServer: Array<{ at: number; m: InputMessage }> = [];
  const toClient: Array<{ at: number; s: Snap }> = [];
  let inputIndex = 0;
  for (let tick = 1; tick <= opts.ticks; tick++) {
    // client frames (3 per tick)
    for (let f = 0; f < 3; f++) {
      client.advance(TICK_DT / 3 + 1e-9, scriptedInput(inputIndex), (m) => {
        toServer.push({ at: tick + latencyTicks, m });
        inputIndex++;
      });
    }
    // deliver inputs
    while (toServer.length && toServer[0].at <= tick) server.receive(toServer.shift()!.m);
    const snap = server.tick();
    toClient.push({ at: tick + latencyTicks, s: snap });
    while (toClient.length && toClient[0].at <= tick) {
      const s = toClient.shift()!.s;
      client.reconcile(s.me, s.a);
    }
    opts.onTick?.(tick);
  }
}

describe("Predictor", () => {
  it("does nothing until the first snapshot initializes it", () => {
    const p = new Predictor();
    const sent: InputMessage[] = [];
    expect(p.advance(0.2, { th: 1, ru: 0, f: 0 }, (m) => sent.push(m))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("runs fixed 20 Hz steps with an accumulator and sends one input per step with increasing seq", () => {
    const p = new Predictor();
    p.reconcile({ x: 100, z: 100, r: 0, v: 0, shipType: "sloop" }, 0);
    const sent: InputMessage[] = [];
    // 10 frames of 16 ms = 160 ms → 3 steps (150 ms), 10 ms left over
    for (let i = 0; i < 10; i++) p.advance(0.016, { th: 1, ru: 1, f: 1 }, (m) => sent.push(m));
    expect(sent.map((m) => m.s)).toEqual([1, 2, 3]);
    expect(sent[0]).toEqual({ t: "input", s: 1, th: 1, ru: 1, f: 1 });
    expect(p.pending).toHaveLength(3);
    expect(p.acc).toBeCloseTo(0.01, 6);
    let expected: ShipKinematics = { x: 100, z: 100, rotationY: 0, velocity: 0 };
    for (let i = 0; i < 3; i++) expected = stepShip(expected, { th: 1, ru: 1, f: 1 }, stats);
    expect(p.cur).toEqual(expected);
  });

  it("a = -1 (nothing applied yet) replays every pending input", () => {
    const p = new Predictor();
    p.reconcile({ x: 500, z: 500, r: 0, v: 0, shipType: "sloop" }, -1);
    p.advance(TICK_DT * 2 + 1e-9, { th: 1, ru: 0, f: 0 }, () => {});
    p.reconcile({ x: 500, z: 500, r: 0, v: 0, shipType: "sloop" }, -1);
    expect(p.pending).toHaveLength(2);
    let e: ShipKinematics = { x: 500, z: 500, rotationY: 0, velocity: 0 };
    e = stepShip(stepShip(e, { th: 1, ru: 0, f: 0 }, stats), { th: 1, ru: 0, f: 0 }, stats);
    expect(p.cur.z).toBeCloseTo(e.z, 9);
  });

  it("reconcile drops acked inputs and replays the rest on top of the server state", () => {
    const p = new Predictor();
    p.reconcile({ x: 500, z: 500, r: 0, v: 0, shipType: "sloop" }, 0);
    const inputs: ShipInput[] = [
      { th: 1, ru: 0, f: 0 },
      { th: 1, ru: 1, f: 0 },
      { th: 1, ru: 1, f: 0 },
      { th: 0, ru: -1, f: 0 },
    ];
    for (const inp of inputs) p.advance(TICK_DT, inp, () => {});
    // Server has processed the first two.
    let server: ShipKinematics = { x: 500, z: 500, rotationY: 0, velocity: 0 };
    server = stepShip(server, inputs[0], stats);
    server = stepShip(server, inputs[1], stats);
    p.reconcile({ x: server.x, z: server.z, r: server.rotationY, v: server.velocity, shipType: "sloop" }, 2);
    expect(p.pending.map((q) => q.seq)).toEqual([3, 4]);
    let expected = stepShip(server, inputs[2], stats);
    expected = stepShip(expected, inputs[3], stats);
    expect(p.cur.x).toBeCloseTo(expected.x, 9);
    expect(p.cur.z).toBeCloseTo(expected.z, 9);
    expect(p.cur.rotationY).toBeCloseTo(expected.rotationY, 9);
    // Identical physics → no visual error introduced.
    expect(Math.hypot(p.errX, p.errZ)).toBeLessThan(1e-6);
  });

  it("converges with the server's stepShip under latency (no corrections when physics agree)", () => {
    const start = { x: 9900, z: 50, rotationY: 0.3, velocity: 0 }; // near the seam
    const server = new FakeServer(start);
    const client = new Predictor();
    client.reconcile({ x: start.x, z: start.z, r: start.rotationY, v: 0, shipType: "sloop" }, 0);
    let maxErr = 0;
    simulate({
      ticks: 120,
      latencyTicks: 3,
      server,
      client,
      onTick: () => {
        maxErr = Math.max(maxErr, Math.hypot(client.errX, client.errZ));
      },
    });
    expect(client.snaps).toBe(0);
    expect(maxErr).toBeLessThan(1e-6);
    // Ground truth: the same inputs stepped locally with no network. The server only idles (at v=0)
    // before the first input arrives, so after reconciliation the client equals this exactly.
    let truth: ShipKinematics = { ...start };
    for (let i = 0; i < client.seq; i++) truth = stepShip(truth, scriptedInput(i), stats);
    expect(client.cur.x).toBeCloseTo(truth.x, 9);
    expect(client.cur.z).toBeCloseTo(truth.z, 9);
    expect(client.cur.rotationY).toBeCloseTo(truth.rotationY, 9);
    // Ship crossed the x seam and is wrapped.
    expect(client.cur.x).toBeGreaterThanOrEqual(0);
    expect(client.cur.x).toBeLessThan(MAP_WIDTH);
  });

  it("absorbs a small server correction into a decaying visual error (no pop)", () => {
    const start = { x: 1000, z: 1000, rotationY: 0, velocity: 0 };
    const server = new FakeServer(start);
    server.nudgeAtTick = 40;
    server.nudge = { x: 30, z: 0 };
    const client = new Predictor();
    client.reconcile({ x: start.x, z: start.z, r: 0, v: 0, shipType: "sloop" }, 0);

    let maxFrameJump = 0;
    let prevRender = client.getRenderState();
    const toServer: Array<{ at: number; m: InputMessage }> = [];
    const toClient: Array<{ at: number; s: Snap }> = [];
    let idx = 0;
    for (let tick = 1; tick <= 80; tick++) {
      for (let f = 0; f < 3; f++) {
        client.advance(TICK_DT / 3 + 1e-9, scriptedInput(idx), (m) => {
          toServer.push({ at: tick + 2, m });
          idx++;
        });
        const r = client.getRenderState();
        maxFrameJump = Math.max(maxFrameJump, Math.abs(wrappedDelta(prevRender.x, r.x, MAP_WIDTH)));
        prevRender = r;
      }
      while (toServer.length && toServer[0].at <= tick) server.receive(toServer.shift()!.m);
      toClient.push({ at: tick + 2, s: server.tick() });
      while (toClient.length && toClient[0].at <= tick) {
        const s = toClient.shift()!.s;
        const before = client.getRenderState();
        client.reconcile(s.me, s.a);
        const after = client.getRenderState();
        // Reconciliation itself never moves the rendered ship.
        expect(Math.abs(wrappedDelta(before.x, after.x, MAP_WIDTH))).toBeLessThan(1e-6);
        expect(Math.abs(wrappedDelta(before.z, after.z, MAP_WIDTH))).toBeLessThan(1e-6);
      }
    }
    expect(client.snaps).toBe(0);
    // Max per-frame movement stays near ship speed (4 units/frame), i.e. the 30-unit nudge was smoothed.
    expect(maxFrameJump).toBeLessThan(4 + 30 * 0.2);
    // Error has decayed after ~2 s.
    expect(Math.hypot(client.errX, client.errZ)).toBeLessThan(0.5);
    // And the simulated state matches the server's (all inputs replayed).
    const finalMe = { x: server.state.x, z: server.state.z, r: server.state.rotationY, v: server.state.velocity, shipType: "sloop" };
    client.reconcile(finalMe, client.seq);
    expect(client.cur.x).toBeCloseTo(server.state.x, 6);
  });

  it("hard-snaps when the error exceeds SNAP_ERROR_DISTANCE", () => {
    const p = new Predictor();
    p.reconcile({ x: 1000, z: 1000, r: 0, v: 0, shipType: "sloop" }, 0);
    p.advance(TICK_DT, { th: 0, ru: 0, f: 0 }, () => {});
    p.reconcile({ x: 1500, z: 1000, r: 0, v: 0, shipType: "sloop" }, 1);
    expect(p.snaps).toBe(1);
    const r = p.getRenderState();
    expect(r.x).toBeCloseTo(1500, 6);
    expect(p.errX).toBe(0);
  });

  it("render state interpolates between the last two predicted steps", () => {
    const p = new Predictor();
    p.reconcile({ x: 1000, z: 1000, r: 0, v: -4, shipType: "sloop" }, 0);
    p.advance(TICK_DT, { th: 1, ru: 0, f: 0 }, () => {});
    p.advance(TICK_DT / 2, { th: 1, ru: 0, f: 0 }, () => {});
    const r = p.getRenderState();
    expect(p.alpha).toBeCloseTo(0.5, 6);
    expect(r.z).toBeCloseTo((p.prev.z + p.cur.z) / 2, 6);
  });

  it("restarts seq at 1 and clears pending on reset (server resets seq per connection)", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: 0, r: 0, v: 0 }, 0);
    p.advance(TICK_DT * 2, { th: 0, ru: 0, f: 0 }, () => {});
    p.reset();
    expect(p.pending).toHaveLength(0);
    p.reconcile({ x: 0, z: 0, r: 0, v: 0 }, 0);
    const sent: InputMessage[] = [];
    p.advance(TICK_DT, { th: 0, ru: 0, f: 0 }, (m) => sent.push(m));
    expect(sent[0].s).toBe(1);
  });
});
