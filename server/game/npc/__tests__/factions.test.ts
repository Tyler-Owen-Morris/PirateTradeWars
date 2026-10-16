import { describe, expect, it } from "vitest";
import type { WorldEffect } from "../../world";
import {
  FACTION_IDS,
  NATIONS,
  RELATIONS,
  applyRepChanges,
  areAllies,
  baseHostility,
  emitRepChanges,
  newStanding,
  playerRelation,
  relation,
  repChangesFor,
} from "../factions";
import { ARCHETYPES, rollNpc, titleFor } from "../archetypes";
import { mulberry32 } from "../util";

describe("relation matrix", () => {
  it("is symmetric with self = 100", () => {
    for (const a of FACTION_IDS) {
      expect(RELATIONS[a][a]).toBe(100);
      for (const b of FACTION_IDS) expect(RELATIONS[a][b]).toBe(RELATIONS[b][a]);
    }
  });

  it("lawful nations are friendly-ish, everyone is hostile to pirates", () => {
    for (const a of NATIONS) {
      for (const b of NATIONS) if (a !== b) expect(relation(a, b)).toBeGreaterThan(0);
      expect(relation(a, "pirates")).toBe(-100);
      expect(relation(a, "merchants_guild")).toBeGreaterThan(0);
      expect(areAllies(a, "merchants_guild")).toBe(true);
    }
    expect(relation("merchants_guild", "pirates")).toBe(-100);
    expect(relation("unknown", "spain")).toBe(0);
  });
});

describe("baseHostility (the plug point)", () => {
  it("NPC vs NPC: pirates and lawful ships are mutually hostile, lawful ships are not", () => {
    expect(baseHostility({ faction: "spain" }, { kind: "npc", faction: "pirates" })).toBe(1);
    expect(baseHostility({ faction: "pirates" }, { kind: "npc", faction: "england" })).toBe(1);
    expect(baseHostility({ faction: "spain" }, { kind: "npc", faction: "england" })).toBe(0);
    expect(baseHostility({ faction: "pirates" }, { kind: "npc", faction: "pirates" })).toBe(0);
    expect(baseHostility({ faction: "nobody" }, { kind: "npc", faction: "pirates" })).toBe(0);
  });

  it("NPC vs player: pirates prey on new captains, nations are neutral until notoriety/bounty", () => {
    const s = newStanding();
    expect(baseHostility({ faction: "pirates" }, { kind: "player", standing: s })).toBeCloseTo(0.6);
    expect(baseHostility({ faction: "spain" }, { kind: "player", standing: s })).toBe(0);
    s.bounty = 500;
    expect(baseHostility({ faction: "spain" }, { kind: "player", standing: s })).toBeCloseTo(0.4);
    s.notoriety = 100;
    expect(baseHostility({ faction: "spain" }, { kind: "player", standing: s })).toBeCloseTo(0.9);
    // the guild does not care about notoriety
    expect(baseHostility({ faction: "merchants_guild" }, { kind: "player", standing: s })).toBe(0);
  });
});

describe("reputation", () => {
  it("sinking a Spanish ship angers Spain and its allies, pleases the pirates", () => {
    const ch = repChangesFor("spain", "sink");
    const by = Object.fromEntries(ch.map((c) => [c.faction, c.delta]));
    expect(by.spain).toBe(-20);
    expect(by.portugal).toBe(-10);
    expect(by.merchants_guild).toBe(-10);
    expect(by.pirates).toBe(5);
    const s = applyRepChanges(newStanding(), ch, 10);
    expect(playerRelation("spain", s)).toBe(-20 - 5);
    expect(s.notoriety).toBe(10);
    // clamps
    for (let i = 0; i < 20; i++) applyRepChanges(s, ch, 10);
    expect(s.rep.spain).toBe(-100);
    expect(s.notoriety).toBe(100);
  });

  it("emitRepChanges pushes npcRepChange effects", () => {
    const effects: WorldEffect[] = [];
    emitRepChanges(effects, "p1", [{ faction: "spain", delta: -5 }], "attackedNpc");
    expect(effects).toEqual([{ type: "npcRepChange", playerId: "p1", faction: "spain", delta: -5, reason: "attackedNpc" }]);
  });
});

describe("archetypes", () => {
  it("have sane knobs and titles", () => {
    for (const a of Object.values(ARCHETYPES)) {
      expect(a.aggression).toBeGreaterThanOrEqual(0);
      expect(a.aggression).toBeLessThanOrEqual(1);
      expect(a.courage).toBeGreaterThanOrEqual(0);
      expect(a.courage).toBeLessThanOrEqual(1);
      expect(a.ships.length).toBeGreaterThan(0);
      expect(a.factions.length).toBeGreaterThan(0);
    }
    expect(titleFor("navy", "spain")).toBe("Spanish Navy");
    expect(titleFor("merchant", "netherlands")).toBe("Dutch Merchant");
    expect(titleFor("pirate", "pirates")).toBe("Pirate");
    expect(ARCHETYPES.merchant.surrenders).toBe(true);
    expect(ARCHETYPES.pirate_hunter.stub).toBe(true);
  });

  it("rollNpc is deterministic and respects the archetype", () => {
    const a = rollNpc("navy", mulberry32(1));
    const b = rollNpc("navy", mulberry32(1));
    expect(a).toEqual(b);
    expect(ARCHETYPES.navy.ships).toContain(a.shipType);
    expect(NATIONS).toContain(a.faction);
    expect(rollNpc("pirate", mulberry32(2)).faction).toBe("pirates");
  });
});
