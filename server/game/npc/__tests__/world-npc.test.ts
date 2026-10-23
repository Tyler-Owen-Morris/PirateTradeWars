import { describe, expect, it } from "vitest";
import { GRACE_PERIOD, TICK_MS, World, isNpcId, type WorldEffect } from "../../world";
import { FIRE_STARBOARD } from "@shared/physics";
import type { EntMessage } from "@shared/protocol";
import { parseEntNpcMeta } from "@shared/protocol";
import { NpcSystem, npcsEnabled } from "../index";
import { mulberry32 } from "../util";

/** These scenarios are about logic, not geography: they run on the default all-water field
 *  (ocean + polar ice) near the equator, where an x unit is ~1 metric unit. z = Z0 + local z. */
const Z0 = 95_000;

function npcInit(over: Partial<Parameters<World["addNpc"]>[0]> = {}) {
  return { name: "Revenge", shipType: "sloop", x: 5000, z: Z0 + 5000, faction: "pirates", title: "Pirate", ...over };
}

describe("World NPC plumbing", () => {
  it("addNpc: npc controller, reserved id, shared eid space, never disconnected", () => {
    const w = new World({ rng: mulberry32(1) });
    const p = w.createPlayer({ id: "p1", name: "P1", shipType: "sloop", x: 1000, z: Z0 + 1000 });
    const n = w.addNpc(npcInit());
    expect(n.controller).toBe("npc");
    expect(p.controller).toBe("player");
    expect(isNpcId(n.id)).toBe(true);
    expect(isNpcId(p.id)).toBe(false);
    expect(n.eid).not.toBe(p.eid);
    expect(w.addNpc(npcInit()).id).not.toBe(n.id);
    expect(n.connected).toBe(true);
    w.setConnected(n.id, false);
    expect(n.connected).toBe(true);
    expect(w.queueInput(n.id, { t: "input", s: 1, th: 1, ru: 0, f: 0 })).toBe(false);
    // never times out
    for (let i = 0; i < GRACE_PERIOD / TICK_MS + 40; i++) w.step();
    expect(w.byEid.get(n.eid)).toBe(n);
    expect(w.drainEffects().some((e) => e.type === "playerRemoved")).toBe(false);
    expect(w.removeNpc(p.eid)).toBe(false); // not an NPC
    expect(w.removeNpc(n.eid)).toBe(true);
    expect(w.byEid.get(n.eid)).toBeUndefined();
  });

  it("the AI hook runs before movement each tick and its input drives the ship (and guns)", () => {
    const w = new World({ rng: mulberry32(1) });
    const n = w.addNpc(npcInit());
    const seen: number[] = [];
    w.npcHook = (world, prev) => {
      seen.push(world.tick);
      expect(Array.isArray(prev)).toBe(true);
      world.setNpcInput(n, { th: 1, ru: 0, f: world.tick === 3 ? FIRE_STARBOARD : 0 });
    };
    const z0 = n.z;
    for (let i = 0; i < 5; i++) w.step();
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(n.z).toBeLessThan(z0); // sailed north
    expect(w.balls.length).toBe(1); // fired the starboard battery once at tick 3 (no connection needed)
  });

  it("ent carries npc/faction/title for NPCs only", () => {
    const w = new World({ rng: mulberry32(1) });
    w.createPlayer({ id: "viewer", name: "V", shipType: "sloop", x: 5000, z: Z0 + 5000 });
    w.createPlayer({ id: "other", name: "O", shipType: "sloop", x: 5100, z: Z0 + 5000 });
    const n = w.addNpc(npcInit({ x: 5200, faction: "spain", title: "Spanish Navy" }));
    w.attachClient("viewer");
    w.step();
    const ents = w.buildMessages("viewer").filter((m) => "t" in m && m.t === "ent") as EntMessage[];
    const npcEnt = ents.find((e) => e.eid === n.eid)!;
    expect(npcEnt).toMatchObject({ npc: 1, faction: "spain", title: "Spanish Navy" });
    expect(parseEntNpcMeta(npcEnt)).toEqual({ faction: "spain", title: "Spanish Navy" });
    const playerEnt = ents.find((e) => e.id === "other")!;
    expect("npc" in playerEnt).toBe(false);
    expect(parseEntNpcMeta(playerEnt)).toBeNull();
    expect(parseEntNpcMeta({ npc: 1, faction: 5, title: "x".repeat(100) })).toEqual({});
  });

  function sinkWith(w: World, shooterId: string, targetEid: number) {
    const shooter = w.getPlayer(shooterId)!;
    const target = w.byEid.get(targetEid)!;
    target.hp = 1;
    // put the target on the shooter's starboard beam, 100 units away
    target.x = shooter.x + 100;
    target.z = shooter.z;
    shooter.rotationY = 0;
    if (shooter.controller === "npc") {
      w.npcHook = (world) => world.setNpcInput(shooter, { th: 0, ru: 0, f: 1 });
    } else {
      w.queueInput(shooterId, { t: "input", s: shooter.highestSeq + 1, th: 0, ru: 0, f: 1 });
    }
    const effects: WorldEffect[] = [];
    for (let i = 0; i < 10; i++) {
      w.step();
      effects.push(...w.drainEffects());
    }
    w.npcHook = null;
    return effects;
  }

  it("a sunk NPC emits npcSunk (never playerSunk); a player sunk by an NPC is flagged byNpc", () => {
    const w = new World({ rng: mulberry32(1) });
    w.createPlayer({ id: "p1", name: "P1", shipType: "sloop", x: 5000, z: Z0 + 5000 });
    const n = w.addNpc(npcInit({ x: 6000, gold: 0 }));
    const eff = sinkWith(w, "p1", n.eid);
    expect(eff.some((e) => e.type === "playerSunk")).toBe(false);
    expect(eff).toContainEqual(expect.objectContaining({ type: "npcSunk", eid: n.eid, killerId: "p1" }));

    const w2 = new World({ rng: mulberry32(1) });
    const victim = w2.createPlayer({ id: "p2", name: "P2", shipType: "sloop", x: 5000, z: Z0 + 5000 });
    const shooter = w2.addNpc(npcInit({ x: 3000, z: Z0 + 3000 }));
    const eff2 = sinkWith(w2, shooter.id, victim.eid);
    expect(eff2).toContainEqual(expect.objectContaining({ type: "playerSunk", playerId: "p2", byNpc: true }));
  });

  it("NPC gold pickup never produces a Redis effect", () => {
    const w = new World({ rng: mulberry32(1) });
    const n = w.addNpc(npcInit());
    w.dropGold(n.x, n.z, 50);
    w.step();
    expect(n.gold).toBe(50);
    expect(w.drainEffects().some((e) => e.type === "goldCollected")).toBe(false);
  });

  it("NPCS_ENABLED gates the system (NPC2: default ON, 0/false/off/no disables)", () => {
    expect(npcsEnabled({})).toBe(true);
    expect(npcsEnabled({ NPCS_ENABLED: "" })).toBe(true);
    expect(npcsEnabled({ NPCS_ENABLED: "1" })).toBe(true);
    expect(npcsEnabled({ NPCS_ENABLED: "true" })).toBe(true);
    expect(npcsEnabled({ NPCS_ENABLED: "0" })).toBe(false);
    expect(npcsEnabled({ NPCS_ENABLED: "false" })).toBe(false);
    expect(npcsEnabled({ NPCS_ENABLED: " OFF " })).toBe(false);
  });
});

describe("NpcSystem fair play in the world", () => {
  it("pirates hunt an unshielded player but never more than 2 at once; none fight in port", () => {
    const w = new World({ rng: mulberry32(5) });
    const sys = new NpcSystem(w, { seed: 3, fairplay: { shieldMs: 0 }, safeZones: [{ x: 8000, z: Z0 + 8000, safeRadius: 600 }] }).attach();
    const p = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 + 5000 });
    for (let i = 0; i < 5; i++) sys.spawnActive({ archetype: "pirate", x: 5000 + 400 * Math.cos(i), z: Z0 + 5000 + 400 * Math.sin(i), shipType: "sloop" });
    let maxAttackers = 0;
    let engaged = false;
    for (let t = 0; t < 400; t++) {
      w.step();
      w.drainEffects();
      maxAttackers = Math.max(maxAttackers, sys.fairplay.attackerCount("p"));
      sys.active.forEach((a) => {
        if (a.brain.targetEid === p.eid && a.brain.state === "engage") engaged = true;
      });
    }
    expect(engaged).toBe(true);
    expect(maxAttackers).toBe(2);
    expect(p.hp).toBeLessThan(p.maxHp);

    // In the safe zone nobody may target the player.
    const w2 = new World({ rng: mulberry32(5) });
    const sys2 = new NpcSystem(w2, { seed: 3, fairplay: { shieldMs: 0 }, safeZones: [{ x: 5000, z: Z0 + 5000, safeRadius: 600 }] }).attach();
    const q = w2.createPlayer({ id: "q", name: "Q", shipType: "sloop", x: 5000, z: Z0 + 5000 });
    sys2.spawnActive({ archetype: "pirate", x: 5300, z: Z0 + 5000, shipType: "sloop" });
    for (let t = 0; t < 200; t++) {
      w2.step();
      w2.drainEffects();
      sys2.active.forEach((a) => expect(a.brain.targetEid === q.eid && a.brain.state === "engage").toBe(false));
    }
    expect(q.hp).toBe(q.maxHp);
  });

  it("hitting an NPC provokes (drops the shield), changes rep and calls allies for help", () => {
    const w = new World({ rng: mulberry32(8) });
    const sys = new NpcSystem(w, { seed: 4 }).attach();
    const p = w.createPlayer({ id: "p", name: "P", shipType: "galleon", x: 5000, z: Z0 + 5000, rotationY: 0 });
    const victim = sys.spawnActive({ archetype: "navy", faction: "spain", x: 5150, z: Z0 + 5000 });
    const ally = sys.spawnActive({ archetype: "navy", faction: "portugal", x: 5150, z: Z0 + 6000 });
    w.queueInput("p", { t: "input", s: 1, th: 0, ru: 0, f: 1 });
    const effects: WorldEffect[] = [];
    for (let i = 0; i < 6; i++) {
      w.step();
      effects.push(...w.drainEffects());
    }
    expect(victim.threat.threatOf(p.eid)).toBeGreaterThan(0);
    expect(ally.threat.threatOf(p.eid)).toBeGreaterThan(0); // called for help
    expect(sys.fairplay.isProvoked("p")).toBe(true);
    expect(effects).toContainEqual(expect.objectContaining({ type: "npcRepChange", playerId: "p", faction: "spain", delta: -5 }));
    expect(sys.standingOf("p").rep.spain).toBe(-5);
  });
});

describe("NpcSystem integration", () => {
  it("50 NPCs + 10 players for 60 simulated seconds: no exceptions, NPCs move, some fight", () => {
    const w = new World({ rng: mulberry32(42) });
    const sys = new NpcSystem(w, { seed: 7 }).attach();
    const rng = mulberry32(99);
    const players: string[] = [];
    // 10 player clusters spread over the map; around each 5 NPCs: 2 pirates, 2 navy, 1 merchant.
    for (let c = 0; c < 10; c++) {
      const cx = 800 + (c % 5) * 2000;
      const cz = Z0 + 1500 + Math.floor(c / 5) * 5000;
      const id = `p${c}`;
      w.createPlayer({ id, name: id, shipType: c % 2 ? "brigantine" : "sloop", x: cx, z: cz });
      w.attachClient(id);
      players.push(id);
      const around = (r: number) => {
        const a = rng() * Math.PI * 2;
        return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
      };
      for (const arch of ["pirate", "pirate", "navy", "navy", "merchant"] as const) {
        const pos = around(500 + rng() * 700);
        sys.spawnActive({ archetype: arch, x: pos.x, z: pos.z, rotationY: rng() * 6 - 3 });
      }
    }
    expect(sys.active.size).toBe(50);
    const start = new Map([...sys.active.values()].map((a) => [a.p.eid, { x: a.p.x, z: a.p.z }]));
    const states = new Set<string>();
    let seq = 1;
    let total = 0;
    let worst = 0;
    const ticks = 60 * 20;
    for (let t = 0; t < ticks; t++) {
      for (const id of players) w.queueInput(id, { t: "input", s: seq, th: 1, ru: t % 80 < 40 ? 1 : 0, f: 0 });
      seq++;
      const t0 = performance.now();
      w.step();
      for (const id of players) w.buildFrames(id);
      const dt = performance.now() - t0;
      total += dt;
      worst = Math.max(worst, dt);
      w.drainEffects();
      sys.active.forEach((a) => states.add(a.brain.state));
    }
    let moved = 0;
    for (const [eid, s] of start) {
      const p = w.byEid.get(eid);
      if (!p || p.sunk || Math.sqrt((p.x - s.x) ** 2 + (p.z - s.z) ** 2) > 100) moved++;
    }
    console.log(
      `[npc] 50 NPCs + 10 players, 60 s: avg ${(total / ticks).toFixed(3)} ms/tick (step+frames), worst ${worst.toFixed(2)} ms, ` +
        `npc system max ${sys.stats.maxTickMs.toFixed(2)} ms; fires=${sys.stats.fires} hitsByNpc=${sys.stats.hitsByNpc} ` +
        `sunk=${sys.stats.sunkNpcs} states=${[...states].join(",")}`,
    );
    expect(moved).toBeGreaterThanOrEqual(45);
    expect(sys.stats.fires).toBeGreaterThan(10);
    expect(sys.stats.hitsByNpc).toBeGreaterThan(0);
    expect(states.has("engage")).toBe(true);
    expect(states.has("flee")).toBe(true);
    // players are new: shielded, so no NPC attacked them
    for (const id of players) expect(sys.fairplay.attackerCount(id)).toBe(0);
    expect(total / ticks).toBeLessThan(25);
  });

  it("budget: 300 persistent NPCs (director + lanes, ≤ 80 active) + 200 players", () => {
    const w = new World({ rng: mulberry32(1) });
    // A grid of lanes over the whole 10000² map.
    const lanes = [];
    for (let i = 0; i < 10; i++) {
      const c = 500 + i * 1000;
      lanes.push({ from: `h${i}`, to: `h${i + 1}`, points: [[0, Z0 + c], [5000, Z0 + c], [10000, Z0 + c]] as [number, number][] });
      lanes.push({ from: `v${i}`, to: `v${i + 1}`, points: [[c, Z0], [c, Z0 + 5000], [c, Z0 + 10000]] as [number, number][] });
    }
    const sys = new NpcSystem(w, { seed: 1, lanes, director: { minSpawnDist: 0 } }).attach();
    const rng = mulberry32(2);
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `b${i}`;
      w.createPlayer({ id, name: id, shipType: "sloop", x: rng() * 10000, z: Z0 + rng() * 10000 });
      w.attachClient(id);
      ids.push(id);
    }
    let seq = 1;
    const ticks = 400;
    let total = 0;
    let npcTotal = 0;
    for (let t = 0; t < ticks; t++) {
      for (const id of ids) w.queueInput(id, { t: "input", s: seq, th: 1, ru: (t + seq) % 60 < 20 ? 1 : 0, f: 0 });
      seq++;
      const t0 = performance.now();
      w.step();
      for (const id of ids) w.buildFrames(id);
      total += performance.now() - t0;
      npcTotal += sys.stats.lastTickMs;
      w.drainEffects();
    }
    console.log(
      `[npc budget] records=${sys.stats.records} active=${sys.stats.active}: avg ${(total / ticks).toFixed(2)} ms/tick ` +
        `(step + frames for 200 clients), npc system avg ${(npcTotal / ticks).toFixed(3)} ms, max ${sys.stats.maxTickMs.toFixed(2)} ms`,
    );
    expect(sys.stats.records).toBeLessThanOrEqual(300); // a sunk slot waits 2–5 min for its respawn
    expect(sys.stats.records).toBeGreaterThan(290);
    expect(sys.stats.active).toBeLessThanOrEqual(80);
    expect(sys.stats.active).toBeGreaterThan(40);
    expect(total / ticks).toBeLessThan(25);
  });
});
