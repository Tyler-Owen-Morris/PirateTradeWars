// Trading (2026-10-23) through the real socket handler, with a STATEFUL fake Redis whose reads and writes
// take time: proves the per-player queue fixes the race (two concurrent sells used to pay twice), and
// covers `ref` -> tradeResult, legacy replies without `ref`, sellAll, stock and avgPaid persistence.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { portByKey } from "@shared/world/ports";

const pr = portByKey("port_royal")!;
const h = vi.hoisted(() => ({ player: null as any, port: null as any, inv: [] as any[], goods: [] as any[], saves: 0 }));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

vi.mock("../../redisStorage", () => ({
  redisStorage: {
    getPort: vi.fn(async (id: number) => (h.port && h.port.id === id ? h.port : undefined)),
    getPortGoods: vi.fn(async () => { await delay(5); return JSON.parse(JSON.stringify(h.goods)); }),
    getPlayerInventory: vi.fn(async () => { await delay(5); return JSON.parse(JSON.stringify(h.inv)); }),
    saveTrade: vi.fn(async (_id: string, inv: any[]) => { await delay(5); h.inv = JSON.parse(JSON.stringify(inv)); h.saves++; }),
    setPortGoods: vi.fn(async (_id: number, goods: any[]) => { await delay(3); h.goods = JSON.parse(JSON.stringify(goods)); }),
    updatePlayerState: vi.fn(async () => {}),
    getPlayer: vi.fn(async () => undefined),
    addActiveName: vi.fn(async () => {}),
    getActiveNamePlayerId: vi.fn(async () => null),
    updatePlayerGold: vi.fn(async () => {}),
  },
}));
vi.mock("../../segmentClient", () => ({ trackEvent: vi.fn(), identifyPlayer: vi.fn() }));
vi.mock("../gameState", () => ({
  gameState: {
    getPlayer: vi.fn(() => h.player),
    registerClient: vi.fn(),
    removeClient: vi.fn(),
    playerCount: 1,
    world: { setShipType: vi.fn(), queueInput: vi.fn() },
    chat: { history: () => [] },
  },
}));

import { handleSocketConnection } from "../socketHandler";

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() {}
}
async function connect(): Promise<FakeWs> {
  const ws = new FakeWs();
  handleSocketConnection(ws as any);
  ws.emit("message", Buffer.from(JSON.stringify({ type: "reconnect", id: "p1", name: "Tester" })));
  await vi.waitFor(() => expect(ws.sent.some((m) => m.type === "reconnected")).toBe(true));
  return ws;
}
const fire = (ws: FakeWs, msg: object) => ws.emit("message", Buffer.from(JSON.stringify(msg)));
const results = (ws: FakeWs) => ws.sent.filter((m) => m.type === "tradeResult" || m.type === "tradeSuccess" || m.type === "error");

beforeEach(() => {
  h.port = pr;
  h.saves = 0;
  h.goods = [{ id: 1, portId: pr.id, goodId: 1, currentPrice: 10, stock: 100 }, { id: 2, portId: pr.id, goodId: 3, currentPrice: 30, stock: 50 }];
  h.inv = [{ playerId: "p1", goodId: 1, quantity: 5, avgPaid: 8 }];
  h.player = { id: "p1", playerId: "p1", name: "Tester", shipType: "sloop", x: pr.dock.x, z: pr.dock.z, gold: 100, hp: 50, maxHp: 50, cargoUsed: 5, cargoCapacity: 20, dead: false, sunk: false };
});

describe("trade race (UX review B2)", () => {
  it("two concurrent sells of the same 5 units pay once", async () => {
    const ws = await connect();
    fire(ws, { type: "trade", portId: pr.id, action: "sell", goodId: 1, quantity: 5, ref: 1 });
    fire(ws, { type: "trade", portId: pr.id, action: "sell", goodId: 1, quantity: 5, ref: 2 });
    await vi.waitFor(() => expect(results(ws).length).toBe(2));
    const [a, b] = results(ws);
    expect(a).toMatchObject({ type: "tradeResult", ref: 1, ok: true, total: 45 });
    expect(b).toMatchObject({ type: "tradeResult", ref: 2, ok: false, code: "not_owned" });
    expect(h.player.gold).toBe(145);
    expect(h.inv).toEqual([]);
    expect(h.goods[0].stock).toBe(105);
  });
  it("three concurrent buys are charged and delivered exactly", async () => {
    const ws = await connect();
    for (let i = 1; i <= 3; i++) fire(ws, { type: "trade", portId: pr.id, action: "buy", goodId: 3, quantity: 1, ref: i });
    await vi.waitFor(() => expect(results(ws).length).toBe(3));
    expect(results(ws).every((m) => m.ok)).toBe(true);
    expect(h.player.gold).toBe(10);
    expect(h.inv.find((r: any) => r.goodId === 3)).toMatchObject({ quantity: 3, avgPaid: 30 });
    expect(h.goods[1].stock).toBe(47);
    expect(h.player.cargoUsed).toBe(8);
  });
});

describe("protocol", () => {
  it("without ref: legacy tradeSuccess / error (old clients)", async () => {
    const ws = await connect();
    fire(ws, { type: "trade", portId: pr.id, action: "buy", goodId: 1, quantity: 1 });
    await vi.waitFor(() => expect(results(ws).length).toBe(1));
    expect(results(ws)[0]).toMatchObject({ type: "tradeSuccess", action: "buy", price: 10, totalCost: 10 });
    fire(ws, { type: "trade", portId: pr.id, action: "buy", goodId: 1, quantity: 99 });
    await vi.waitFor(() => expect(results(ws).length).toBe(2));
    expect(results(ws)[1]).toMatchObject({ type: "error", message: "Not enough gold" });
  });
  it("expectedPrice refuses a move against the player and reports the current state", async () => {
    const ws = await connect();
    fire(ws, { type: "trade", portId: pr.id, action: "buy", goodId: 1, quantity: 1, ref: 7, expectedPrice: 9 });
    await vi.waitFor(() => expect(results(ws).length).toBe(1));
    expect(results(ws)[0]).toMatchObject({ type: "tradeResult", ref: 7, ok: false, code: "price_changed", gold: 100 });
    expect(results(ws)[0].inventory).toHaveLength(1);
  });
  it("too far from the dock", async () => {
    h.player.z = pr.dock.z + 400;
    const ws = await connect();
    fire(ws, { type: "trade", portId: pr.id, action: "sell", goodId: 1, quantity: 1, ref: 3 });
    await vi.waitFor(() => expect(results(ws).length).toBe(1));
    expect(results(ws)[0]).toMatchObject({ ok: false, code: "too_far" });
  });
  it("sellAll sells the whole hold atomically", async () => {
    h.inv.push({ playerId: "p1", goodId: 3, quantity: 2, avgPaid: 20 });
    const ws = await connect();
    fire(ws, { type: "sellAll", portId: pr.id, ref: 9, lines: [{ goodId: 1, quantity: 5, expectedPrice: 9 }, { goodId: 3, quantity: 2, expectedPrice: 27 }] });
    await vi.waitFor(() => expect(results(ws).length).toBe(1));
    expect(results(ws)[0]).toMatchObject({ type: "tradeResult", ref: 9, ok: true, action: "sellAll", total: 45 + 54, cargoUsed: 0 });
    expect(h.player.gold).toBe(199);
    expect(h.inv).toEqual([]);
    expect(h.saves).toBe(1);
  });
});
