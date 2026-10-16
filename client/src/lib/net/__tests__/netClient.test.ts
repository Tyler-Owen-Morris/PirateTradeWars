import { describe, it, expect } from "vitest";
import { TICK_DT } from "@shared/physics";
import type { SnapshotMessage, SelfState } from "@shared/protocol";
import { NetClient } from "../netClient";
import type { SocketLike } from "../connection";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: any[] = [];
  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // helpers
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverClose() {
    this.readyState = 3;
    this.onclose?.({});
  }
  deliver(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let now = 1000;
  const net = new NetClient({
    url: "ws://test/game-ws",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  return {
    net,
    sockets,
    timers,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

const me = (over: Partial<SelfState> = {}): SelfState => ({
  eid: 1,
  x: 100,
  z: 100_000, // equator (z near 0 is the polar ice)
  r: 0,
  v: 0,
  hp: 50,
  maxHp: 50,
  gold: 200,
  cargoUsed: 0,
  cargoCapacity: 20,
  sunk: false,
  canFire: true,
  reloadMs: 0,
  shipType: "sloop",
  ...over,
});

const snap = (k: number, st: number, over: Partial<SnapshotMessage> = {}): SnapshotMessage => ({
  t: "s",
  k,
  st,
  a: 0,
  me: me(),
  e: [],
  ...over,
});

describe("NetClient", () => {
  it("connects, pings on open and reconnects with exponential backoff", () => {
    const h = harness();
    h.net.connect();
    expect(h.sockets).toHaveLength(1);
    h.sockets[0].serverOpen();
    expect(h.sockets[0].sent[0]).toMatchObject({ t: "ping", c: 1000 });
    h.sockets[0].serverClose();
    expect(h.timers.map((t) => t.ms)).toEqual([500]);
    h.timers[0].fn(); // reconnect attempt 1 → new socket, fails immediately
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].serverClose();
    expect(h.timers.map((t) => t.ms)).toEqual([500, 1000]);
    h.timers[1].fn();
    h.sockets[2].serverOpen(); // success resets the backoff
    h.sockets[2].serverClose();
    expect(h.timers[2].ms).toBe(500);
  });

  it("does not reconnect after a deliberate disconnect", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.net.disconnect();
    expect(h.timers).toHaveLength(0);
  });

  it("predicts after the first snapshot and sends one input per 20 Hz step", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.sockets[0].sent.length = 0;
    h.net.frame(TICK_DT * 2, { forward: true });
    expect(h.sockets[0].sent).toHaveLength(0); // not spawned yet
    h.sockets[0].deliver(snap(1, 50_000));
    h.net.frame(TICK_DT * 2 + 1e-9, { forward: true, left: true });
    expect(h.sockets[0].sent).toEqual([
      { t: "input", s: 1, th: 1, ru: 1, f: 0 },
      { t: "input", s: 2, th: 1, ru: 1, f: 0 },
    ]);
  });

  it("sends a neutral input and stops sending while the tab is hidden", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.sockets[0].deliver(snap(1, 50_000));
    h.sockets[0].sent.length = 0;
    h.net.frame(TICK_DT + 1e-9, { forward: true });
    h.net.setHidden(true);
    h.net.frame(1, { forward: true });
    expect(h.sockets[0].sent).toEqual([
      { t: "input", s: 1, th: 1, ru: 0, f: 0 },
      { t: "input", s: 2, th: 0, ru: 0, f: 0 },
    ]);
  });

  it("tracks remote entities, excludes its own eid, and simulates/removes cannonballs", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    const s = h.sockets[0];
    s.deliver({ t: "ent", eid: 2, id: "p2", name: "Anne", shipType: "brigantine", maxHp: 150 });
    s.deliver(snap(1, 50_000, { e: [[1, 0, 0, 0, 0, 50, 0], [2, 300, 300, 0, 0, 150, 0]] }));
    expect(Array.from(h.net.remote.entities.keys())).toEqual([2]);

    const fired: boolean[] = [];
    h.net.on("fire", (_m, mine) => fired.push(mine));
    s.deliver({ t: "fire", eid: 1, k: 2, balls: [[10, 100, 100_000, 1, 0]], spd: 15, life: 3000 });
    expect(fired).toEqual([true]);
    h.advance(100);
    // Own ball: drawn on the undelayed server timeline (offset = 50_000 - 1000).
    const p = h.net.balls.position(10, h.net.clock.serverNow(h.now))!;
    expect(p.x).toBeCloseTo(100 + 15 * 60 * 0.1, 6);

    const hits: boolean[] = [];
    h.net.on("hit", (_m, isMe) => hits.push(isMe));
    s.deliver({ t: "hit", target: 2, ball: 10, hp: 140 });
    expect(h.net.balls.balls.size).toBe(0);
    expect(h.net.remote.entities.get(2)!.hp).toBe(140);
    s.deliver({ t: "hit", target: "me", ball: 99, hp: 40 });
    expect(hits).toEqual([false, true]);
    expect(h.net.me!.hp).toBe(40);

    s.deliver({ t: "fire", eid: 2, k: 3, balls: [[11, 0, 100_000, 0, 1]], spd: 15, life: 3000 });
    // Remote ball: drawn INTERP_DELAY_MS (100) behind, like the remote ships.
    expect(h.net.balls.position(11, h.net.clock.serverNow(h.now))).toBeNull();
    h.advance(150);
    expect(h.net.balls.position(11, h.net.clock.serverNow(h.now))!.z).toBeCloseTo(100_000 + 15 * 60 * 0.05, 6);
    h.advance(3000);
    h.net.frame(0, {});
    expect(h.net.balls.balls.size).toBe(0); // lifetime expiry on the delayed timeline

    s.deliver({ t: "gone", eid: 2 });
    expect(h.net.remote.entities.size).toBe(0);
  });

  it("a splash (ball hit land) removes the ball like a hit and is emitted for rendering", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    const s = h.sockets[0];
    s.deliver(snap(1, 50_000));
    s.deliver({ t: "fire", eid: 1, k: 2, balls: [[30, 100, 100_000, 1, 0]], spd: 15, life: 3000 });
    const splashes: any[] = [];
    h.net.on("splash", (m) => splashes.push(m));
    h.advance(100);
    s.deliver({ t: "splash", x: 190, z: 100_000, land: 1, ball: 30 });
    expect(splashes).toEqual([{ t: "splash", x: 190, z: 100_000, land: 1, ball: 30 }]);
    expect(h.net.balls.balls.size).toBe(0); // own ball: removed at once
  });

  it("feeds the clock from snapshots and pongs, and forwards legacy messages", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.sockets[0].deliver(snap(1, 50_000));
    expect(h.net.clock.serverNow(h.now)).toBe(50_000);
    h.advance(80);
    h.sockets[0].deliver({ t: "pong", c: 1000, st: 50_040 });
    expect(h.net.clock.rtt).toBe(80);
    const legacy: any[] = [];
    h.net.on("legacy", (m) => legacy.push(m));
    h.sockets[0].deliver({ type: "tradeSuccess", gold: 5 });
    expect(legacy).toEqual([{ type: "tradeSuccess", gold: 5 }]);
  });

  it("a remote ball hit keeps flying on the delayed timeline until the hit moment", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    const s = h.sockets[0];
    s.deliver(snap(1, 50_000));
    s.deliver({ t: "ent", eid: 2, id: "p2", name: "Anne", shipType: "sloop", maxHp: 50 });
    s.deliver({ t: "fire", eid: 2, k: 1, balls: [[20, 0, 0, 1, 0]], spd: 15, life: 3000 });
    h.advance(200);
    s.deliver({ t: "hit", target: "me", ball: 20, hp: 45 });
    // Rendered timeline is at +100 ms; the hit happened at +200 ms → still visible.
    expect(h.net.balls.position(20, h.net.clock.serverNow(h.now))).not.toBeNull();
    h.advance(101);
    h.net.frame(0, {});
    expect(h.net.balls.balls.size).toBe(0);
  });

  it("restarts seq at 1 and drops unacked inputs after a reconnect (server resets seq tracking)", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.sockets[0].deliver(snap(1, 50_000, { a: -1 }));
    h.net.frame(TICK_DT * 3 + 1e-9, { forward: true });
    expect(h.net.predictor.pending).toHaveLength(3);
    h.sockets[0].serverClose();
    expect(h.net.predictor.initialized).toBe(false);
    h.timers[0].fn();
    const s2 = h.sockets[1];
    s2.serverOpen();
    s2.deliver({ type: "reconnected", playerId: "p1", name: "me", ship: {}, gold: 0, timestamp: 0 });
    s2.sent.length = 0;
    h.net.frame(TICK_DT + 1e-9, { forward: true });
    expect(s2.sent).toHaveLength(0); // waits for the first snapshot of the new session
    s2.deliver(snap(2, 51_000, { a: -1 }));
    h.net.frame(TICK_DT + 1e-9, { forward: true });
    expect(s2.sent).toEqual([{ t: "input", s: 1, th: 1, ru: 0, f: 0 }]);
  });

  it("applies goldCollected and sunk('me') to its own state", () => {
    const h = harness();
    h.net.connect();
    h.sockets[0].serverOpen();
    h.sockets[0].deliver(snap(1, 50_000));
    h.sockets[0].deliver({ t: "goldCollected", gold: 25, newTotalGold: 225 });
    expect(h.net.me!.gold).toBe(225);
    const sunk: boolean[] = [];
    h.net.on("sunk", (_m, isMe) => sunk.push(isMe));
    h.sockets[0].deliver({ t: "sunk", eid: "me" });
    expect(sunk).toEqual([true]);
    expect(h.net.me!.sunk).toBe(true);
  });
});
