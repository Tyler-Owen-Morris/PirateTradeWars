/** NPC2: NPC metadata in RemoteMeta, the `standing` message, and nameplate helpers. */
import { describe, expect, it } from "vitest";
import { RemoteWorld } from "../interpolation";
import { NetClient } from "../netClient";
import { factionFlagColors, npcNameplate, shipClassName } from "../../world/factions";

describe("RemoteMeta NPC fields", () => {
  it("carries npc/faction/title from ent (parseEntNpcMeta) and nothing for players", () => {
    const rw = new RemoteWorld();
    rw.onEnt({ t: "ent", eid: 7, id: "npc:1", name: "Fortune", shipType: "galleon", maxHp: 300, npc: 1, faction: "spain", title: "Spanish Navy" }, 0);
    rw.onEnt({ t: "ent", eid: 8, id: "p", name: "Bob", shipType: "sloop", maxHp: 100 }, 0);
    expect(rw.entities.get(7)!.meta).toMatchObject({ npc: true, faction: "spain", title: "Spanish Navy" });
    const player = rw.entities.get(8)!.meta!;
    expect(player.npc).toBeUndefined();
    expect(player.faction).toBeUndefined();
    // a title change bumps the version (re-render)
    const v = rw.version;
    rw.onEnt({ t: "ent", eid: 7, id: "npc:1", name: "Fortune", shipType: "galleon", maxHp: 300, npc: 1, faction: "spain", title: "Spanish Privateer" }, 0);
    expect(rw.version).toBeGreaterThan(v);
  });
});

describe("standing message", () => {
  it("is parsed into net.standing and emitted", () => {
    const net = new NetClient({
      url: "ws://test",
      createSocket: () => ({ readyState: 0, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }) as any,
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const seen: unknown[] = [];
    net.on("standing", (s) => seen.push(s));
    net.handleMessage({ t: "standing", rep: { spain: -5, bogus: 3 }, notoriety: 2, bounty: 0 });
    expect(net.standing).toEqual({ rep: { spain: -5 }, notoriety: 2, bounty: 0 });
    expect(seen.length).toBe(1);
    net.resetSession();
    expect(net.standing).toBeNull();
  });
});

describe("nameplate helpers", () => {
  it("formats titles and colours", () => {
    expect(shipClassName("man-o-war")).toBe("Man-o'-War");
    expect(npcNameplate("Spanish Navy", "galleon")).toBe("Spanish Navy — Galleon");
    expect(npcNameplate(undefined, "sloop")).toBe("Sloop");
    expect(factionFlagColors("pirates").field).toBe("#111111");
    expect(factionFlagColors("atlantis").field).toBe("#9e9e9e");
  });
});
