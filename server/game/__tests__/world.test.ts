// Redis-free tests for the authoritative world core (server/game/world.ts) and the fixed-step loop.
import { describe, it, expect } from "vitest";
import { World, SpatialGrid, GRACE_PERIOD, DEFAULT_SPAWN_CENTER, SPAWN_MIN_WATER, type WorldPlayer } from "../world";
import { FixedStepLoop } from "../loop";
import { FLAG_DISCONNECTED, FLAG_SUNK, GOLD_SNAPSHOT_EVERY, MAX_INPUT_QUEUE, type ServerMessage, type SnapshotMessage } from "@shared/protocol";
import { FIRE_ALL, FIRE_PORT, FIRE_STARBOARD, TICK_DT } from "@shared/physics";
import { WORLD_C, WORLD_H, WORLD_VERSION, metricDistSq, zOfLat } from "@shared/world/geo";
import { buildSyntheticLand, type LandQuery } from "@shared/world/land";
import { STARTER_PORTS } from "@shared/world/ports";

// The tests below were written for the old 10000² torus. Local coordinates (0..10000) are placed
// near the equator (metricX ≈ 1) by X()/Z(); seam and latitude tests use raw coordinates.
const EQ = WORLD_H / 2;
const X = (x: number) => x + 195_000;
const Z = (z: number) => z + EQ - 5000;

const input = (s: number, th: -1 | 0 | 1 = 0, ru: -1 | 0 | 1 = 0, f: number = 0) => ({ t: "input" as const, s, th, ru, f });

function mkWorld(land?: LandQuery) {
  let wall = 1_000_000;
  return new World({ rng: () => 0.5, wallClock: () => (wall += 1), land });
}

/** Add a player at LOCAL coordinates (see X/Z). */
function add(w: World, id: string, x: number, z: number, extra: Partial<WorldPlayer> = {}): WorldPlayer {
  return addRaw(w, id, X(x), Z(z), extra);
}

/** Add a player at raw world coordinates. */
function addRaw(w: World, id: string, x: number, z: number, extra: Partial<WorldPlayer> = {}): WorldPlayer {
  const p = w.createPlayer({ id, name: id, shipType: "sloop", x, z });
  Object.assign(p, extra);
  w.attachClient(id);
  return p;
}

function snap(msgs: ServerMessage[]): SnapshotMessage {
  const s = msgs.find((m) => "t" in m && m.t === "s") as SnapshotMessage | undefined;
  if (!s) throw new Error("no snapshot");
  return s;
}
const ofType = (msgs: ServerMessage[], t: string) => msgs.filter((m) => "t" in m && m.t === t) as any[];

describe("input queue", () => {
  it("consumes one input per tick, acks lastSeq, ignores out-of-order and duplicate seqs", () => {
    const w = mkWorld();
    const p = add(w, "a", 5000, 5000);
    expect(w.queueInput("a", input(5, 1))).toBe(true);
    expect(w.queueInput("a", input(3, 1))).toBe(false); // out of order
    expect(w.queueInput("a", input(5, 1))).toBe(false); // duplicate
    expect(w.queueInput("a", input(6, 1))).toBe(true);
    w.step();
    expect(p.lastSeq).toBe(5);
    expect(snap(w.buildMessages("a")).a).toBe(5);
    w.step();
    expect(p.lastSeq).toBe(6);
    expect(p.speed).toBeLessThan(0); // W = forward = negative velocity
  });

  it("acks -1 before any input and caps the queue (drops oldest)", () => {
    const w = mkWorld();
    const p = add(w, "a", 5000, 5000);
    w.step();
    expect(snap(w.buildMessages("a")).a).toBe(-1);
    for (let s = 1; s <= MAX_INPUT_QUEUE + 5; s++) w.queueInput("a", input(s));
    expect(p.inputQueue.length).toBe(MAX_INPUT_QUEUE);
    expect(p.inputQueue[0].s).toBe(6);
  });

  it("catches up: consumes 2 inputs per tick while more than 3 are queued", () => {
    const w = mkWorld();
    const p = add(w, "a", 5000, 5000);
    for (let s = 1; s <= 6; s++) w.queueInput("a", input(s, 1));
    w.step(); // 6 queued → 2
    expect(p.lastSeq).toBe(2);
    w.step(); // 4 queued → 2
    expect(p.lastSeq).toBe(4);
    w.step(); // 2 queued → 1
    expect(p.lastSeq).toBe(5);
  });

  it("starved queue repeats the last input without firing", () => {
    const w = mkWorld();
    const p = add(w, "a", 5000, 5000);
    w.queueInput("a", input(1, 1, 0, FIRE_STARBOARD));
    w.step();
    const v1 = p.speed;
    w.step(); // no input: keeps th=1
    expect(p.speed).toBeLessThan(v1);
    expect(p.lastInput.f).toBe(FIRE_STARBOARD);
    expect(w.balls.length).toBe(1); // only the first tick fired
  });

  it("attachClient resets seq tracking so a reconnecting client may restart its seq", () => {
    const w = mkWorld();
    const p = add(w, "a", 5000, 5000);
    w.queueInput("a", input(100, 1));
    w.step();
    w.attachClient("a");
    expect(w.queueInput("a", input(0, 1))).toBe(true);
    w.step();
    expect(p.lastSeq).toBe(0);
  });
});

describe("disconnect", () => {
  it("forces neutral input: the ship coasts to exactly 0 and is flagged DISCONNECTED", () => {
    const w = mkWorld();
    const a = add(w, "a", 5000, 5000);
    add(w, "b", 5300, 5000);
    for (let s = 1; s <= 40; s++) {
      w.queueInput("a", input(s, 1));
      w.step();
    }
    expect(a.speed).toBeLessThan(-3);
    w.setConnected("a", false);
    expect(w.queueInput("a", input(41, 1))).toBe(false);
    let ticks = 0;
    while (a.speed !== 0 && ticks < 400) {
      w.step();
      ticks++;
    }
    expect(a.speed).toBe(0);
    w.buildMessages("b");
    w.step();
    const row = snap(w.buildMessages("b")).e.find((r) => r[0] === a.eid)!;
    expect(row[6] & FLAG_DISCONNECTED).toBe(FLAG_DISCONNECTED);
    expect(row[4]).toBe(0);
  });

  it("removes the player after the grace period and emits a persist effect", () => {
    const w = mkWorld();
    add(w, "a", 5000, 5000);
    w.setConnected("a", false);
    const ticks = GRACE_PERIOD / (TICK_DT * 1000) + 2;
    for (let i = 0; i < ticks; i++) w.step();
    expect(w.getPlayer("a")).toBeUndefined();
    const eff = w.drainEffects();
    expect(eff.some((e) => e.type === "playerRemoved" && e.reason === "disconnected" && e.player.id === "a")).toBe(true);
  });
});

describe("interest", () => {
  it("sends ent on enter, rows while visible, gone on leave; never other players' gold/cargo", () => {
    const w = mkWorld();
    const a = add(w, "a", 1000, 1000);
    const b = add(w, "b", 1500, 1000, { gold: 12345, cargoUsed: 7 });
    w.step();
    let m = w.buildMessages("a");
    const ent = ofType(m, "ent");
    expect(ent).toEqual([{ t: "ent", eid: b.eid, id: "b", name: "b", shipType: "sloop", maxHp: 50 }]);
    const s = snap(m);
    expect(s.e.length).toBe(1);
    expect(s.e[0].length).toBe(7);
    expect(s.me.eid).toBe(a.eid);
    expect(s.me.gold).toBe(a.gold);
    const json = JSON.stringify(m);
    expect(json).not.toContain("12345");
    expect(json).not.toContain("cargo\":7");

    // No repeat ent while still visible.
    w.step();
    expect(ofType(w.buildMessages("a"), "ent")).toEqual([]);

    // Move b out of range → gone.
    b.x = X(4000);
    w.step();
    m = w.buildMessages("a");
    expect(ofType(m, "gone")).toEqual([{ t: "gone", eid: b.eid }]);
    expect(snap(m).e).toEqual([]);

    // Back in range → ent again.
    b.x = X(1200);
    w.step();
    expect(ofType(w.buildMessages("a"), "ent").length).toBe(1);
  });

  it("re-sends ent when metadata changes (upgrade)", () => {
    const w = mkWorld();
    add(w, "a", 1000, 1000);
    const b = add(w, "b", 1100, 1000);
    w.step();
    w.buildMessages("a");
    w.setShipType("b", "brigantine");
    w.step();
    const ent = ofType(w.buildMessages("a"), "ent");
    expect(ent).toEqual([{ t: "ent", eid: b.eid, id: "b", name: "b", shipType: "brigantine", maxHp: 150 }]);
  });

  it("sees across the wrap seam", () => {
    const w = mkWorld();
    addRaw(w, "a", WORLD_C - 50, EQ - 50);
    const b = addRaw(w, "b", 50, EQ + 50);
    w.step();
    const s = snap(w.buildMessages("a"));
    expect(s.e.map((r) => r[0])).toEqual([b.eid]);
  });

  it("includes gold rows only every GOLD_SNAPSHOT_EVERY ticks and only nearby gold", () => {
    const w = mkWorld();
    add(w, "a", 2000, 2000);
    w.dropGold(X(2300), Z(2000), 77);
    w.dropGold(X(8000), Z(8000), 99);
    let withGold = 0;
    for (let i = 0; i < GOLD_SNAPSHOT_EVERY * 2; i++) {
      w.step();
      const s = snap(w.buildMessages("a"));
      if (s.g) {
        withGold++;
        expect(s.g.map((g) => g[3])).toEqual([77]);
      }
    }
    expect(withGold).toBe(2);
  });
});

describe("combat", () => {
  it("fire → hit → sunk → gold drop → pickup", () => {
    const w = mkWorld();
    // rotationY 0 → broadside direction +x.
    const shooter = add(w, "s", 5000, 5000);
    const target = add(w, "t", 5200, 5000, { hp: 3, gold: 300 });
    const far = add(w, "far", 9000, 9000);
    w.queueInput("s", input(1, 0, 0, FIRE_STARBOARD));
    w.step();
    const sm = w.buildMessages("s");
    const fire = ofType(sm, "fire");
    expect(fire.length).toBe(1);
    expect(fire[0].eid).toBe(shooter.eid);
    expect(fire[0].balls.length).toBe(1);
    expect(fire[0].spd).toBe(15);
    expect(fire[0].life).toBe(3000);
    expect(ofType(w.buildMessages("t"), "fire").length).toBe(1); // target sees it
    expect(ofType(w.buildMessages("far"), "fire").length).toBe(0); // out of interest
    expect(fire[0].side).toBe("starboard");
    // Broadsides: only the starboard battery fired; the port one is still loaded.
    expect(snap(sm).me.canFire).toBe(true);
    expect(snap(sm).me.reloadMs).toBe(0);
    expect(snap(sm).me.reloadStarboardMs).toBeGreaterThan(0);
    expect(snap(sm).me.reloadPortMs).toBe(0);

    let hitFor: { s: ServerMessage[]; t: ServerMessage[] } | null = null;
    for (let i = 0; i < 20 && !hitFor; i++) {
      w.step();
      const s = w.buildMessages("s");
      const t = w.buildMessages("t");
      w.buildMessages("far");
      if (ofType(t, "hit").length) hitFor = { s, t };
    }
    expect(hitFor).not.toBeNull();
    expect(ofType(hitFor!.t, "hit")[0]).toMatchObject({ t: "hit", target: "me", hp: 0 });
    expect(ofType(hitFor!.s, "hit")[0]).toMatchObject({ t: "hit", target: target.eid, hp: 0 });
    expect(ofType(hitFor!.t, "sunk")).toEqual([{ t: "sunk", eid: "me" }]);
    expect(ofType(hitFor!.s, "sunk")).toEqual([{ t: "sunk", eid: target.eid }]);
    expect(target.sunk).toBe(true);
    expect(w.balls.length).toBe(0);
    const tRow = snap(hitFor!.s).e.find((r) => r[0] === target.eid)!;
    expect(tRow[6] & FLAG_SUNK).toBe(FLAG_SUNK);

    const eff = w.drainEffects();
    expect(eff).toContainEqual(expect.objectContaining({ type: "playerSunk", playerId: "t", gold: 300 }));
    expect(w.gold.length).toBe(1);
    expect(w.gold[0].gold).toBe(300);

    // Shooter sails onto the gold.
    shooter.x = w.gold[0].x + 10;
    shooter.z = w.gold[0].z;
    const before = shooter.gold;
    w.step();
    const gc = ofType(w.buildMessages("s"), "goldCollected");
    expect(gc).toEqual([{ t: "goldCollected", gold: 300, newTotalGold: before + 300 }]);
    expect(ofType(w.buildMessages("t"), "goldCollected")).toEqual([]);
    expect(w.gold.length).toBe(0);
    expect(w.drainEffects()).toContainEqual(expect.objectContaining({ type: "goldCollected", playerId: "s", gold: 300 }));
  });

  it("applies armor like the old server and respects reload", () => {
    const w = mkWorld();
    add(w, "s", 5000, 5000);
    const target = add(w, "t", 5100, 5000);
    target.hp = 50;
    for (let s = 1; s <= 30; s++) {
      w.queueInput("s", input(s, 0, 0, 1));
      w.step();
    }
    // Reload 2 s = 40 ticks → exactly one broadside in 30 ticks; damage round(5 * 0.95) = 5.
    expect(target.hp).toBe(45);
  });

  it("hits across the wrap seam", () => {
    const w = mkWorld();
    addRaw(w, "s", WORLD_C - 50, EQ);
    const target = addRaw(w, "t", 60, EQ);
    w.queueInput("s", input(1, 0, 0, 1));
    for (let i = 0; i < 10; i++) w.step();
    expect(target.hp).toBeLessThan(50);
  });

  it("does not hit the shooter itself", () => {
    const w = mkWorld();
    const s = add(w, "s", 5000, 5000);
    w.queueInput("s", input(1, 0, 0, 1));
    for (let i = 0; i < 80; i++) w.step();
    expect(s.hp).toBe(50);
    expect(w.balls.length).toBe(0); // expired after 3 s
  });
});

describe("broadsides (port + starboard, independent reloads)", () => {
  /** Queue one input with fire flags `f` and step; returns this tick's fire messages for "s". */
  function fireTick(w: World, seq: number, f: number): any[] {
    w.queueInput("s", input(seq, 0, 0, f));
    w.step();
    return ofType(w.buildMessages("s"), "fire");
  }
  const ticksFor = (ms: number) => Math.ceil(ms / 50);

  it("legacy f:1 (FIRE_ALL) fires both loaded batteries, port to the LEFT and starboard to the RIGHT", () => {
    const w = mkWorld();
    const s = add(w, "s", 5000, 5000); // rotationY 0: bow −z (north), right = +x, left = −x
    const fires = fireTick(w, 1, FIRE_ALL);
    expect(fires.map((f) => f.side).sort()).toEqual(["port", "starboard"]);
    const port = fires.find((f) => f.side === "port")!;
    const stbd = fires.find((f) => f.side === "starboard")!;
    expect(port.balls[0][3]).toBeCloseTo(-1, 4); // dx
    expect(port.balls[0][1]).toBeLessThan(s.x);
    expect(stbd.balls[0][3]).toBeCloseTo(1, 4);
    expect(stbd.balls[0][1]).toBeGreaterThan(s.x);
    expect(w.balls.length).toBe(2);
    const me = snap(w.buildMessages("s")).me;
    expect(me.canFire).toBe(false);
    expect(me.reloadPortMs).toBeGreaterThan(0);
    expect(me.reloadStarboardMs).toBeGreaterThan(0);
  });

  it("Q (port) then Space (fire all) fires the other side; each side reloads on its own", () => {
    const w = mkWorld();
    const s = add(w, "s", 5000, 5000);
    let seq = 1;
    expect(fireTick(w, seq++, FIRE_PORT).map((f) => f.side)).toEqual(["port"]);
    expect(s.canFire).toBe(true); // starboard still loaded
    // Next tick, fire-all: only starboard is loaded.
    expect(fireTick(w, seq++, FIRE_ALL).map((f) => f.side)).toEqual(["starboard"]);
    expect(s.canFire).toBe(false);
    // Fire-all again right away: nothing loaded.
    expect(fireTick(w, seq++, FIRE_ALL)).toEqual([]);
    // Hold fire-all: port comes back first (fired one tick earlier), then starboard, then nothing.
    const order: string[] = [];
    for (let i = 0; i < ticksFor(s.reloadTime) + 2; i++) for (const f of fireTick(w, seq++, FIRE_ALL)) order.push(f.side);
    expect(order).toEqual(["port", "starboard"]);
  });

  it("holding one side's key fires only that side, once per reload", () => {
    const w = mkWorld();
    const s = add(w, "s", 5000, 5000);
    let seq = 1;
    const sides: string[] = [];
    const n = ticksFor(s.reloadTime) * 3; // ~3 reloads
    for (let i = 0; i < n; i++) for (const f of fireTick(w, seq++, FIRE_STARBOARD)) sides.push(f.side);
    expect(sides).toEqual(["starboard", "starboard", "starboard"]);
    expect(s.canFire).toBe(true); // port never fired
  });

  it("flags from a catch-up pair of inputs are OR-ed", () => {
    const w = mkWorld();
    add(w, "s", 5000, 5000);
    // Five queued inputs → the tick consumes 2 (catch-up): PORT then STARBOARD → both fire.
    w.queueInput("s", input(1, 0, 0, FIRE_PORT));
    w.queueInput("s", input(2, 0, 0, FIRE_STARBOARD));
    for (let i = 3; i <= 5; i++) w.queueInput("s", input(i));
    w.step();
    expect(ofType(w.buildMessages("s"), "fire").map((f) => f.side).sort()).toEqual(["port", "starboard"]);
  });
});

describe("tick", () => {
  it("never returns a Promise", () => {
    const w = mkWorld();
    add(w, "a", 1, 1);
    const r: unknown = w.step();
    expect(r).toBeUndefined();
    expect(w.step.constructor.name).toBe("Function");
  });

  it("buildFrames serializes exactly what buildMessages returns", () => {
    const setup = () => {
      const w = new World({ rng: () => 0.25, wallClock: () => 42 });
      add(w, "a", 5000, 5000);
      add(w, "b", 5150, 5000, { gold: 999 });
      add(w, "c", 5000, 5600);
      w.dropGold(X(5050), Z(5000), 5);
      return w;
    };
    const w1 = setup();
    const w2 = setup();
    for (let k = 1; k <= 25; k++) {
      for (const w of [w1, w2]) {
        w.queueInput("a", input(k, 1, 1, 1));
        w.queueInput("b", input(k, -1, 0, 1));
        w.step();
      }
      for (const id of ["a", "b", "c"]) {
        expect(w2.buildFrames(id).map((f) => JSON.parse(f))).toEqual(w1.buildMessages(id));
      }
    }
  });

  it("sparse spatial grid: wraps x across the seam, no duplicates, only non-empty cells stored", () => {
    const g = new SpatialGrid<{ x: number; z: number }>(500);
    const items = [{ x: 10, z: EQ + 10 }, { x: WORLD_C - 10, z: EQ - 10 }, { x: 5000, z: EQ }];
    items.forEach((i) => g.insert(i));
    expect(g.cellCount).toBe(3);
    const out = g.query(0, EQ, 100, []);
    expect(out).toContain(items[0]);
    expect(out).toContain(items[1]);
    expect(out).not.toContain(items[2]);
    const all = g.query(0, EQ, 300000, []);
    expect(all.length).toBe(3);
    g.clear();
    expect(g.cellCount).toBe(0);
    expect(g.query(0, EQ, 300000, []).length).toBe(0);
  });

  it("sparse spatial grid widens the x span at high latitude (metric radius)", () => {
    const g = new SpatialGrid<{ x: number; z: number }>(500);
    const z65 = zOfLat(65); // metricX ≈ 0.423
    // 2300 coordinate units east = ~972 metric: inside a metric radius of 1000
    const near = { x: 100_000 + 2300, z: z65 };
    const far = { x: 100_000 + 2600, z: z65 }; // ~1099 metric
    g.insert(near);
    g.insert(far);
    const out = g.query(100_000, z65, 1000, []);
    expect(out).toContain(near);
    expect(metricDistSq(100_000, z65, near.x, near.z)).toBeLessThan(1000 * 1000);
    // ... and across the seam at high latitude
    const seam = { x: 900, z: zOfLat(-68) };
    g.insert(seam);
    expect(g.query(WORLD_C - 1000, zOfLat(-68), 1000, [])).toContain(seam);
  });

  it("FixedStepLoop runs whole steps from the accumulator and caps catch-up at 5", () => {
    let t = 0;
    let steps = 0;
    const loop = new FixedStepLoop(() => steps++, { stepMs: 50, now: () => t });
    loop.start();
    loop.stop();
    t = 120;
    expect(loop.runDue()).toBe(2);
    t = 150;
    expect(loop.runDue()).toBe(1); // 20 + 30 leftover = 50
    t = 1150;
    expect(loop.runDue()).toBe(5); // 1000 ms behind → capped, backlog dropped
    expect(loop.dropped).toBe(1);
    expect(steps).toBe(8);
  });

  // Measures one full server tick for 300 connected ships: world.step() + buildFrames() (view diff,
  // events, snapshot JSON) for every client + effect drain. Inputs: everyone sails ahead, turns,
  // and fires often. Two layouts:
  //  - spread over the whole 10000² map (what the live game looks like) → asserted < 10 ms;
  //  - all 300 packed into 4000² (each client sees ~190 ships; ~5.5 KB/client/tick) → printed,
  //    asserted only loosely, as a worst case.
  // A land field is active: islands scattered over the area, so ships hit coasts and balls splash.
  const CENTER = { x: 200_000, z: zOfLat(20) };
  const islands = buildSyntheticLand(
    Array.from({ length: 12 }, (_, i) => ({
      kind: "circle" as const,
      x: CENTER.x - 4000 + (i % 4) * 2600,
      z: CENTER.z - 3000 + Math.floor(i / 4) * 3000,
      r: 300 + (i % 3) * 150,
    })),
  ).field;
  function budget(spread: number) {
    const w = new World({ rng: Math.random, land: islands });
    let seq = 0;
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const id = `p${i}`;
      ids.push(id);
      const at = w.spawnPoint(CENTER, spread / 2);
      w.createPlayer({ id, name: id, shipType: i % 2 ? "galleon" : "sloop", x: at.x, z: at.z });
      w.attachClient(id);
    }
    const run = (n: number) => {
      let total = 0;
      let bytes = 0;
      for (let k = 0; k < n; k++) {
        seq++;
        for (let i = 0; i < ids.length; i++) {
          w.queueInput(ids[i], input(seq, 1, ((i + k) % 3) - 1 as -1 | 0 | 1, (i + k) % 7 === 0 ? 1 : 0));
        }
        const t0 = performance.now();
        w.step();
        for (const id of ids) {
          for (const f of w.buildFrames(id)) bytes += f.length;
        }
        w.drainEffects();
        total += performance.now() - t0;
      }
      return { avg: total / n, bytesPerClientTick: bytes / n / ids.length };
    };
    run(20); // warm-up
    const { avg, bytesPerClientTick } = run(100);
    // eslint-disable-next-line no-console
    console.log(
      `[budget] 300 ships in ${spread}x${spread} (land on): avg ${avg.toFixed(2)} ms/tick (step + frames for all clients), ` +
        `~${Math.round(bytesPerClientTick)} B/client/tick, ${w.balls.length} balls live`,
    );
    return avg;
  }

  // Regression gates, not capacity claims. GitHub's shared runners measured ~5x slower than a dev
  // desktop (2026-10-16: spread 22.6 ms, packed 66.7 ms in CI vs ~4 ms / ~10 ms locally), so CI
  // thresholds are scaled. The packed case is O(n^2) (every ship sees every other); real load
  // (200 bots + 300 NPCs) is gated by the NPC budget test. Clustered capacity: docs/world/BUILD_STATE.md.
  const PERF_SCALE = process.env.CI ? 3 : 1;

  it("300 ships spread over the map: full tick < 25 ms (x3 in CI)", () => {
    expect(budget(10000)).toBeLessThan(25 * PERF_SCALE);
  });

  it("300 ships packed in 4000x4000 (worst case): full tick printed, < 50 ms (x3 in CI)", () => {
    expect(budget(4000)).toBeLessThan(50 * PERF_SCALE);
  });
});

// ---------------------------------------------------------------------------------------------
// Wrapping Earth: land, splash, spawn, restore, latitude (WORLD_SPEC §3, §4.3)
// ---------------------------------------------------------------------------------------------

describe("world on the wrapping Earth", () => {
  const ISLAND = { x: 150_000, z: EQ, r: 1500 };
  const island = () => buildSyntheticLand([{ kind: "circle", ...ISLAND }]).field;

  it("a ball that hits land is removed with a splash event (no hit)", () => {
    const land = island();
    const w = mkWorld(land);
    // rotationY 0 → broadside +x, straight at the island 300 units away.
    const s = addRaw(w, "s", ISLAND.x - ISLAND.r - 300, EQ);
    const far = addRaw(w, "far", ISLAND.x - ISLAND.r - 300, EQ + 5000);
    w.queueInput("s", input(1, 0, 0, FIRE_STARBOARD));
    w.step();
    const ballId = ofType(w.buildMessages("s"), "fire")[0].balls[0][0];
    w.buildMessages("far");
    let splash: any = null;
    for (let i = 0; i < 20 && !splash; i++) {
      w.step();
      splash = ofType(w.buildMessages("s"), "splash")[0] ?? null;
      expect(ofType(w.buildMessages("far"), "splash")).toEqual([]); // out of interest
    }
    expect(splash).toMatchObject({ t: "splash", land: 1, ball: ballId });
    expect(land.distance(splash.x, splash.z)).toBeLessThan(5);
    expect(Math.abs(splash.x - (ISLAND.x - ISLAND.r))).toBeLessThan(60);
    expect(w.balls.length).toBe(0);
    expect(s.hp).toBe(50);
    expect(far.hp).toBe(50);
  });

  it("balls splash on the polar ice too", () => {
    const w = mkWorld();
    addRaw(w, "s", 5000, 22_500, { rotationY: Math.PI / 2 }); // starboard = rotationY + π/2 → −z (north)
    w.queueInput("s", input(1, 0, 0, FIRE_STARBOARD));
    let splashes = 0;
    for (let i = 0; i < 20; i++) {
      w.step();
      splashes += ofType(w.buildMessages("s"), "splash").length;
    }
    expect(splashes).toBe(1);
  });

  it("ships sail into land without damage and without penetrating (world passes land to stepShip)", () => {
    const land = island();
    const w = mkWorld(land);
    const p = addRaw(w, "a", ISLAND.x - ISLAND.r - 400, EQ, { rotationY: -Math.PI / 2 }); // heading east
    for (let s = 1; s <= 200; s++) {
      w.queueInput("a", input(s, 1, s % 40 < 20 ? 1 : 0));
      w.step();
      expect(land.distance(p.x, p.z)).toBeGreaterThan(p.physics.hullRadius - 2);
    }
    expect(p.hp).toBe(50);
  });

  it("spawnPoint only returns water with distance > SPAWN_MIN_WATER; default spawn is the Caribbean", () => {
    // Land right on the spawn centre: most jittered candidates are rejected.
    const land = buildSyntheticLand([{ kind: "circle", x: DEFAULT_SPAWN_CENTER.x, z: DEFAULT_SPAWN_CENTER.z, r: 4000 }]).field;
    const w = new World({ land, rng: Math.random });
    for (let i = 0; i < 100; i++) {
      const sp = w.spawnPoint();
      expect(land.distance(sp.x, sp.z)).toBeGreaterThan(SPAWN_MIN_WATER);
      expect(metricDistSq(sp.x, sp.z, DEFAULT_SPAWN_CENTER.x, DEFAULT_SPAWN_CENTER.z)).toBeLessThan(2 * 5000 * 5000 + 1);
    }
  });

  it("createPlayer without x/z spawns at a starter port (card W4)", () => {
    const w = new World({ rng: Math.random });
    for (let i = 0; i < 20; i++) {
      const p = w.createPlayer({ id: `n${i}`, name: "n", shipType: "sloop" });
      expect(STARTER_PORTS.some((sp) => metricDistSq(p.x, p.z, sp.spawn.x, sp.spawn.z) < 300 * 300)).toBe(true);
      expect(p.worldVersion).toBe(WORLD_VERSION);
    }
  });

  it("restorePlayer relocates old-torus records and positions on land; keeps valid ones", () => {
    const land = island();
    const w = mkWorld(land);
    const old = w.restorePlayer({ id: "old", name: "old", shipType: "sloop", x: 1234, z: 5678 }); // no worldVersion
    expect(STARTER_PORTS.some((sp) => metricDistSq(old.x, old.z, sp.spawn.x, sp.spawn.z) < 300 * 300)).toBe(true);
    expect(old.worldVersion).toBe(WORLD_VERSION);
    const ok = w.restorePlayer({ id: "ok", name: "ok", shipType: "sloop", x: 123_456, z: EQ + 10, worldVersion: WORLD_VERSION });
    expect([ok.x, ok.z]).toEqual([123_456, EQ + 10]);
    const onLand = w.restorePlayer({ id: "l", name: "l", shipType: "sloop", x: ISLAND.x, z: ISLAND.z, worldVersion: WORLD_VERSION });
    expect(land.distance(onLand.x, onLand.z)).toBeGreaterThan(SPAWN_MIN_WATER);
  });

  it("interest uses metric distance: wider in x coordinates at high latitude", () => {
    const w = mkWorld();
    const z65 = zOfLat(65); // metricX ≈ 0.4226; interest radius 2000 metric ≈ 4732 coordinate x
    addRaw(w, "a", 100_000, z65);
    const near = addRaw(w, "b", 104_500, z65); // ≈ 1902 metric
    addRaw(w, "c", 105_000, z65); // ≈ 2113 metric
    w.step();
    expect(snap(w.buildMessages("a")).e.map((r) => r[0])).toEqual([near.eid]);
  });

  it("gold pickup radius is metric", () => {
    const w = mkWorld();
    const z60 = zOfLat(60);
    const p = addRaw(w, "a", 100_000, z60);
    w.dropGold(100_000 + 90, z60, 10); // 90 coordinate units = 45 metric < 50
    w.step();
    expect(ofType(w.buildMessages("a"), "goldCollected")).toEqual([{ t: "goldCollected", gold: 10, newTotalGold: p.gold }]);
  });
});
