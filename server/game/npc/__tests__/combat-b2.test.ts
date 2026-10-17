/**
 * F1 regression for Q1 B2 ("a provoked pirate orbits out of range, never fires, never breaks off").
 * Full system on open water: World (real stepShip, cannonballs, hits) + NpcSystem (brain, tactics,
 * fire control), a real player ship driven by queued inputs. Deterministic (seeded).
 *
 * Root causes found and covered here:
 * 1. Fire gate: ±12° of the beam plus ±aimError noise, judged on the pose BEFORE the tick's rudder
 *    was applied (the World fires after movement; one tick of rudder = 0.15 rad). Shots went 100+
 *    units wide (1 hit in 28 volleys on a still target). Now: hit-circle tolerance + one-tick
 *    lookahead with the real physics (`NpcSystem.aim`), lead along the arc of a turning target.
 * 2. Fair play: a pirate the player hit could lose the 2 attacker slots to its neighbours, drop the
 *    player and sail off without firing. Now: self-defence (SELF_DEFENCE_MS) ignores the slot cap.
 * 3. Friendly fire: a partner's stray ball made pirates turn on each other. Now ignored.
 * 4. Disengage: hp ≤ (1 − courage) × 0.7 (pirate 35 %, privateer 28 %, navy 7 %).
 * 5. Flee circled: evading an orbiting attacker's predicted position swept the escape course round
 *    (the radial in/out loop Q1 measured was most likely a pirate fleeing a navy, not fighting).
 *    Now a fleeing ship commits to a course straight away and re-aims only past FLEE_REAIM_ANGLE.
 */
import { describe, expect, it } from "vitest";
import { World } from "../../world";
import { NpcSystem, type ActiveNpc } from "../index";
import { headingForDir, mulberry32 } from "../util";
import { geoMetric } from "../metric";
import { shouldDisengage } from "../tactics";
import { ARCHETYPES } from "../archetypes";
import { normalizeAngle } from "@shared/physics";

const Z0 = 95_000; // equator band, all-water default field
const EAST = headingForDir(1, 0);
type Mode = "still" | "straight" | "circle";

interface Run {
  fires: number;
  hits: number;
  firstFireS: number;
  firstHitS: number;
}

/**
 * A pirate (`npcShip`) next to a player sloop. The player provokes it with one broadside at t=0
 * (the pirate sits 60 units off the player's starboard beam), then does `mode` for 30 s.
 */
function provokedFight(npcShip: string, mode: Mode, seed: number, seconds = 30, npcOffset = { x: 0, z: 60 }): Run {
  const w = new World({ rng: mulberry32(seed) });
  const sys = new NpcSystem(w, { seed }).attach();
  const pl = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 + 5000, rotationY: EAST });
  pl.hp = pl.maxHp = 1e6; // survive the whole run
  w.attachClient("p");
  const a = sys.spawnActive({ archetype: "pirate", x: 5000 + npcOffset.x, z: Z0 + 5000 + npcOffset.z, shipType: npcShip, rotationY: EAST + seed * 1.3 });
  const r: Run = { fires: 0, hits: 0, firstFireS: -1, firstHitS: -1 };
  let seq = 1;
  for (let t = 0; t < seconds * 20; t++) {
    const th = mode === "still" ? 0 : 1;
    const ru = mode === "circle" ? 1 : 0;
    w.queueInput("p", { t: "input", s: seq++, th, ru, f: t === 0 ? 1 : 0 });
    w.step();
    w.buildFrames("p");
    w.drainEffects();
    for (const ev of w.events) {
      if (ev.kind === "fire" && ev.eid === a.p.eid) {
        r.fires++;
        if (r.firstFireS < 0) r.firstFireS = t / 20;
      }
      if (ev.kind === "hit" && ev.targetEid === pl.eid && ev.ownerEid === a.p.eid) {
        r.hits++;
        if (r.firstHitS < 0) r.firstHitS = t / 20;
      }
    }
  }
  return r;
}

describe("B2: provoked pirates fight (fire and land hits within 30 s)", () => {
  const cases: [string, Mode][] = [
    ["sloop", "still"],
    ["brigantine", "still"],
    ["brigantine", "straight"], // faster pirate runs the sloop down
    ["sloop", "circle"],
    ["brigantine", "circle"],
  ];
  for (const [ship, mode] of cases) {
    it(`pirate ${ship} vs a ${mode} player sloop`, () => {
      for (const seed of [1, 2, 3]) {
        const r = provokedFight(ship, mode, seed);
        expect(r.fires, `seed ${seed} fires`).toBeGreaterThanOrEqual(1);
        expect(r.hits, `seed ${seed} hits`).toBeGreaterThanOrEqual(1);
        // Not just one lucky shot: the guns keep working (reload 1.8–2 s).
        if (mode !== "straight") expect(r.fires, `seed ${seed} sustained fire`).toBeGreaterThanOrEqual(8);
        expect(r.hits / r.fires, `seed ${seed} accuracy`).toBeGreaterThanOrEqual(mode === "straight" ? 0.3 : 0.25);
      }
    });
  }

  it("pirate sloop vs a player sloop sailing straight past it (head-on pass) gets its broadside in", () => {
    // Equal speed: once the player is past, a starboard-only sloop cannot catch it again (a stern
    // chase at equal speed never closes); the pass itself must produce a hit.
    for (const seed of [1, 2, 3]) {
      const w = new World({ rng: mulberry32(seed) });
      const sys = new NpcSystem(w, { seed }).attach();
      const pl = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 + 5000, rotationY: EAST });
      pl.hp = pl.maxHp = 1e6;
      pl.speed = -4;
      w.attachClient("p");
      const a = sys.spawnActive({ archetype: "pirate", x: 6000, z: Z0 + 5000, shipType: "sloop", rotationY: seed * 2 });
      sys.fairplay.provoke("p"); // the player is fair game (shield off)
      let fires = 0;
      let hits = 0;
      for (let t = 0, seq = 1; t < 30 * 20; t++) {
        w.queueInput("p", { t: "input", s: seq++, th: 1, ru: 0, f: 0 });
        w.step();
        w.drainEffects();
        for (const ev of w.events) {
          if (ev.kind === "fire" && ev.eid === a.p.eid) fires++;
          if (ev.kind === "hit" && ev.targetEid === pl.eid) hits++;
        }
      }
      expect(fires, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(hits, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });
});

/** Engage a still player, then drop the NPC's hp to `hpFrac` and watch for 8 s. */
function hurtAndWatch(archetype: "pirate" | "privateer" | "navy", ship: string, hpFrac: number, seed = 1, playerShip = ship) {
  const w = new World({ rng: mulberry32(seed) });
  const sys = new NpcSystem(w, { seed, fairplay: { shieldMs: 0 } }).attach();
  const pl = w.createPlayer({ id: "p", name: "P", shipType: playerShip, x: 5000, z: Z0 + 5000, rotationY: EAST });
  pl.hp = pl.maxHp = 1e6;
  w.attachClient("p");
  const faction = archetype === "pirate" ? "pirates" : "spain";
  // A lawful NPC needs a reason to fight the player: make the player a notorious pirate to them.
  const a: ActiveNpc = sys.spawnActive({ archetype, faction, x: 5000, z: Z0 + 5500, shipType: ship });
  if (archetype !== "pirate") sys.standingOf("p").rep[faction] = -100;
  sys.fairplay.provoke("p");
  a.threat.addDamage(pl.eid, 20, w.timeMs);
  let seq = 1;
  const step = () => {
    w.queueInput("p", { t: "input", s: seq++, th: 0, ru: 0, f: 0 });
    w.step();
    w.drainEffects();
  };
  for (let t = 0; t < 10 * 20; t++) step(); // settle into the fight
  const engagedBefore = a.brain.state === "engage" || a.brain.state === "pursue";
  a.p.hp = Math.max(1, Math.floor(a.p.maxHp * hpFrac));
  const d0 = Math.sqrt(geoMetric.distSq(a.p.x, a.p.z, pl.x, pl.z));
  let fleeAtS = -1;
  for (let t = 0; t < 8 * 20; t++) {
    step();
    if (fleeAtS < 0 && a.brain.state === "flee") fleeAtS = t / 20;
  }
  const d1 = Math.sqrt(geoMetric.distSq(a.p.x, a.p.z, pl.x, pl.z));
  return { engagedBefore, fleeAtS, d0, d1, state: a.brain.state };
}

describe("B2: hurt pirates break off (courage-dependent)", () => {
  it("disengage hp thresholds: pirate 35 %, privateer 28 %, navy 7 %", () => {
    const at = (c: number) => (1 - c) * 0.7;
    expect(at(ARCHETYPES.pirate.courage)).toBeCloseTo(0.35, 6);
    expect(at(ARCHETYPES.privateer.courage)).toBeCloseTo(0.28, 6);
    expect(at(ARCHETYPES.navy.courage)).toBeCloseTo(0.07, 6);
    expect(shouldDisengage(0.34, ARCHETYPES.pirate.courage, 1, 1)).toBe(true); // Q1 saw 17/50 = 34 %: now it runs
    expect(shouldDisengage(0.5, ARCHETYPES.pirate.courage, 1, 1)).toBe(false);
    expect(shouldDisengage(0.3, ARCHETYPES.navy.courage, 1, 1)).toBe(false);
  });

  for (const ship of ["sloop", "brigantine"]) {
    it(`pirate ${ship} at 30 % hp switches to flee within 2 s and opens the distance`, () => {
      const r = hurtAndWatch("pirate", ship, 0.3);
      expect(r.engagedBefore).toBe(true);
      expect(r.fleeAtS).toBeGreaterThanOrEqual(0);
      expect(r.fleeAtS).toBeLessThanOrEqual(2);
      expect(r.d1 - r.d0).toBeGreaterThan(600); // ~8 s at 4–5 units/frame straight away
    });
  }

  it("a pirate brigantine at 30 % breaks off even from a weaker (sloop) player", () => {
    // Browser check found it fought on: vs a sloop its fight score (≈ 2.4 × hostility) beat flee.
    const r = hurtAndWatch("pirate", "brigantine", 0.3, 1, "sloop");
    expect(r.engagedBefore).toBe(true);
    expect(r.fleeAtS).toBeGreaterThanOrEqual(0);
    expect(r.fleeAtS).toBeLessThanOrEqual(2);
    expect(r.d1 - r.d0).toBeGreaterThan(600);
  });

  it("a fleeing pirate holds an escape course instead of circling beside an orbiting attacker", () => {
    // Q1's "375 → 1060 → 375 loop every 9 s" was a pirate in flee: evading a navy's PREDICTED
    // position while the navy orbited it at broadside range swept the escape direction round.
    for (const seed of [1, 2]) {
      const w = new World({ rng: mulberry32(seed) });
      const sys = new NpcSystem(w, { seed }).attach();
      const pir = sys.spawnActive({ archetype: "pirate", x: 5000, z: Z0 + 5000, shipType: "sloop", rotationY: seed });
      sys.spawnActive({ archetype: "navy", faction: "spain", x: 5600, z: Z0 + 5000, shipType: "galleon" });
      pir.p.hp = 10;
      let turned = 0;
      let prevR = pir.p.rotationY;
      let fleeTicks = 0;
      for (let t = 0; t < 20 * 20; t++) {
        w.step();
        w.drainEffects();
        if (pir.p.sunk) break;
        if (pir.brain.state === "flee") fleeTicks++;
        if (t > 60) turned += Math.abs(normalizeAngle(pir.p.rotationY - prevR));
        prevR = pir.p.rotationY;
      }
      // (A galleon is faster than a sloop, so the pirate may still be caught and sunk; that is fine.)
      expect(fleeTicks, `seed ${seed}`).toBeGreaterThan(100);
      // Before F1: ≈ 11.6 rad (almost two full circles) in 17 s = 0.68 rad/s of flight.
      expect(turned / (fleeTicks / 20), `seed ${seed} rad/s`).toBeLessThan(0.3);
    }
  });

  it("a privateer at 25 % runs; a navy man-o-war at 30 % keeps fighting", () => {
    const pr = hurtAndWatch("privateer", "brigantine", 0.25);
    expect(pr.engagedBefore).toBe(true);
    expect(pr.fleeAtS).toBeGreaterThanOrEqual(0);
    const navy = hurtAndWatch("navy", "man-o-war", 0.3);
    expect(navy.engagedBefore).toBe(true);
    expect(navy.fleeAtS).toBe(-1);
    expect(navy.state).toBe("engage");
  });
});

describe("B3: a merchant shot while docked (or arriving) does not sit dead in the water", () => {
  it("a hit cancels the dock idle and the merchant sails out; it will not dock while under fire", () => {
    const w = new World({ rng: mulberry32(3) });
    const lanes = [{ from: "a", to: "b", points: [[2000, Z0 + 5000], [8000, Z0 + 5000]] as [number, number][] }];
    // Only merchants, a safe zone at the lane end (like a port dock): NPCs never fight there.
    const sys = new NpcSystem(w, {
      seed: 3,
      lanes,
      safeZones: [{ x: 8000, z: Z0 + 5000, safeRadius: 600 }],
      director: { minSpawnDist: 0, targets: [{ region: "all", archetype: "merchant", count: 1 }] },
      pinActive: true,
    }).attach();
    const pl = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 7600, z: Z0 + 5200 });
    w.attachClient("p");
    w.step();
    const rec = [...sys.director.records.values()][0];
    const a = rec.tier === "active" ? [...sys.active.values()][0] : sys.promoteRecord(rec)!;
    // Put it at the dock end, idling (as followLaneOrWander does on arrival).
    a.p.x = 8000;
    a.p.z = Z0 + 5000;
    a.p.speed = 0;
    a.rec.rail!.dir = 1;
    sys.director.arrive(a.rec, w.timeMs, true);
    a.idleUntilMs = a.rec.departAtMs;
    expect(a.idleUntilMs - w.timeMs).toBeGreaterThanOrEqual(20_000);
    let seq = 1;
    const tick = (f: 0 | 1 = 0) => {
      w.queueInput("p", { t: "input", s: seq++, th: 0, ru: 0, f });
      w.step();
      w.drainEffects();
    };
    for (let t = 0; t < 40; t++) tick();
    expect(Math.abs(a.p.speed)).toBe(0); // docked
    // The player pulls alongside (merchant on its starboard beam) and fires.
    pl.x = a.p.x;
    pl.z = a.p.z - 60;
    // Starboard of rotationY r points along (sin(r + π/2), cos(r + π/2)): r = −π/2 → +z (the merchant).
    pl.rotationY = -Math.PI / 2;
    tick(1);
    for (let t = 0; t < 5 && a.p.hp === a.p.maxHp; t++) tick();
    expect(a.p.hp).toBeLessThan(a.p.maxHp);
    // Within 2 s it is under way, and it keeps moving (no ≥ 3 s stall) over the next 15 s.
    let stillTicks = 0;
    let maxStill = 0;
    let movingBy = -1;
    for (let t = 0; t < 15 * 20; t++) {
      tick();
      if (Math.abs(a.p.speed) < 0.05) maxStill = Math.max(maxStill, ++stillTicks);
      else {
        stillTicks = 0;
        if (movingBy < 0) movingBy = t / 20;
      }
    }
    expect(movingBy).toBeGreaterThanOrEqual(0);
    expect(movingBy).toBeLessThanOrEqual(2);
    expect(maxStill).toBeLessThan(3 * 20);
    expect(a.rec.port).toBeNull();
  });
});

describe("B2: fair play and friendly fire", () => {
  it("a pirate the player hit fights back even when two other pirates hold both attacker slots", () => {
    const w = new World({ rng: mulberry32(4) });
    const sys = new NpcSystem(w, { seed: 4, fairplay: { shieldMs: 0 } }).attach();
    const pl = w.createPlayer({ id: "p", name: "P", shipType: "sloop", x: 5000, z: Z0 + 5000, rotationY: EAST });
    pl.hp = pl.maxHp = 1e6;
    w.attachClient("p");
    // Two pirates already on the player (slots full) ...
    sys.spawnActive({ archetype: "pirate", x: 5000, z: Z0 + 4400, shipType: "sloop" });
    sys.spawnActive({ archetype: "pirate", x: 4400, z: Z0 + 5000, shipType: "sloop" });
    let seq = 1;
    for (let t = 0; t < 6 * 20; t++) {
      w.queueInput("p", { t: "input", s: seq++, th: 0, ru: 0, f: 0 });
      w.step();
      w.drainEffects();
    }
    expect(sys.fairplay.attackerCount("p")).toBe(2);
    // ... then a third pirate sails into the player's starboard beam and gets a broadside.
    const third = sys.spawnActive({ archetype: "pirate", x: pl.x, z: pl.z + 60, shipType: "sloop", rotationY: pl.rotationY });
    let firesThird = 0;
    let hitsThird = 0;
    for (let t = 0; t < 20 * 20; t++) {
      w.queueInput("p", { t: "input", s: seq++, th: 0, ru: 0, f: t === 0 ? 1 : 0 });
      w.step();
      w.drainEffects();
      for (const ev of w.events) {
        if (ev.kind === "fire" && ev.eid === third.p.eid) firesThird++;
        if (ev.kind === "hit" && ev.ownerEid === third.p.eid && ev.targetEid === pl.eid) hitsThird++;
      }
    }
    expect(third.p.hp).toBeLessThan(third.p.maxHp); // it was hit
    expect(third.brain.targetEid).toBe(pl.eid);
    expect(firesThird).toBeGreaterThanOrEqual(3);
    expect(hitsThird).toBeGreaterThanOrEqual(1);
  });

  it("a stray ball from an ally adds no threat and does not turn allies on each other", () => {
    const w = new World({ rng: mulberry32(2) });
    const sys = new NpcSystem(w, { seed: 2 }).attach();
    const a = sys.spawnActive({ archetype: "pirate", x: 5000, z: Z0 + 5000, shipType: "sloop", rotationY: 0 });
    const b = sys.spawnActive({ archetype: "pirate", x: 5060, z: Z0 + 5000, shipType: "sloop" });
    // a's starboard (r = 0 → +x) points at b: fire once.
    w.npcHook = (world) => world.setNpcInput(a.p, { th: 0, ru: 0, f: 1 });
    for (let t = 0; t < 6; t++) {
      w.step();
      w.drainEffects();
    }
    expect(b.p.hp).toBeLessThan(b.p.maxHp);
    expect(b.threat.threatOf(a.p.eid)).toBe(0);
  });
});
