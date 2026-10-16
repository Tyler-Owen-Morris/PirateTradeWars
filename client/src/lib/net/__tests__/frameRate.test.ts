/**
 * N3-fix: input rate must stay 20/s at low frame rates (play-test saw 7.7 inputs/s at ~9 fps).
 * Root cause was the frame delta, not the accumulator: THREE.Clock.getElapsedTime() calls getDelta(),
 * so components calling it inside useFrame shortened R3F's next `delta` (see the THREE.Clock test).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock } from "three";
import { TICK_DT } from "@shared/physics";
import { MAX_FRAME_DT_SEC, MAX_STEPS_PER_FRAME, Predictor } from "../prediction";
import { NetClient } from "../netClient";
import type { SocketLike } from "../connection";

const FRAME = 0.111; // ~9 fps
const FRAMES_3S = Math.round(3 / FRAME); // 27 frames = 2.997 s

function spawnedPredictor(): Predictor {
  const p = new Predictor();
  p.reconcile({ x: 100, z: 100, r: 0, v: 0, shipType: "sloop" }, -1);
  return p;
}

function harness() {
  let now = 1000;
  const sent: any[] = [];
  let sock: SocketLike & { onmessage: any; onopen: any } = null as any;
  const net = new NetClient({
    url: "ws://test",
    createSocket: () => {
      sock = {
        readyState: 0,
        send: (d: string) => sent.push(JSON.parse(d)),
        close() {},
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      } as any;
      return sock;
    },
    now: () => now,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  net.connect();
  (sock as any).readyState = 1;
  sock.onopen?.({});
  const me = { eid: 1, x: 100, z: 100, r: 0, v: 0, hp: 50, maxHp: 50, gold: 0, cargoUsed: 0, cargoCapacity: 20, sunk: false, canFire: true, reloadMs: 0, shipType: "sloop" };
  sock.onmessage?.({ data: JSON.stringify({ t: "s", k: 1, st: 50_000, a: -1, me, e: [] }) });
  sent.length = 0;
  return {
    net,
    inputs: () => sent.filter((m) => m.t === "input"),
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("input rate at low frame rates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Predictor: 9 fps steady frames for 3 s → ~60 inputs", () => {
    const p = spawnedPredictor();
    let n = 0;
    for (let i = 0; i < FRAMES_3S; i++) p.advance(FRAME, { th: 1, ru: 0, f: 0 }, () => n++);
    expect(n).toBeGreaterThanOrEqual(59);
    expect(n).toBeLessThanOrEqual(60);
  });

  it("NetClient.frame: 9 fps steady frames for 3 s → ~60 inputs", () => {
    const h = harness();
    for (let i = 0; i < FRAMES_3S; i++) h.net.frame(FRAME, { forward: true });
    expect(h.inputs().length).toBeGreaterThanOrEqual(59);
  });

  it("NetClient.frameNow measures its own wall-clock dt: 9 fps for 3 s → ~60 inputs", () => {
    const h = harness();
    h.net.frameNow({ forward: true }); // first call: dt 0
    for (let i = 0; i < FRAMES_3S; i++) {
      h.advance(FRAME * 1000);
      h.net.frameNow({ forward: true });
    }
    expect(h.inputs().length).toBeGreaterThanOrEqual(59);
    expect(h.inputs().length).toBeLessThanOrEqual(60);
  });

  it("frameNow does not credit a hidden period to the first visible frame", () => {
    const h = harness();
    h.net.frameNow({});
    h.net.setHidden(true);
    h.advance(10_000);
    h.net.setHidden(false);
    const before = h.inputs().length; // includes the neutral input sent on hide
    h.net.frameNow({ forward: true });
    expect(h.inputs().length).toBe(before);
  });

  it("a hitch longer than MAX_FRAME_DT_SEC runs MAX_STEPS_PER_FRAME steps and drops the rest", () => {
    expect(MAX_FRAME_DT_SEC).toBeCloseTo(MAX_STEPS_PER_FRAME * TICK_DT);
    const h = harness();
    h.net.frame(0.6, { forward: true });
    expect(h.inputs()).toHaveLength(MAX_STEPS_PER_FRAME);
    h.net.frame(FRAME, { forward: true }); // no backlog carried over
    expect(h.inputs()).toHaveLength(MAX_STEPS_PER_FRAME + 2);
  });

  it("root cause: THREE.Clock.getElapsedTime() mid-frame shortens R3F's next getDelta()", () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    // Emulate R3F's loop: delta = clock.getDelta() at frame start, then useFrame subscribers
    // (70 ms of work before a Ship/Port calls getElapsedTime), then 41 ms more (render etc.).
    const run = (callElapsedTime: boolean) => {
      const clock = new Clock();
      clock.start();
      const p = spawnedPredictor();
      let n = 0;
      for (let i = 0; i < FRAMES_3S; i++) {
        const delta = clock.getDelta();
        p.advance(Math.min(delta, MAX_FRAME_DT_SEC), { th: 1, ru: 0, f: 0 }, () => n++);
        t += 70;
        if (callElapsedTime) clock.getElapsedTime();
        else void clock.elapsedTime;
        t += 41;
      }
      return n;
    };
    expect(run(true)).toBeLessThan(30); // starved: ~41/111 of the time is credited
    expect(run(false)).toBeGreaterThanOrEqual(56); // first frame's delta is 0 → 26 × 0.111 s
  });
});
