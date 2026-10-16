/** NPC2: player standing (rep/notoriety/bounty): persisted shape, restore, client message, decay. */
import { describe, expect, it } from "vitest";
import { World, toPlayerState, type WorldEffect } from "../../world";
import { parseStanding, type ServerMessage } from "@shared/protocol";
import { NpcSystem } from "../index";
import { NOTORIETY_DECAY_PER_MIN, decayNotoriety } from "../factions";
import { mulberry32 } from "../util";

const Z0 = 95_000;
const standingMsgs = (w: World, id: string) =>
  (w.buildMessages(id) as ServerMessage[]).filter((m) => "t" in m && m.t === "standing");

describe("parseStanding", () => {
  it("accepts JSON or objects, drops junk, clamps", () => {
    expect(parseStanding('{"rep":{"spain":-150,"atlantis":5,"england":"x"},"notoriety":12.345,"bounty":-3}')).toEqual({
      rep: { spain: -100 },
      notoriety: 12.3,
      bounty: 0,
    });
    expect(parseStanding("not json")).toBeNull();
    expect(parseStanding(null)).toBeNull();
    expect(parseStanding({})).toEqual({ rep: {}, notoriety: 0, bounty: 0 });
  });
});

describe("standing on the player", () => {
  it("round-trips through toPlayerState / restorePlayer (the Redis record) as a copy", () => {
    const w = new World({ rng: mulberry32(1) });
    const p = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 });
    p.standing = { rep: { spain: -25 }, notoriety: 7, bounty: 0 };
    const saved = toPlayerState(p);
    expect(saved.standing).toEqual(p.standing);
    expect(saved.standing).not.toBe(p.standing);
    const json = JSON.parse(JSON.stringify(saved)); // as Redis would hand it back (standing parsed)
    const w2 = new World({ rng: mulberry32(1) });
    const back = w2.restorePlayer(json);
    expect(back.standing).toEqual({ rep: { spain: -25 }, notoriety: 7, bounty: 0 });
  });

  it("an NPC rep event updates the live standing, emits npcRepChange and sends one `standing` message", () => {
    const w = new World({ rng: mulberry32(8) });
    const sys = new NpcSystem(w, { seed: 4 }).attach();
    const p = w.createPlayer({ id: "p", name: "P", shipType: "galleon", x: 5000, z: Z0, rotationY: 0 });
    w.attachClient("p");
    sys.spawnActive({ archetype: "navy", faction: "spain", x: 5150, z: Z0 });
    w.queueInput("p", { t: "input", s: 1, th: 0, ru: 0, f: 1 });
    const effects: WorldEffect[] = [];
    let msgs: ServerMessage[] = [];
    for (let i = 0; i < 6; i++) {
      w.step();
      effects.push(...w.drainEffects());
      msgs = msgs.concat(standingMsgs(w, "p"));
    }
    expect(effects).toContainEqual(expect.objectContaining({ type: "npcRepChange", playerId: "p", faction: "spain", delta: -5 }));
    expect(p.standing?.rep.spain).toBe(-5);
    expect(p.standing?.notoriety).toBe(2);
    const last = msgs[msgs.length - 1] as any;
    expect(last).toMatchObject({ t: "standing", notoriety: 2 });
    expect(last.rep.spain).toBe(-5);
    // nothing changes → nothing re-sent; re-attach → re-sent
    w.step();
    expect(standingMsgs(w, "p").length).toBe(0);
    w.attachClient("p");
    expect(standingMsgs(w, "p").length).toBe(1);
  });

  it("notoriety decays online (every 10 s) and offline (decayNotoriety on reconnect)", () => {
    const w = new World({ rng: mulberry32(2) });
    new NpcSystem(w, { seed: 1 }).attach();
    const p = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 });
    p.standing = { rep: {}, notoriety: 10, bounty: 0 };
    for (let i = 0; i < 20 * 60; i++) w.step(); // one minute
    expect(p.standing.notoriety).toBeCloseTo(10 - NOTORIETY_DECAY_PER_MIN, 5);
    const s = { notoriety: 3 };
    expect(decayNotoriety(s, 60)).toBe(true);
    expect(s.notoriety).toBe(0);
    expect(decayNotoriety(s, 60)).toBe(false);
  });
});
