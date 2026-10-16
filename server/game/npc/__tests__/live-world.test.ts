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

let land: LoadedLand;
beforeAll(() => {
  land = loadLandSync(undefined, () => {});
});

describe("live population", () => {
  it("fleet targets total ~300 and every fleet has lanes", () => {
    const fleets = liveFleets();
    const total = fleets.reduce((n, t) => n + t.count, 0);
    expect(total).toBe(300);
    for (const t of fleets) expect(LANES.some((l) => t.lanes!(l)), t.region).toBe(true);
    // Heavy in the Caribbean/Gulf + the Europe–Caribbean crossings.
    const west = fleets.filter((t) => t.region.startsWith("americas") || t.region.startsWith("atlantic")).reduce((n, t) => n + t.count, 0);
    expect(west / total).toBeGreaterThan(0.55);
  });

  it("director fills the world: 300 records, merchants under their origin port's nation, convoys", () => {
    expect(land.version).not.toBeNull();
    const w = new World({ land: land.field, rng: mulberry32(1) });
    const sys = createLiveNpcSystem(w).attach();
    w.step();
    const recs = [...sys.director.records.values()];
    expect(recs.length).toBe(300);
    const nations = new Set(PORTS.map((p) => p.nation));
    const byArch: Record<string, number> = {};
    let convoyMembers = 0;
    for (const r of recs) {
      byArch[r.archetype] = (byArch[r.archetype] ?? 0) + 1;
      if (r.leader != null) convoyMembers++;
      if (r.archetype === "merchant") expect(nations.has(r.faction)).toBe(true);
      if (r.archetype === "pirate") expect(r.faction).toBe("pirates");
      // every spawn point is in open water
      const p = sys.director.positionOf(r)!;
      expect(land.field.distance(p.x, p.z), `${r.region} spawn`).toBeGreaterThan(20);
    }
    console.log(`[npc live] population ${JSON.stringify(byArch)}, convoy/group members ${convoyMembers}`);
    expect(byArch).toMatchObject({ merchant: 160, navy: 55, pirate: 65, privateer: 20 });
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

describe("land avoidance on real coastlines", () => {
  it("100 rail→active NPCs sail random lanes for 3 simulated minutes without getting stuck", () => {
    const w = new World({ land: land.field, rng: mulberry32(2) });
    const sys = createLiveNpcSystem(w, { pinActive: true, director: { maxActive: 100 } }).attach();
    w.step(); // director spawns 300 rail records
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
