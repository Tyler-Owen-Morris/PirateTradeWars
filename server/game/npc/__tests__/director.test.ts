import { describe, expect, it } from "vitest";
import { World } from "../../world";
import { DEFAULT_DIRECTOR, Director, DIRECTOR_INTERVAL_MS, MIN_SPAWN_DIST } from "../director";
import { ACTIVE_RADIUS, DEMOTE_RADIUS, advanceRail, buildPolyline, nextTier, pointAt, projectOnto, type Lane } from "../lod";
import { torusMetric } from "../metric";
import { NpcSystem } from "../index";
import { mulberry32 } from "../util";

const W = 10000;
const m = torusMetric(W, W);

/** Fixture in the WORLD_SPEC §6 format (x unwrapped along a route). */
const LANES: Lane[] = [
  { from: "a", to: "b", points: [[1000, 1000], [5000, 1000], [9000, 1000]] },
  { from: "b", to: "c", points: [[9000, 1000], [9000, 5000], [9000, 9000]] },
  { from: "c", to: "a", points: [[9000, 9000], [5000, 5000], [1000, 1000]] },
  // crosses the seam: x unwrapped past W
  { from: "c", to: "d", points: [[9500, 9000], [10500, 9000]] },
];

describe("lanes and rails", () => {
  it("polyline lengths, positions and projection (wrap-aware)", () => {
    const p = buildPolyline(LANES[0], m);
    expect(p.total).toBeCloseTo(8000);
    expect(pointAt(p, 2000, m)).toMatchObject({ x: 3000, z: 1000, dx: 1, dz: 0 });
    expect(pointAt(p, 2000, m, -1).dx).toBe(-1);
    expect(pointAt(p, 99999, m).x).toBe(9000);
    expect(projectOnto(p, 4200, 1300, m).s).toBeCloseTo(3200);
    const seam = buildPolyline(LANES[3], m);
    expect(seam.total).toBeCloseTo(1000);
    expect(pointAt(seam, 600, m).x).toBeCloseTo(100); // 10100 wrapped
  });

  it("advanceRail moves at its speed and reports the end", () => {
    const r = { poly: buildPolyline(LANES[0], m), s: 0, dir: 1 as const, speed: 200 };
    expect(advanceRail(r, 10)).toBe(false);
    expect(r.s).toBe(2000);
    expect(advanceRail(r, 100)).toBe(true);
    expect(r.s).toBe(8000);
  });
});

describe("LOD transitions", () => {
  const sq = (d: number) => d * d;
  it("rail → active inside 2500; active → rail only beyond 2800 and never in combat", () => {
    expect(nextTier("rail", sq(ACTIVE_RADIUS + 1), false)).toBe("rail");
    expect(nextTier("rail", sq(ACTIVE_RADIUS - 1), false)).toBe("active");
    expect(nextTier("active", sq(ACTIVE_RADIUS + 100), false)).toBe("active"); // hysteresis band
    expect(nextTier("active", sq(DEMOTE_RADIUS + 1), false)).toBe("rail");
    expect(nextTier("active", sq(DEMOTE_RADIUS + 1), true)).toBe("active");
    expect(nextTier("docked", 0, false)).toBe("docked");
    expect(nextTier("rail", Infinity, false)).toBe("rail");
  });
});

describe("Director", () => {
  const cfg = (over: Partial<typeof DEFAULT_DIRECTOR> = {}) => ({
    ...DEFAULT_DIRECTOR,
    targets: [
      { region: "all", archetype: "merchant" as const, count: 6 },
      { region: "all", archetype: "pirate" as const, count: 4 },
    ],
    ...over,
  });

  it("tops regions up to their targets at 0.2 Hz, never near players, within the persistent cap", () => {
    const d = new Director(LANES, m, mulberry32(1), cfg());
    const players = [{ x: 5000, z: 1000 }];
    expect(d.topUp(0, players).length).toBe(10);
    for (const r of d.records.values()) {
      const p = d.positionOf(r)!;
      expect(m.distSq(p.x, p.z, 5000, 1000)).toBeGreaterThan(MIN_SPAWN_DIST * MIN_SPAWN_DIST);
      expect(r.tier).toBe("rail");
    }
    expect(d.topUp(1000, players).length).toBe(0); // interval
    expect(d.topUp(DIRECTOR_INTERVAL_MS, players).length).toBe(0); // already full
    const capped = new Director(LANES, m, mulberry32(1), cfg({ maxPersistent: 7 }));
    capped.topUp(0, []);
    expect(capped.records.size).toBe(7);
  });

  it("spawns nothing when every lane is near a player", () => {
    const d = new Director([LANES[0]], m, mulberry32(2), cfg());
    expect(d.topUp(0, [{ x: 3000, z: 1000 }, { x: 7000, z: 1000 }]).length).toBe(0);
  });

  it("respawns a sunk NPC's slot only after its 2–5 minute timer", () => {
    const d = new Director(LANES, m, mulberry32(3), cfg());
    d.topUp(0, []);
    const key = [...d.records.keys()][0];
    d.sunk(key, 10_000);
    expect(d.records.size).toBe(9);
    expect(d.topUp(10_000 + DIRECTOR_INTERVAL_MS, []).length).toBe(0);
    expect(d.topUp(10_000 + 2 * 60_000 - 1, []).length).toBe(0);
    expect(d.topUp(10_000 + 5 * 60_000 + 1, []).length).toBe(1);
  });

  it("merchants dock at the end of a lane, then depart on another lane; patrols turn straight away", () => {
    const d = new Director(LANES, m, mulberry32(4), cfg());
    d.topUp(0, []);
    const merchant = [...d.records.values()].find((r) => r.archetype === "merchant")!;
    merchant.rail!.s = merchant.rail!.dir === 1 ? merchant.rail!.poly.total - 1 : 1;
    const pirate = [...d.records.values()].find((r) => r.archetype === "pirate")!;
    pirate.rail!.s = pirate.rail!.dir === 1 ? pirate.rail!.poly.total - 1 : 1;
    d.stepRails(0);
    d.stepRails(500);
    expect(merchant.tier).toBe("docked");
    expect(merchant.port).not.toBeNull();
    expect(pirate.tier).toBe("rail");
    d.stepRails(merchant.departAtMs + 1);
    expect(merchant.tier).toBe("rail");
    expect(merchant.port).toBeNull();
  });

  it("LOD promotes the closest rail records first, capped at maxActive", () => {
    const d = new Director(LANES, m, mulberry32(5), cfg({ maxActive: 3 }));
    d.topUp(0, []);
    const res = d.lod(() => 0, () => null);
    expect(res.promote.length).toBe(3);
    const far = d.lod(() => Infinity, () => null);
    expect(far.promote.length).toBe(0);
  });
});

const Z_EQ = 100_000;

describe("NpcSystem LOD in a World", () => {
  it("promotes a rail NPC into the world when a player approaches and demotes it after", () => {
    const world = new World({ rng: mulberry32(9) });
    const sys = new NpcSystem(world, {
      // Equatorial lane in the real (wrapping-Earth) coordinates; default all-water field.
      lanes: [{ from: "a", to: "b", points: [[1000, Z_EQ], [5000, Z_EQ], [9000, Z_EQ]] }],
      director: { targets: [{ region: "all", archetype: "merchant", count: 1 }] },
      seed: 11,
    }).attach();
    world.step(); // director spawns the record (no players → anywhere)
    expect(sys.director.records.size).toBe(1);
    const rec = [...sys.director.records.values()][0];
    expect(rec.tier).toBe("rail");
    const npcCount = () => [...world.players.values()].filter((p) => p.controller === "npc").length;
    expect(npcCount()).toBe(0);
    // A player sails right up to it.
    const pos = sys.director.positionOf(rec)!;
    world.createPlayer({ id: "p1", name: "P1", shipType: "sloop", x: pos.x, z: pos.z + 1500 });
    for (let i = 0; i < 20; i++) world.step();
    expect(rec.tier).toBe("active");
    expect(npcCount()).toBe(1);
    const npc = world.byEid.get(rec.eid!)!;
    expect(npc.controller).toBe("npc");
    expect(npc.title).toMatch(/Merchant/);
    // Player leaves (teleport far away): NPC demotes back to its lane.
    const p1 = world.getPlayer("p1")!;
    p1.x = npc.x + 5000;
    p1.z = npc.z + 5000;
    for (let i = 0; i < 20; i++) world.step();
    expect(rec.tier === "rail" || rec.tier === "docked").toBe(true);
    expect(npcCount()).toBe(0);
  });
});
