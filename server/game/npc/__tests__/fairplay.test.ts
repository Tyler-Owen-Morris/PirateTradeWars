import { describe, expect, it } from "vitest";
import { torusMetric } from "../metric";
import {
  FairPlay,
  LOOT_CAP_PER_HOUR,
  LOOT_WINDOW_MS,
  NEW_PLAYER_SHIELD_MS,
  classMatch,
  countsAsPlayerKill,
  inSafeZone,
} from "../fairplay";

const m = torusMetric(10000, 10000);
const zones = [{ x: 5000, z: 5000, safeRadius: 600 }];

describe("fair play", () => {
  it("new players are shielded for 10 minutes unless they provoke", () => {
    const f = new FairPlay();
    expect(f.shielded("p", 0)).toBe(true); // never seen
    f.seePlayer("p", 1000);
    expect(f.shielded("p", 1000 + NEW_PLAYER_SHIELD_MS - 1)).toBe(true);
    expect(f.shielded("p", 1000 + NEW_PLAYER_SHIELD_MS)).toBe(false);
    f.seePlayer("q", 0);
    f.provoke("q");
    expect(f.shielded("q", 1)).toBe(false);
  });

  it("at most 2 NPCs attack one player", () => {
    const f = new FairPlay();
    expect(f.claim(1, "p")).toBe(true);
    expect(f.claim(2, "p")).toBe(true);
    expect(f.claim(3, "p")).toBe(false);
    expect(f.claim(1, "p")).toBe(true); // already holds a slot
    expect(f.attackerCount("p")).toBe(2);
    f.release(1);
    expect(f.claim(3, "p")).toBe(true);
    // switching target frees the old slot
    expect(f.claim(3, "other")).toBe(true);
    expect(f.attackerCount("p")).toBe(1);
  });

  it("no fighting in port safe zones", () => {
    const f = new FairPlay({ shieldMs: 0, maxAttackers: 2, lootCapPerHour: 100 });
    f.seePlayer("p", 0);
    expect(inSafeZone(5300, 5000, zones, m)).toBe(true);
    expect(inSafeZone(5700, 5000, zones, m)).toBe(false);
    expect(f.canEngagePlayer(1, "p", { x: 6000, z: 5000 }, { x: 5300, z: 5000 }, zones, m, 1)).toBe(false); // target in port
    expect(f.canEngagePlayer(1, "p", { x: 5200, z: 5000 }, { x: 6000, z: 5000 }, zones, m, 1)).toBe(false); // npc in port
    expect(f.canEngagePlayer(1, "p", { x: 6500, z: 5000 }, { x: 6000, z: 5000 }, zones, m, 1)).toBe(true);
  });

  it("prefers similar ship classes", () => {
    expect(classMatch("sloop", "sloop")).toBe(1);
    expect(classMatch("sloop", "brigantine")).toBeGreaterThan(classMatch("sloop", "galleon"));
    expect(classMatch("sloop", "dreadnaught")).toBeLessThan(0.2);
  });

  it("caps NPC loot per player per rolling hour", () => {
    const f = new FairPlay();
    expect(f.grantLoot("p", LOOT_CAP_PER_HOUR - 500, 0)).toBe(LOOT_CAP_PER_HOUR - 500);
    expect(f.grantLoot("p", 1000, 10)).toBe(500);
    expect(f.grantLoot("p", 1000, 20)).toBe(0);
    expect(f.grantLoot("other", 1000, 20)).toBe(1000);
    expect(f.grantLoot("p", 1000, LOOT_WINDOW_MS + 5)).toBe(1000); // the first grant aged out
  });

  it("NPC kills are not player kills", () => {
    expect(countsAsPlayerKill({ controller: "npc" })).toBe(false);
    expect(countsAsPlayerKill({ controller: "player" })).toBe(true);
    expect(countsAsPlayerKill(undefined)).toBe(false);
  });
});
