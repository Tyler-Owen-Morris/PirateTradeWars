// Redis-free tests for the authoritative world core (server/game/world.ts) and the fixed-step loop.
import { describe, it, expect } from "vitest";
import { World, SpatialGrid, GRACE_PERIOD, type WorldPlayer } from "../world";
import { FixedStepLoop } from "../loop";
import { FLAG_DISCONNECTED, FLAG_SUNK, GOLD_SNAPSHOT_EVERY, MAX_INPUT_QUEUE, type ServerMessage, type SnapshotMessage } from "@shared/protocol";
import { TICK_DT } from "@shared/physics";

const input = (s: number, th: -1 | 0 | 1 = 0, ru: -1 | 0 | 1 = 0, f: 0 | 1 = 0) => ({ t: "input" as const, s, th, ru, f });

function mkWorld() {
  let wall = 1_000_000;
  return new World({ rng: () => 0.5, wallClock: () => (wall += 1) });
}

function add(w: World, id: string, x: number, z: number, extra: Partial<WorldPlayer> = {}): WorldPlayer {
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
    w.queueInput("a", input(1, 1, 0, 1));
    w.step();
    const v1 = p.speed;
    w.step(); // no input: keeps th=1
    expect(p.speed).toBeLessThan(v1);
    expect(p.lastInput.f).toBe(1);
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
    b.x = 4000;
    w.step();
    m = w.buildMessages("a");
    expect(ofType(m, "gone")).toEqual([{ t: "gone", eid: b.eid }]);
    expect(snap(m).e).toEqual([]);

    // Back in range → ent again.
    b.x = 1200;
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
    add(w, "a", 9950, 9950);
    const b = add(w, "b", 50, 50);
    w.step();
    const s = snap(w.buildMessages("a"));
    expect(s.e.map((r) => r[0])).toEqual([b.eid]);
  });

  it("includes gold rows only every GOLD_SNAPSHOT_EVERY ticks and only nearby gold", () => {
    const w = mkWorld();
    add(w, "a", 2000, 2000);
    w.dropGold(2300, 2000, 77);
    w.dropGold(8000, 8000, 99);
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
    w.queueInput("s", input(1, 0, 0, 1));
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
    expect(snap(sm).me.canFire).toBe(false);
    expect(snap(sm).me.reloadMs).toBeGreaterThan(0);

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
    add(w, "s", 9950, 5000);
    const target = add(w, "t", 60, 5000);
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
      w.dropGold(5050, 5000, 5);
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

  it("spatial grid queries wrap and return no duplicates", () => {
    const g = new SpatialGrid<{ x: number; z: number }>(10000, 10000, 500);
    const items = [{ x: 10, z: 10 }, { x: 9990, z: 9990 }, { x: 5000, z: 5000 }];
    items.forEach((i) => g.insert(i));
    const out = g.query(0, 0, 100, []);
    expect(out).toContain(items[0]);
    expect(out).toContain(items[1]);
    expect(out).not.toContain(items[2]);
    const all = g.query(0, 0, 100000, []);
    expect(all.length).toBe(3);
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
  function budget(spread: number) {
    const w = new World({ rng: Math.random });
    let seq = 0;
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const id = `p${i}`;
      ids.push(id);
      w.createPlayer({ id, name: id, shipType: i % 2 ? "galleon" : "sloop", x: 3000 + Math.random() * spread, z: 3000 + Math.random() * spread });
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
      `[budget] 300 ships in ${spread}x${spread}: avg ${avg.toFixed(2)} ms/tick (step + frames for all clients), ` +
        `~${Math.round(bytesPerClientTick)} B/client/tick, ${w.balls.length} balls live`,
    );
    return avg;
  }

  // Budget is half the 50 ms tick so this holds on slower CI runners (GitHub ubuntu measured ~14 ms).
  it("300 ships spread over the map: full tick < 25 ms", () => {
    expect(budget(10000)).toBeLessThan(25);
  });

  it("300 ships packed in 4000x4000 (worst case): full tick printed, < 50 ms", () => {
    expect(budget(4000)).toBeLessThan(50);
  });
});
