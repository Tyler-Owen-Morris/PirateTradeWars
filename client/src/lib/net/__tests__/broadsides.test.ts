// Broadsides (2026-10-23): Q/E/Space → fire flags, the tap latch, and what NetClient sends.
import { describe, it, expect } from "vitest";
import { FIRE_ALL, FIRE_PORT, FIRE_STARBOARD, TICK_DT } from "@shared/physics";
import type { SnapshotMessage } from "@shared/protocol";
import { FireLatch, NEUTRAL_CONTROLS, combineControls, controlsToInput } from "../controls";
import { NetClient } from "../netClient";
import type { SocketLike } from "../connection";

describe("controlsToInput fire flags", () => {
  it("Space/F → FIRE_ALL, Q → FIRE_PORT, E → FIRE_STARBOARD", () => {
    expect(controlsToInput({ fire: true }).f).toBe(FIRE_ALL);
    expect(controlsToInput({ firePort: true }).f).toBe(FIRE_PORT);
    expect(controlsToInput({ fireStarboard: true }).f).toBe(FIRE_STARBOARD);
    expect(controlsToInput(NEUTRAL_CONTROLS).f).toBe(0);
  });

  it("keys combine into one bit set and leave th/ru alone", () => {
    expect(controlsToInput({ firePort: true, fireStarboard: true }).f).toBe(FIRE_PORT | FIRE_STARBOARD);
    expect(controlsToInput({ fire: true, firePort: true })).toEqual({ th: 0, ru: 0, f: FIRE_ALL | FIRE_PORT });
    expect(controlsToInput({ forward: true, left: true, fireStarboard: true })).toEqual({ th: 1, ru: 1, f: FIRE_STARBOARD });
  });

  it("combineControls ORs the side keys; sources without them (touch/HUD) still work", () => {
    const c = combineControls({ firePort: true }, { fire: true }, { fireStarboard: false }, null);
    expect(c.firePort).toBe(true);
    expect(c.fireStarboard).toBe(false);
    expect(c.fire).toBe(true);
    expect(controlsToInput(combineControls({ fire: true })).f).toBe(FIRE_ALL); // the touch fire button
  });
});

describe("FireLatch", () => {
  it("keeps a tap that ended before any step until a step sends it", () => {
    const l = new FireLatch();
    expect(l.peek(FIRE_PORT)).toBe(FIRE_PORT);
    l.commit(FIRE_PORT, false); // pressed this frame, no step ran
    expect(l.peek(0)).toBe(FIRE_PORT); // released next frame: still pending
    l.commit(0, true); // a step carried it
    expect(l.peek(0)).toBe(0);
  });

  it("merges presses and resets", () => {
    const l = new FireLatch();
    l.commit(FIRE_PORT, false);
    expect(l.peek(FIRE_ALL)).toBe(FIRE_PORT | FIRE_ALL);
    l.reset();
    expect(l.peek(0)).toBe(0);
  });
});

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
}

function joined() {
  const sockets: FakeSocket[] = [];
  const net = new NetClient({
    url: "ws://test/game-ws",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    now: () => 1000,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  net.connect();
  const s = sockets[0];
  s.readyState = 1;
  s.onopen?.({});
  const snap: SnapshotMessage = {
    t: "s", k: 1, st: 50_000, a: 0, e: [],
    me: { eid: 1, x: 100, z: 100_000, r: 0, v: 0, hp: 50, maxHp: 50, gold: 0, cargoUsed: 0, cargoCapacity: 20, sunk: false, canFire: true, reloadMs: 0, shipType: "sloop" },
  };
  s.onmessage?.({ data: JSON.stringify(snap) });
  s.sent.length = 0;
  return { net, s };
}

describe("NetClient sends fire flags", () => {
  const inputs = (s: FakeSocket) => s.sent.filter((m) => m.t === "input").map((m) => m.f);

  it("a quick Q tap between two steps still reaches the server once", () => {
    const { net, s } = joined();
    net.frame(TICK_DT / 3, { firePort: true }); // press: no step yet
    net.frame(TICK_DT / 3, {}); // released before the step
    expect(inputs(s)).toEqual([]);
    net.frame(TICK_DT / 3 + 1e-9, {}); // the step carries the tap
    net.frame(TICK_DT + 1e-9, {}); // and only that one
    expect(inputs(s)).toEqual([FIRE_PORT, 0]);
  });

  it("holding Space sends FIRE_ALL every step (the server fires each side as it reloads)", () => {
    const { net, s } = joined();
    for (let i = 0; i < 4; i++) net.frame(TICK_DT + 1e-9, { fire: true });
    expect(inputs(s)).toEqual([FIRE_ALL, FIRE_ALL, FIRE_ALL, FIRE_ALL]);
  });

  it("Q then E in the same step sends both side bits", () => {
    const { net, s } = joined();
    net.frame(TICK_DT / 2, { firePort: true });
    net.frame(TICK_DT / 2 + 1e-9, { fireStarboard: true });
    expect(inputs(s)).toEqual([FIRE_PORT | FIRE_STARBOARD]);
  });
});
