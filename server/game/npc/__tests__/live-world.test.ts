/**
 * NPC2: NPCs on the REAL map (land from the committed SDF tiles via landLoader, lanes.json,
 * ports.json). Slow-ish (loads ~20 MB of tiles once); the scenarios are about geography.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { World } from "../../world";
import { loadLandSync, type LoadedLand } from "../../landLoader";
import { createLiveNpcSystem, type ActiveNpc } from "../index";
import { LANES, PORTS, laneZone, liveFleets } from "../population";
import { mulberry32 } from "../util";
import { metricDistSq } from "@shared/world/geo";
import { SHIP_STATS } from "@shared/gameConstants";
import { FIRE_STARBOARD } from "@shared/physics";

let land: LoadedLand;
beforeAll(() => {
  land = loadLandSync(undefined, () => {});
});

describe("live population", () => {
  it("fleet targets total 185 and every fleet has lanes", () => {
    const fleets = liveFleets();
    const total = fleets.reduce((n, t) => n + t.count, 0);
    expect(total).toBe(185);
    for (const t of fleets) expect(LANES.some((l) => t.lanes!(l)), t.region).toBe(true);
    // Heavy in the Caribbean/Gulf + the Europe–Caribbean crossings.
    const sum = (pre: string) => fleets.filter((t) => t.region.startsWith(pre)).reduce((n, t) => n + t.count, 0);
    expect((sum("americas") + sum("atlantic")) / total).toBeGreaterThan(0.45);
    // New Horizons phase 1 added the south/pacific fleets without emptying the Caribbean.
    expect(sum("americas")).toBe(72);
    expect(sum("south")).toBe(17);
    expect(sum("pacific")).toBe(15);
  });

  it("new lanes get zones: Brazil and the River Plate are 'south', the Pacific coast 'pacific', the galleon 'east'", () => {
    const zone = (a: string, b: string) => laneZone(LANES.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a))!);
    expect(zone("lisbon", "rio_de_janeiro")).toBe("south");
    expect(zone("buenos_aires", "montevideo")).toBe("south");
    expect(zone("callao", "panama")).toBe("pacific");
    expect(zone("buenos_aires", "valparaiso")).toBe("pacific"); // round the Horn
    expect(zone("acapulco", "manila")).toBe("east");
    expect(zone("cartagena", "portobelo")).toBe("americas");
  });

  it("director fills the world: 185 records, merchants under their origin port's nation, convoys", () => {
    expect(land.version).not.toBeNull();
    const w = new World({ land: land.field, rng: mulberry32(1) });
    const sys = createLiveNpcSystem(w).attach();
    w.step();
    const recs = [...sys.director.records.values()];
    expect(recs.length).toBe(185);
    const nations = new Set(PORTS.map((p) => p.nation));
    const byArch: Record<string, number> = {};
    let convoyMembers = 0;
    for (const r of recs) {
      byArch[r.archetype] = (byArch[r.archetype] ?? 0) + 1;
      if (r.leader != null) convoyMembers++;
      if (r.archetype === "merchant") {
        expect(r.faction).not.toBe("pirates");
        expect(nations.has(r.faction) || r.faction === "merchants_guild").toBe(true);
      }
      if (r.archetype === "pirate") expect(r.faction).toBe("pirates");
      // every spawn point is in open water
      const p = sys.director.positionOf(r)!;
      expect(land.field.distance(p.x, p.z), `${r.region} spawn`).toBeGreaterThan(20);
    }
    console.log(`[npc live] population ${JSON.stringify(byArch)}, convoy/group members ${convoyMembers}`);
    expect(byArch).toMatchObject({ merchant: 98, navy: 37, pirate: 40, privateer: 10 });
    expect(convoyMembers).toBeGreaterThan(20);
    // navies patrol home waters: every navy lane touches a port of its nation
    for (const r of recs) {
      if (r.archetype !== "navy") continue;
      const l = r.rail!.poly.lane;
      const ends = [l.from, l.to].map((id) => PORTS.find((p) => p.id === id)!.nation);
      expect(ends, `${r.region} ${l.from}-${l.to}`).toContain(r.faction);
    }
    expect(laneZone(LANES.find((l) => l.from === "havana" && l.to === "seville")!)).toBe("atlantic");
  });
});

describe("load: 200 players + the live NPC fleets on the real map", () => {
  it.each([
    ["spread over all ports", false],
    ["packed at the 5 starter ports (the real spawn)", true],
  ])("average tick (step + frames for 200 clients) stays under 25 ms: %s", (label, packed) => {
    const w = new World({ land: land.field, rng: mulberry32(11) });
    const sys = createLiveNpcSystem(w, { director: { minSpawnDist: 0 } }).attach();
    const rng = mulberry32(12);
    // Players crowd the ports: ~7 per port within 2 km of its spawn, or (packed) wherever the
    // World spawns new players (the starter ports, ~40 each).
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `b${i}`;
      const shipType = i % 3 ? "sloop" : "brigantine";
      if (packed) w.createPlayer({ id, name: id, shipType });
      else {
        const s = w.spawnPoint(PORTS[i % PORTS.length].spawn, 2000);
        w.createPlayer({ id, name: id, shipType, x: s.x, z: s.z, rotationY: rng() * 6 - 3 });
      }
      w.attachClient(id);
      ids.push(id);
    }
    const TICKS = 600;
    let seq = 1;
    let total = 0;
    let worst = 0;
    let npcTotal = 0;
    let bytes = 0;
    let npcSunk = 0;
    for (let t = 0; t < TICKS; t++) {
      for (const id of ids) w.queueInput(id, { t: "input", s: seq, th: 1, ru: (t + seq) % 90 < 25 ? 1 : 0, f: t % 40 === 0 ? FIRE_STARBOARD : 0 }); // one battery: same ball load as before broadsides
      seq++;
      const t0 = performance.now();
      w.step();
      for (const id of ids) {
        const frames = w.buildFrames(id);
        if (t % 100 === 0) for (const f of frames) bytes += f.length;
      }
      const dt = performance.now() - t0;
      total += dt;
      if (t > 20 && dt > worst) worst = dt;
      npcTotal += sys.stats.lastTickMs;
      for (const e of w.drainEffects()) if (e.type === "npcSunk") npcSunk++;
    }
    const avg = total / TICKS;
    console.log(
      `[npc live load: ${label}] 200 players + ${sys.stats.records} NPC records (${sys.stats.active} active): avg ${avg.toFixed(2)} ms/tick ` +
        `(step + frames), worst ${worst.toFixed(2)} ms; npc system avg ${(npcTotal / TICKS).toFixed(3)} ms, max ${sys.stats.maxTickMs.toFixed(2)} ms; ` +
        `path plans ${sys.stats.navPlans} (max ${sys.stats.navMaxMs.toFixed(2)} ms), lod max ${sys.stats.lodMaxMs.toFixed(2)} ms, unsticks ${sys.stats.unsticks}; ~${(bytes / 6 / 200 / 1024).toFixed(1)} KB/tick/client`,
    );
    // A record sunk in the melee (e.g. pirate friendly fire, more likely since NPCs have two
    // batteries) is gone until the director respawns it 2–5 min later.
    expect(sys.stats.records + npcSunk).toBe(185);
    expect(npcSunk).toBeLessThanOrEqual(3);
    expect(sys.stats.active).toBeLessThanOrEqual(80);
    expect(sys.stats.active).toBeGreaterThan(20);
    expect(avg).toBeLessThan(25);
  }, 120_000);
});

/** Live fleet counts before they were halved on 2026-10-16 (region label -> count, 300 total). */
const FLEET_300: Record<string, number> = {
  "americas/merchant": 60, "atlantic/merchant": 30, "europe/merchant": 30, "africa/merchant": 12, "east/merchant": 28,
  "americas/navy/spain": 10, "americas/navy/england": 8, "americas/navy/france": 4, "americas/navy/netherlands": 3,
  "europe/navy/england": 5, "europe/navy/spain": 4, "europe/navy/france": 3, "europe/navy/netherlands": 3, "europe/navy/portugal": 3,
  "east/navy/portugal": 4, "east/navy/netherlands": 4, "east/navy/spain": 4,
  "americas/pirate/havens": 35, "americas/pirate/lanes": 6, "atlantic/pirate": 12, "east/pirate/sainte_marie": 12,
  "americas/privateer": 16, "atlantic/privateer": 4,
};

describe("land avoidance on real coastlines", () => {
  it("100 rail→active NPCs sail random lanes for 3 simulated minutes without getting stuck", () => {
    const w = new World({ land: land.field, rng: mulberry32(2) });
    // Steering test, not a population test: it samples from the pre-2026-10-16 fleet (300) so the
    // 100 picks don't shift when the live counts are tuned. The result is sample-sensitive: other
    // samples hit known stuck spots (e.g. a navy on charleston-havana), see server/game/npc/README.md.
    const targets = liveFleets().map((t) => ({ ...t, count: FLEET_300[t.region] ?? t.count }));
    const sys = createLiveNpcSystem(w, { pinActive: true, director: { maxActive: 100, maxPersistent: 400, targets } }).attach();
    w.step(); // director spawns ~300 rail records
    const rng = mulberry32(3);
    const pool = [...sys.director.records.values()];
    const picked: ActiveNpc[] = [];
    while (picked.length < 100 && pool.length) {
      const r = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const a = sys.promoteRecord(r);
      if (a) picked.push(a);
    }
    expect(picked.length).toBe(100);

    const TICKS = 3 * 60 * 20;
    const WINDOW = 10; // seconds
    const hist = new Map<number, { x: number; z: number; free: boolean }[]>();
    const stuckRun = new Map<number, number>();
    let maxStuck = 0;
    let stuckSeconds = 0;
    let onLandTicks = 0;
    const pinRun = new Map<number, number>();
    let maxPin = 0;
    let movingSamples = 0;
    let worstEid = -1;
    const t0 = performance.now();
    for (let t = 1; t <= TICKS; t++) {
      w.step();
      w.drainEffects();
      for (const a of picked) {
        const p = a.p;
        if (p.sunk || !sys.active.has(p.eid)) continue;
        const d = land.field.distance(p.x, p.z);
        if (d < 0) onLandTicks++;
        // Pinned: hull against the coast and (almost) no way on, in ANY state but a deliberate stop.
        const deliberate = a.brain.state === "surrender" || w.timeMs < a.idleUntilMs || !!a.rec.port;
        if (!deliberate && d < (p.physics.hullRadius ?? 20) + 5 && Math.abs(p.speed) < 0.3) {
          const run = (pinRun.get(p.eid) ?? 0) + 1;
          pinRun.set(p.eid, run);
          if (run > maxPin) maxPin = run;
        } else pinRun.set(p.eid, 0);
      }
      if (t % 20 !== 0) continue;
      for (const a of picked) {
        const p = a.p;
        if (p.sunk || !sys.active.has(p.eid)) continue;
        // "free to sail": travelling/patrolling, not idling in port by design
        const free = (a.brain.state === "travel" || a.brain.state === "patrol") && w.timeMs >= a.idleUntilMs && !a.rec.port;
        const h = hist.get(p.eid) ?? [];
        h.push({ x: p.x, z: p.z, free });
        if (h.length > WINDOW + 1) h.shift();
        hist.set(p.eid, h);
        if (h.length <= WINDOW || !h.every((s) => s.free)) {
          stuckRun.set(p.eid, 0);
          continue;
        }
        movingSamples++;
        const moved = Math.sqrt(metricDistSq(h[0].x, h[0].z, p.x, p.z));
        const expected = (SHIP_STATS[p.shipType]?.speed ?? 4) * 20 * WINDOW;
        if (moved < expected * 0.15) {
          const run = (stuckRun.get(p.eid) ?? 0) + 1;
          stuckRun.set(p.eid, run);
          stuckSeconds++;
          if (run > maxStuck) {
            maxStuck = run;
            worstEid = p.eid;
          }
        } else stuckRun.set(p.eid, 0);
      }
    }
    const ms = performance.now() - t0;
    const worst = picked.find((a) => a.p.eid === worstEid);
    console.log(
      `[npc live] 100 active NPCs on real land, ${TICKS / 20} s: ${(ms / TICKS).toFixed(2)} ms/tick; ` +
        `stuck (>10 s window, <15% progress) max run ${maxStuck} s beyond the window, total ${stuckSeconds} NPC·s of ${movingSamples} moving samples; ` +
        `on-land ticks ${onLandTicks}; longest pinned against a coast ${(maxPin / 20).toFixed(1)} s; unsticks ${sys.stats.unsticks}; path plans ${sys.stats.navPlans}` +
        (worst ? `; worst ${worst.rec.title} at ${worst.p.x.toFixed(0)},${worst.p.z.toFixed(0)} lane ${worst.rec.rail?.poly.lane.from}-${worst.rec.rail?.poly.lane.to}` : ""),
    );
    // A run of 0 means it made progress within every 10 s window. Allow a short stall beyond it.
    expect(maxStuck).toBeLessThanOrEqual(5);
    expect(stuckSeconds / Math.max(1, movingSamples)).toBeLessThan(0.01);
    // Ship centres inside land: physics pushes hulls out every sub-step, so this is only a rare
    // one-tick graze on a thin spit (reported above).
    expect(onLandTicks).toBeLessThan(20);
    expect(maxPin / 20).toBeLessThan(10); // never pinned on land for 10 s, whatever the state
  }, 120_000);
});
