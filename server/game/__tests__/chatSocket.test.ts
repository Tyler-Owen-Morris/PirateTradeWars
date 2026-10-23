// Global chat through the real socket handler: only attached, afloat players may chat; the name comes
// from the server's player record; history is replayed after (re)connect; throttle notices go to the
// sender only. Redis, Segment and the game state are mocked (the ChatService is the real one).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

const h = vi.hoisted(() => ({
  players: new Map<string, any>(),
  sockets: new Map<string, any>(),
}));

vi.mock("../../redisStorage", () => ({
  redisStorage: {
    addActiveName: vi.fn(async () => {}),
    getActiveNamePlayerId: vi.fn(async () => null),
    getPlayer: vi.fn(async () => undefined),
  },
}));
vi.mock("../../segmentClient", () => ({ trackEvent: vi.fn(), identifyPlayer: vi.fn() }));
vi.mock("../gameState", async () => {
  const { ChatService } = await import("../chat");
  const chat = new ChatService();
  return {
    gameState: {
      chat,
      getPlayer: (id: string) => h.players.get(id),
      registerClient: (id: string, ws: any) => h.sockets.set(id, ws),
      removeClient: (id: string, ws: any) => {
        if (h.sockets.get(id) === ws) h.sockets.delete(id);
      },
      isRegisteredSocket: (id: string, ws: any) => h.sockets.get(id) === ws,
      broadcast: (data: string) => {
        h.sockets.forEach((ws) => ws.send(data));
        return h.sockets.size;
      },
      playerCount: 1,
      world: { queueInput: vi.fn(), restorePlayer: vi.fn() },
    },
  };
});

import { handleSocketConnection } from "../socketHandler";
import { CHAT_BLOCKED_NOTICE } from "../chat";

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {}
}

function addPlayer(id: string, name: string, extra: object = {}) {
  h.players.set(id, { id, playerId: id, name, shipType: "sloop", controller: "player", dead: false, sunk: false, ...extra });
}

async function join(id: string): Promise<FakeWs> {
  const ws = new FakeWs();
  handleSocketConnection(ws as any);
  ws.emit("message", Buffer.from(JSON.stringify({ type: "reconnect", id, name: h.players.get(id).name })));
  await vi.waitFor(() => expect(ws.sent.some((m) => m.t === "chatHistory")).toBe(true));
  return ws;
}

const say = (ws: FakeWs, text: string, extra: object = {}) =>
  ws.emit("message", Buffer.from(JSON.stringify({ t: "chat", text, ...extra })));
const chats = (ws: FakeWs) => ws.sent.filter((m) => m.t === "chat");

describe("global chat over the socket handler", () => {
  beforeEach(() => {
    h.players.clear();
    h.sockets.clear();
    addPlayer("p1", "Anne Bonny");
    addPlayer("p2", "Calico Jack");
  });

  it("broadcasts to every attached player with the server-side name", async () => {
    const a = await join("p1");
    const b = await join("p2");
    say(a, "  Ahoy, Jack!  ", { from: "Admin" });
    expect(chats(a).at(-1)).toMatchObject({ t: "chat", from: "Anne Bonny", text: "Ahoy, Jack!" });
    expect(chats(b).at(-1)).toMatchObject({ t: "chat", from: "Anne Bonny", text: "Ahoy, Jack!" });
    expect(chats(b).at(-1).id).toBeGreaterThan(0);
  });

  it("replays the history after (re)connect, sent after `reconnected`", async () => {
    const a = await join("p1");
    say(a, "first words");
    const b = await join("p2");
    const iRe = b.sent.findIndex((m) => m.type === "reconnected");
    const iHist = b.sent.findIndex((m) => m.t === "chatHistory");
    expect(iHist).toBeGreaterThan(iRe);
    expect(b.sent[iHist].lines.map((l: any) => l.text)).toContain("first words");
  });

  it("ignores chat from sockets that have not joined, sunk ships and stale sockets", async () => {
    const b = await join("p2");
    const lurker = new FakeWs();
    handleSocketConnection(lurker as any);
    say(lurker, "can anyone hear me");
    expect(chats(b)).toHaveLength(0);

    const a = await join("p1");
    h.players.get("p1").sunk = true;
    say(a, "glub glub");
    expect(chats(b)).toHaveLength(0);
    h.players.get("p1").sunk = false;

    const a2 = await join("p1"); // a new socket replaces `a`
    say(a, "from the old socket");
    expect(chats(b)).toHaveLength(0);
    say(a2, "from the new socket");
    expect(chats(b).at(-1).text).toBe("from the new socket");
  });

  it("throttles a spammer with a private notice; others never see it", async () => {
    const a = await join("p1");
    const b = await join("p2");
    for (let i = 0; i < 8; i++) say(a, `spam ${i}`);
    const seenByB = chats(b);
    expect(seenByB.length).toBeLessThanOrEqual(5);
    expect(seenByB.every((m) => !m.sys)).toBe(true);
    const notices = chats(a).filter((m) => m.sys === 1);
    expect(notices).toHaveLength(1);
    expect(notices[0].id).toBe(0);
  });

  it("a blocked line reaches nobody; the sender alone gets the private notice", async () => {
    addPlayer("p3", "Mary Read");
    const a = await join("p3");
    const b = await join("p2");
    const before = chats(b).length;
    say(a, "add me on discord");
    expect(chats(b).length).toBe(before);
    expect(chats(a).at(-1)).toMatchObject({ t: "chat", id: 0, from: "", sys: 1, text: CHAT_BLOCKED_NOTICE });
    say(a, "well shit");
    expect(chats(b).at(-1)).toMatchObject({ from: "Mary Read", text: "well ****" });
  });

  it("refuses an offensive ship name at connect with a nameError", async () => {
    for (const name of ["Shit Sloop", "N1gger", "snap me"]) {
      const ws = new FakeWs();
      handleSocketConnection(ws as any);
      ws.emit("message", Buffer.from(JSON.stringify({ type: "connect", name, shipType: "sloop" })));
      await vi.waitFor(() => expect(ws.sent.some((m) => m.type === "nameError")).toBe(true));
      expect(ws.sent.find((m) => m.type === "nameError").message).toMatch(/isn't allowed/);
      expect(ws.sent.some((m) => m.type === "connected")).toBe(false);
    }
  });

  it("drops empty / invalid chat frames silently", async () => {
    const a = await join("p1");
    const n = a.sent.length;
    say(a, "   ");
    a.emit("message", Buffer.from(JSON.stringify({ t: "chat", text: 7 })));
    expect(a.sent.length).toBe(n);
  });
});
