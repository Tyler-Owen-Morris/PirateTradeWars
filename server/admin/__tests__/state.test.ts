import { describe, expect, it } from "vitest";
import { World } from "../../game/world";
import { portByKey } from "@shared/world/ports";
import { SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";
import { adminRow, adminRows, applyAdminAction, parseAdminAction, playerStatus, COMBAT_WINDOW_MS, IDLE_AFTER_MS } from "../state";

const pr = portByKey("port_royal")!;

function world(now = { t: 1_000_000 }) {
  return { w: new World({ wallClock: () => now.t }), now };
}

describe("parseAdminAction", () => {
  it("accepts the four actions", () => {
    expect(parseAdminAction({ playerId: "p1", action: "repairFull" })).toEqual({ ok: true, value: { playerId: "p1", action: "repairFull" } });
    expect(parseAdminAction({ playerId: "p1", action: "repairQuarter" }).ok).toBe(true);
    expect(parseAdminAction({ playerId: "p1", action: "upgrade" }).ok).toBe(true);
    expect(parseAdminAction({ playerId: "p1", action: "gold", amount: 1 })).toEqual({ ok: true, value: { playerId: "p1", action: "gold", amount: 1 } });
    expect(parseAdminAction({ playerId: "p1", action: "gold", amount: 1_000_000 }).ok).toBe(true);
  });

  it("refuses bad ids, NPC ids, unknown actions and bad bodies", () => {
    for (const body of [
      null, [], "x", {},
      { playerId: "", action: "repairFull" },
      { playerId: 5, action: "repairFull" },
      { playerId: "x".repeat(65), action: "repairFull" },
      { playerId: "npc:3", action: "repairFull" },
      { playerId: "p1", action: "sink" },
      { playerId: "p1", action: "__proto__" },
    ]) {
      expect(parseAdminAction(body).ok).toBe(false);
    }
  });

  it("refuses bad gold amounts", () => {
    for (const amount of [0, -5, 1.5, 1_000_001, NaN, Infinity, "100", undefined, null]) {
      expect(parseAdminAction({ playerId: "p1", action: "gold", amount }).ok).toBe(false);
    }
  });
});

describe("applyAdminAction", () => {
  it("repairs to full and by a quarter (capped)", () => {
    const { w } = world();
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.GALLEON });
    p.hp = 10;
    expect(applyAdminAction(w, p, { playerId: "p1", action: "repairQuarter" })).toEqual({ ok: true, value: "Gave Salty Jo +25% hull" });
    expect(p.hp).toBe(10 + Math.round(p.maxHp / 4));
    p.hp = p.maxHp - 1;
    applyAdminAction(w, p, { playerId: "p1", action: "repairQuarter" });
    expect(p.hp).toBe(p.maxHp);
    p.hp = 3;
    applyAdminAction(w, p, { playerId: "p1", action: "repairFull" });
    expect(p.hp).toBe(p.maxHp);
  });

  it("gives gold", () => {
    const { w } = world();
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.SLOOP, gold: 260 });
    expect(applyAdminAction(w, p, { playerId: "p1", action: "gold", amount: 10_000 })).toEqual({ ok: true, value: "Gave Salty Jo +10,000 gold" });
    expect(p.gold).toBe(10_260);
  });

  it("upgrades along the path for free, keeping gold, cargo and position, until the Dreadnaught", () => {
    const { w } = world();
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.SLOOP, gold: 7, x: pr.spawn.x, z: pr.spawn.z });
    p.cargoUsed = 12;
    p.hp = 1;
    const meta = p.metaVersion;
    const [x0, z0] = [p.x, p.z];
    expect(applyAdminAction(w, p, { playerId: "p1", action: "upgrade" })).toEqual({ ok: true, value: "Upgraded Salty Jo to Brigantine" });
    expect(p.shipType).toBe(SHIP_TYPES.BRIGANTINE);
    expect(p.maxHp).toBe(SHIP_STATS[SHIP_TYPES.BRIGANTINE].hullStrength);
    expect(p.hp).toBe(p.maxHp);
    expect(p.cargoCapacity).toBe(SHIP_STATS[SHIP_TYPES.BRIGANTINE].cargoCapacity);
    expect(p.metaVersion).toBe(meta + 1); // viewers get a fresh `ent`
    expect([p.gold, p.cargoUsed, p.x, p.z]).toEqual([7, 12, x0, z0]);
    for (let i = 0; i < 3; i++) expect(applyAdminAction(w, p, { playerId: "p1", action: "upgrade" }).ok).toBe(true);
    expect(p.shipType).toBe(SHIP_TYPES.DREADNAUGHT);
    const top = applyAdminAction(w, p, { playerId: "p1", action: "upgrade" });
    expect(top.ok).toBe(false);
    expect(p.shipType).toBe(SHIP_TYPES.DREADNAUGHT);
  });

  it("refuses missing, disconnected, sunk and NPC ships", () => {
    const { w } = world();
    expect(applyAdminAction(w, undefined, { playerId: "nobody", action: "repairFull" }).ok).toBe(false);
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.SLOOP });
    p.sunk = true;
    expect(applyAdminAction(w, p, { playerId: "p1", action: "gold", amount: 5 }).ok).toBe(false);
    p.sunk = false;
    w.setConnected("p1", false);
    expect(applyAdminAction(w, p, { playerId: "p1", action: "gold", amount: 5 }).ok).toBe(false);
    const npc = w.addNpc({ name: "HMS Test", shipType: SHIP_TYPES.SLOOP, x: pr.spawn.x, z: pr.spawn.z, faction: "navy", title: "Navy" });
    expect(applyAdminAction(w, npc, { playerId: npc.id, action: "repairFull" }).ok).toBe(false);
  });
});

describe("rows and status", () => {
  it("in port when docked, Off <port> at sea, with lat/lon", () => {
    const { w } = world();
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.SLOOP, x: pr.dock.x, z: pr.dock.z });
    p.source = "TikTok";
    p.joinedAtWall = 5;
    let row = adminRow(p, w.tick, 1_000_000);
    expect(row).toMatchObject({ id: "p1", name: "Salty Jo", ship: "Sloop", nextShip: "Brigantine", status: "port", where: "Port Royal", source: "TikTok", onlineSince: 5 });
    expect(row.lat).toBeCloseTo(pr.lat, 0);
    expect(row.lon).toBeCloseTo(pr.lon, 0);
    // 2000 metric south of the dock: well outside the 300 interaction radius
    p.z = pr.dock.z + 2000;
    row = adminRow(p, w.tick, 1_000_000);
    expect(row.status).toBe("sea");
    expect(row.where).toMatch(/^Off /);
  });

  it("combat beats port; idle after 60 s without non-neutral input", () => {
    const tick = 10_000;
    const base = { firedAtTick: -1e9, hitAtTick: -1e9, lastActiveWall: 0 };
    expect(playerStatus({ ...base, lastActiveWall: 0 }, tick, 1000, false)).toBe("sea");
    expect(playerStatus({ ...base, lastActiveWall: 0 }, tick, IDLE_AFTER_MS + 1, false)).toBe("idle");
    expect(playerStatus({ ...base, firedAtTick: tick - 1 }, tick, IDLE_AFTER_MS + 1, true)).toBe("combat");
    expect(playerStatus({ ...base, hitAtTick: tick - COMBAT_WINDOW_MS / 50 + 1 }, tick, 0, true)).toBe("combat");
    expect(playerStatus({ ...base, hitAtTick: tick - COMBAT_WINDOW_MS / 50 }, tick, 0, true)).toBe("port");
  });

  it("the world tracks the signals: a non-neutral input bumps lastActiveWall, a hit sets hitAtTick", () => {
    const now = { t: 1000 };
    const w = new World({ wallClock: () => now.t });
    const p = w.createPlayer({ id: "p1", name: "Salty Jo", shipType: SHIP_TYPES.SLOOP });
    now.t = 5000;
    w.queueInput("p1", { t: "input", s: 1, th: 0, ru: 0, f: 0 });
    expect(p.lastActiveWall).toBe(1000); // neutral input = still idle
    w.queueInput("p1", { t: "input", s: 2, th: 1, ru: 0, f: 0 });
    expect(p.lastActiveWall).toBe(5000);
  });

  it("adminRows lists connected human captains only", () => {
    const { w } = world();
    w.createPlayer({ id: "a", name: "Alpha", shipType: SHIP_TYPES.SLOOP });
    w.createPlayer({ id: "b", name: "Bravo", shipType: SHIP_TYPES.SLOOP });
    w.setConnected("b", false);
    const c = w.createPlayer({ id: "c", name: "Charlie", shipType: SHIP_TYPES.SLOOP });
    c.sunk = true;
    w.addNpc({ name: "HMS Test", shipType: SHIP_TYPES.SLOOP, x: pr.spawn.x, z: pr.spawn.z, faction: "navy", title: "Navy" });
    expect(adminRows(w).map((r) => r.id)).toEqual(["a"]);
  });
});
