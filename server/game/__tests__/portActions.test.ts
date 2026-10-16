// Card W4: trade, upgrade and repair through the real socket handler, gated on the metric distance
// to the port's DOCK (≤ PORT_INTERACTION_RADIUS = 300). Redis, the game state and Segment are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { portByKey } from "@shared/world/ports";
import { SHIP_STATS } from "@shared/gameConstants";

const h = vi.hoisted(() => ({ player: null as any, port: null as any }));

vi.mock("../../redisStorage", () => ({
  redisStorage: {
    getPort: vi.fn(async (id: number) => (h.port && h.port.id === id ? h.port : undefined)),
    getPortGoods: vi.fn(async () => [{ goodId: 1, currentPrice: 10, stock: 100 }]),
    getPlayerInventory: vi.fn(async () => [{ goodId: 1, quantity: 5 }]),
    updatePlayerInventory: vi.fn(async () => {}),
    updatePlayerGold: vi.fn(async () => {}),
    updatePlayerState: vi.fn(async () => {}),
    addActiveName: vi.fn(async () => {}),
    getActiveNamePlayerId: vi.fn(async () => null),
    getPlayer: vi.fn(async () => undefined),
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
  },
}));

import { handleSocketConnection, withinPort } from "../socketHandler";

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {}
}

const pr = portByKey("port_royal")!;

async function connect(): Promise<FakeWs> {
  const ws = new FakeWs();
  handleSocketConnection(ws as any);
  ws.emit("message", Buffer.from(JSON.stringify({ type: "reconnect", id: "p1", name: "Tester" })));
  await vi.waitFor(() => expect(ws.sent.some((m) => m.type === "reconnected")).toBe(true));
  return ws;
}

async function act(ws: FakeWs, msg: object): Promise<any> {
  const n = ws.sent.length;
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(n));
  return ws.sent[ws.sent.length - 1];
}

function placePlayer(dz: number) {
  h.player = {
    id: "p1",
    playerId: "p1",
    name: "Tester",
    shipType: "sloop",
    x: pr.dock.x,
    z: pr.dock.z + dz,
    gold: 100_000,
    hp: 10,
    maxHp: 50,
    cargoUsed: 0,
    cargoCapacity: 100,
    dead: false,
    sunk: false,
  };
}

describe("port actions are gated on the dock radius", () => {
  beforeEach(() => {
    h.port = pr;
    placePlayer(0);
  });

  it("withinPort measures from the dock, not the town", () => {
    expect(withinPort({ x: pr.dock.x, z: pr.dock.z + 299 }, pr)).toBe(true);
    expect(withinPort({ x: pr.dock.x, z: pr.dock.z + 301 }, pr)).toBe(false);
  });

  const cases: [string, object, string][] = [
    ["trade buy", { type: "trade", portId: pr.id, action: "buy", goodId: 1, quantity: 1 }, "tradeSuccess"],
    ["trade sell", { type: "trade", portId: pr.id, action: "sell", goodId: 1, quantity: 1 }, "tradeSuccess"],
    ["upgrade", { type: "upgradeShip", portId: pr.id }, "upgradeSuccess"],
    ["repair", { type: "repairShip", portId: pr.id }, "repairSuccess"],
  ];

  for (const [label, msg, okType] of cases) {
    it(`${label}: accepted within 300 of the dock, rejected beyond`, async () => {
      placePlayer(250);
      const ws = await connect();
      expect((await act(ws, msg)).type).toBe(okType);

      placePlayer(350);
      const goldBefore = h.player.gold;
      const reply = await act(ws, msg);
      expect(reply.type).toBe("error");
      expect(reply.message).toBe("Too far from port");
      expect(h.player.gold).toBe(goldBefore);
    });
  }

  it("repair restores hp only near the dock", async () => {
    placePlayer(400);
    const ws = await connect();
    await act(ws, { type: "repairShip", portId: pr.id });
    expect(h.player.hp).toBe(10);
    placePlayer(0);
    await act(ws, { type: "repairShip", portId: pr.id });
    expect(h.player.hp).toBe(50);
    expect(h.player.gold).toBe(100_000 - SHIP_STATS.sloop.repairCost);
  });
});
