// The socket handler stores the player's source, counts NEW captains (not reconnects) and tags Segment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

const h = vi.hoisted(() => ({ players: new Map<string, any>(), counted: [] as any[], tracked: [] as any[] }));

vi.mock("../../redisStorage", () => ({
  redisStorage: {
    getActiveNamePlayerId: vi.fn(async () => null),
    createPlayer: vi.fn(async () => {}),
    addActiveName: vi.fn(async () => {}),
    getPlayer: vi.fn(async () => undefined),
  },
}));
vi.mock("../counters", () => ({ dailyStats: { count: (kind: string, source: string) => h.counted.push([kind, source]) } }));
vi.mock("../../segmentClient", () => ({
  identifyPlayer: vi.fn(),
  trackEvent: (id: string, event: string, props: any) => h.tracked.push([event, props]),
}));
vi.mock("../../game/gameState", () => ({
  gameState: {
    getPlayer: (id: string) => h.players.get(id),
    addPlayer: async (name: string, shipType: string, _s: unknown, id?: string) => {
      const p = { id: id ?? "new-id", playerId: id ?? "new-id", name, shipType, gold: 200 } as any;
      h.players.set(p.id, p);
      return p;
    },
    registerClient: vi.fn(),
    removeClient: vi.fn(),
    playerCount: 1,
    world: { queueInput: vi.fn() },
    chat: { history: () => [] },
  },
}));

import { handleSocketConnection } from "../../game/socketHandler";

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {}
}

async function send(msg: object, expectType: string): Promise<FakeWs> {
  const ws = new FakeWs();
  handleSocketConnection(ws as any);
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  await vi.waitFor(() => expect(ws.sent.some((m) => m.type === expectType)).toBe(true));
  return ws;
}

beforeEach(() => {
  h.players.clear();
  h.counted.length = 0;
  h.tracked.length = 0;
});

describe("connect source", () => {
  it("connect: stores source/campaign, counts a new captain, tags Player Connected", async () => {
    await send({ type: "connect", name: "Salty Jo", shipType: "sloop", tempPlayerId: "p1", source: "tiktok", campaign: "Trailer1" }, "connected");
    const p = h.players.get("p1");
    expect(p).toMatchObject({ source: "TikTok", campaign: "trailer1" });
    expect(typeof p.joinedAtWall).toBe("number");
    expect(h.counted).toEqual([["captains", "TikTok"]]);
    expect(h.tracked.find(([e]) => e === "Player Connected")[1]).toMatchObject({ source: "TikTok", campaign: "trailer1" });
  });

  it("an old client without a source = Direct", async () => {
    await send({ type: "connect", name: "Old Salt", shipType: "sloop", tempPlayerId: "p2" }, "connected");
    expect(h.players.get("p2").source).toBe("Direct");
    expect(h.counted).toEqual([["captains", "Direct"]]);
  });

  it("reconnect is not counted, keeps a known source, fills a missing one", async () => {
    h.players.set("p3", { id: "p3", playerId: "p3", name: "Peg", shipType: "sloop", gold: 5, source: "YouTube" });
    await send({ type: "reconnect", id: "p3", name: "Peg", source: "Facebook" }, "reconnected");
    expect(h.players.get("p3").source).toBe("YouTube");
    h.players.set("p4", { id: "p4", playerId: "p4", name: "Ned", shipType: "sloop", gold: 5 });
    await send({ type: "reconnect", id: "p4", name: "Ned", source: "x" }, "reconnected");
    expect(h.players.get("p4").source).toBe("X");
    expect(h.counted).toEqual([]);
  });
});
