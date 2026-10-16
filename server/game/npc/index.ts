/**
 * NpcSystem: ties the NPC modules to the World. See server/game/npc/README.md.
 *
 * It installs itself as `world.npcHook`, so it runs inside `World.step()` right before the
 * movement pass, synchronously (no await, no I/O, seeded RNG → deterministic for a given world).
 * Each tick it:
 *   1. reads the previous tick's events (hits → threat, provocation, rep, call for help; sinks →
 *      loot drop under the fair-play cap, respawn scheduling)
 *   2. runs the director (0.2 Hz top-up), rail/docked tiers (2 Hz) and LOD promotion/demotion (2 Hz)
 *   3. for every active NPC: a 4 Hz staggered decision (perceive → threat → brain), then per-tick
 *      steering/tactics → `world.setNpcInput(p, {th, ru, f})`
 *
 * Disabled by default: `gameState` only constructs it when NPCS_ENABLED=1|true (npcsEnabled()).
 * NPC2 turns it on and feeds it real lanes (shared/world/lanes.json), ports (safe zones) and land.
 */
import type { World, WorldEvent, WorldPlayer } from "../world";
import { ARCHETYPES, rollNpc, type Archetype, type ArchetypeId } from "./archetypes";
import { decide, isCombatState, isDecisionTick, newBrain, DECISION_DT_SEC, LOOT_RADIUS, type Brain, type Perception } from "./brain";
import { DEFAULT_DIRECTOR, Director, type DirectorConfig, type NpcRecord } from "./director";
import { DEFAULT_FAIRPLAY, FairPlay, classMatch, inSafeZone, type FairPlayConfig, type SafeZone } from "./fairplay";
import {
  applyRepChanges,
  areAllies,
  baseHostility,
  emitRepChanges,
  newStanding,
  notorietyFor,
  repChangesFor,
  type FactionId,
  type PlayerStanding,
} from "./factions";
import { pointAt, type Lane } from "./lod";
import { defaultMetric, type NpcMetric } from "./metric";
import {
  arrive,
  avoidLand,
  evade,
  pursue,
  seek,
  toInput,
  toSteer,
  wander,
  withAvoidance,
  type LandQuery,
  type SteerShip,
  type Vec,
  type WanderState,
} from "./steering";
import { engage, firepower } from "./tactics";
import { callForHelp, ThreatTable } from "./threat";
import { moveDir, mulberry32 } from "./util";

/** NPCS_ENABLED=1|true turns the NPC system on (default off, so main stays deployable). */
export function npcsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.NPCS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** A sunk NPC's wreck stays visible this long before it is removed from the world. */
export const NPC_SINK_REMOVE_MS = 10_000;
/** LOD pass cadence (ticks). 10 ticks = 2 Hz. */
export const LOD_EVERY_TICKS = 10;
/** Lane following: look this far ahead along the lane (units). */
export const LANE_LOOKAHEAD = 250;
/** Distance from the lane end that counts as arrived (units). */
export const LANE_ARRIVE = 150;
/** Patrol leash for NPCs without a lane (units). */
export const PATROL_LEASH = 1500;
/** Share of an NPC's loot dropped when another NPC sinks it. */
export const NPC_KILL_LOOT_SHARE = 0.5;

export interface NpcSystemOptions {
  lanes?: Lane[];
  /** Port safe zones (WORLD_SPEC §5 dock/safeRadius). */
  safeZones?: SafeZone[];
  land?: LandQuery;
  metric?: NpcMetric;
  seed?: number;
  director?: Partial<DirectorConfig>;
  fairplay?: Partial<FairPlayConfig>;
}

export interface SpawnActiveInit {
  archetype: ArchetypeId;
  x: number;
  z: number;
  rotationY?: number;
  faction?: FactionId;
  shipType?: string;
}

/** Runtime state of an active (in-world) NPC. */
export interface ActiveNpc {
  rec: NpcRecord;
  p: WorldPlayer;
  arch: Archetype;
  brain: Brain;
  threat: ThreatTable;
  wander: WanderState;
  rng: () => number;
  home: { x: number; z: number };
  /** Lane progress while following its lane in the world. */
  followS: number;
  /** Idling in port (active tier) until this sim ms. */
  idleUntilMs: number;
  sunkAtMs: number;
  /** Merchant already struck its colours (loot dropped). */
  struck: boolean;
}

export interface NpcStats {
  records: number;
  active: number;
  fires: number;
  hitsByNpc: number;
  sunkNpcs: number;
  lastTickMs: number;
  maxTickMs: number;
}

export class NpcSystem {
  readonly metric: NpcMetric;
  readonly land: LandQuery;
  readonly director: Director;
  readonly fairplay: FairPlay;
  readonly active = new Map<number, ActiveNpc>();
  /** In-memory player standing (NPC2 loads/persists it with the player in Redis). */
  readonly standings = new Map<string, PlayerStanding>();
  readonly stats: NpcStats = { records: 0, active: 0, fires: 0, hitsByNpc: 0, sunkNpcs: 0, lastTickMs: 0, maxTickMs: 0 };
  private readonly safeZones: SafeZone[];
  private readonly rng: () => number;
  private readonly provokedPairs = new Set<string>();
  private readonly players: WorldPlayer[] = [];
  private seedCounter = 1;
  private manualKey = -1;

  constructor(
    readonly world: World,
    opts: NpcSystemOptions = {},
  ) {
    this.metric = opts.metric ?? defaultMetric();
    this.land = opts.land ?? world.land;
    this.safeZones = opts.safeZones ?? [];
    this.rng = mulberry32(opts.seed ?? 0x5eed);
    this.director = new Director(opts.lanes ?? [], this.metric, this.rng, { ...DEFAULT_DIRECTOR, ...opts.director });
    this.fairplay = new FairPlay({ ...DEFAULT_FAIRPLAY, ...opts.fairplay });
  }

  /** Install as the world's AI hook. */
  attach(): this {
    this.world.npcHook = (_w, ev) => this.tick(ev);
    return this;
  }

  detach(): void {
    if (this.world.npcHook) this.world.npcHook = null;
  }

  standingOf(playerId: string): PlayerStanding {
    let s = this.standings.get(playerId);
    if (!s) this.standings.set(playerId, (s = newStanding()));
    return s;
  }

  /** Spawn an NPC straight into the world (tests, scripted events). Not managed by the director's
   *  region targets; it never demotes (no lane) and is not respawned. */
  spawnActive(init: SpawnActiveInit): ActiveNpc {
    const roll = rollNpc(init.archetype, this.rng, init.faction);
    const rec: NpcRecord = {
      key: this.manualKey--,
      archetype: init.archetype,
      faction: roll.faction,
      shipType: init.shipType ?? roll.shipType,
      name: roll.name,
      title: roll.title,
      loot: roll.gold,
      region: "manual",
      tier: "active",
      rail: null,
      port: null,
      departAtMs: 0,
      eid: null,
      hp: null,
    };
    return this.promote(rec, { x: init.x, z: init.z, rotationY: init.rotationY ?? 0 }, 0);
  }

  private promote(rec: NpcRecord, pos: { x: number; z: number; rotationY: number }, speed: number): ActiveNpc {
    const p = this.world.addNpc({
      name: rec.name,
      shipType: rec.shipType,
      x: pos.x,
      z: pos.z,
      rotationY: pos.rotationY,
      faction: rec.faction,
      title: rec.title,
    });
    p.speed = -Math.min(speed, p.maxSpeed);
    if (rec.hp !== null) p.hp = Math.min(p.maxHp, Math.max(1, rec.hp));
    rec.tier = "active";
    rec.eid = p.eid;
    const arch = ARCHETYPES[rec.archetype];
    const a: ActiveNpc = {
      rec,
      p,
      arch,
      brain: newBrain(arch.patrols ? "patrol" : "travel", this.world.timeMs),
      threat: new ThreatTable(),
      wander: { angle: 0 },
      rng: mulberry32((this.seedCounter++ * 0x9e3779b1) ^ p.eid),
      home: { x: p.x, z: p.z },
      followS: rec.rail?.s ?? 0,
      idleUntilMs: 0,
      sunkAtMs: -1,
      struck: false,
    };
    this.active.set(p.eid, a);
    return a;
  }

  private demote(a: ActiveNpc): void {
    const rec = a.rec;
    rec.hp = a.p.hp;
    this.director.snapToLane(rec, a.p.x, a.p.z);
    this.fairplay.release(a.p.eid);
    this.world.removeNpc(a.p.eid);
    this.active.delete(a.p.eid);
    rec.eid = null;
    rec.tier = rec.port ? "docked" : "rail";
  }

  // ---------------------------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------------------------

  /** One tick (called by World.step via npcHook). */
  tick(prevEvents: readonly WorldEvent[]): void {
    const t0 = performance.now();
    const w = this.world;
    const now = w.timeMs;

    // Live players this tick.
    const players = this.players;
    players.length = 0;
    w.players.forEach((p) => {
      if (p.controller === "player" && !p.dead && !p.sunk) {
        players.push(p);
        this.fairplay.seePlayer(p.id, now);
      }
    });

    this.handleEvents(prevEvents, now);

    // Director, rails, LOD (only when there are lanes to sail).
    if (this.director.polys.length > 0) {
      this.director.topUp(now, players);
      this.director.stepRails(now);
      if (w.tick % LOD_EVERY_TICKS === 0) this.lodPass();
    }

    // Active NPCs.
    this.active.forEach((a) => {
      const p = a.p;
      if (p.sunk || p.dead) {
        if (a.sunkAtMs < 0) a.sunkAtMs = now;
        if (now - a.sunkAtMs >= NPC_SINK_REMOVE_MS) {
          this.fairplay.release(p.eid);
          w.removeNpc(p.eid);
          this.active.delete(p.eid);
        }
        return;
      }
      if (isDecisionTick(w.tick, p.eid)) this.think(a, now);
      this.act(a, now);
    });

    this.stats.records = this.director.records.size + this.countManual();
    this.stats.active = this.active.size;
    const dt = performance.now() - t0;
    this.stats.lastTickMs = dt;
    if (dt > this.stats.maxTickMs) this.stats.maxTickMs = dt;
  }

  /** Active World ships that are not live director records: wrecks and manual NPCs. */
  private extraActive(): number {
    let n = 0;
    this.active.forEach((a) => {
      if (a.rec.key < 0 || a.p.sunk || a.p.dead || !this.director.records.has(a.rec.key)) n++;
    });
    return n;
  }

  private countManual(): number {
    let n = 0;
    this.active.forEach((a) => {
      if (a.rec.key < 0) n++;
    });
    return n;
  }

  private handleEvents(events: readonly WorldEvent[], now: number): void {
    const w = this.world;
    for (const ev of events) {
      if (ev.kind === "fire") {
        if (this.active.has(ev.eid)) this.stats.fires++;
      } else if (ev.kind === "hit") {
        const shooter = w.byEid.get(ev.ownerEid);
        if (shooter?.controller === "npc") this.stats.hitsByNpc++;
        const victim = this.active.get(ev.targetEid);
        if (!victim) continue;
        const dmg = ev.damage ?? 0;
        victim.threat.addDamage(ev.ownerEid, dmg, now);
        callForHelp(
          { eid: victim.p.eid, x: victim.p.x, z: victim.p.z, faction: victim.rec.faction },
          ev.ownerEid,
          dmg * 2,
          this.helpCandidates(),
          areAllies,
          this.metric,
          now,
        );
        if (shooter && shooter.controller === "player") {
          this.fairplay.provoke(shooter.id);
          const key = `${victim.p.eid}:${shooter.id}`;
          if (!this.provokedPairs.has(key)) {
            this.provokedPairs.add(key);
            this.repEvent(shooter.id, victim.rec.faction, "attack");
          }
        }
      } else if (ev.kind === "sunk") {
        const a = this.active.get(ev.eid);
        if (!a) continue;
        this.stats.sunkNpcs++;
        a.sunkAtMs = now;
        this.fairplay.release(a.p.eid);
        // Killer = owner of the hit that brought hp to 0.
        let killer: WorldPlayer | undefined;
        for (const h of events) if (h.kind === "hit" && h.targetEid === ev.eid && h.hp <= 0) killer = w.byEid.get(h.ownerEid);
        let amount = 0;
        if (!a.struck) {
          if (killer?.controller === "player") {
            amount = this.fairplay.grantLoot(killer.id, a.rec.loot, now);
            this.repEvent(killer.id, a.rec.faction, "sink");
          } else {
            amount = Math.round(a.rec.loot * NPC_KILL_LOOT_SHARE);
          }
        }
        if (amount > 0) w.dropGold(a.p.x, a.p.z, amount, now);
        if (a.rec.key > 0) this.director.sunk(a.rec.key, now);
      }
    }
  }

  private repEvent(playerId: string, faction: FactionId, act: "attack" | "sink"): void {
    const changes = repChangesFor(faction, act);
    applyRepChanges(this.standingOf(playerId), changes, notorietyFor(faction, act));
    emitRepChanges(this.world.effects, playerId, changes, act === "sink" ? "sankNpc" : "attackedNpc");
  }

  private *helpCandidates() {
    for (const a of this.active.values()) {
      if (a.p.sunk) continue;
      yield { eid: a.p.eid, x: a.p.x, z: a.p.z, faction: a.rec.faction, threat: a.threat };
    }
  }

  private lodPass(): void {
    const players = this.players;
    const m = this.metric;
    const nearest = (x: number, z: number) => {
      let best = Infinity;
      for (const p of players) {
        const d = m.distSq(x, z, p.x, p.z);
        if (d < best) best = d;
      }
      return best;
    };
    const { promote, demote } = this.director.lod(nearest, (r) => {
      if (r.eid === null || !r.rail) return null; // manual NPCs never demote
      const a = this.active.get(r.eid);
      if (!a || a.p.sunk) return null;
      return { x: a.p.x, z: a.p.z, inCombat: isCombatState(a.brain.state) };
    }, this.extraActive());
    for (const r of demote) {
      const a = r.eid !== null ? this.active.get(r.eid) : undefined;
      if (a) this.demote(a);
    }
    for (const r of promote) {
      const pos = this.director.positionOf(r);
      if (!pos || !r.rail) continue;
      this.promote(r, pos, r.rail.speed / 60);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Perception + decision (4 Hz per NPC)
  // ---------------------------------------------------------------------------------------------

  private hostilityTo(a: ActiveNpc, o: WorldPlayer): number {
    if (o.controller === "npc") return baseHostility({ faction: a.rec.faction }, { kind: "npc", faction: o.faction ?? "" });
    return baseHostility({ faction: a.rec.faction }, { kind: "player", standing: this.standingOf(o.id) });
  }

  /** May `a` fight `o` now (alive, fair play, safe zones)? */
  private canFight(a: ActiveNpc, o: WorldPlayer | undefined, now: number): boolean {
    if (!o || o.sunk || o.dead || this.world.byEid.get(o.eid) !== o) return false;
    if (o.controller === "player") {
      return this.fairplay.canEngagePlayer(a.p.eid, o.id, a.p, o, this.safeZones, this.metric, now);
    }
    if (this.safeZones.length && (inSafeZone(o.x, o.z, this.safeZones, this.metric) || inSafeZone(a.p.x, a.p.z, this.safeZones, this.metric))) {
      return false;
    }
    return true;
  }

  private think(a: ActiveNpc, now: number): void {
    const w = this.world;
    const p = a.p;
    const sense = a.arch.senseRadius;
    a.threat.decay(DECISION_DT_SEC, now);
    const seen = w.visibleShips(p, sense);
    for (const o of seen) {
      if (o.sunk) continue;
      let h = this.hostilityTo(a, o);
      if (h <= 0) continue;
      if (o.controller === "player") {
        if (!this.canFight(a, o, now)) continue;
        h *= classMatch(p.shipType, o.shipType);
      }
      const d = Math.sqrt(this.metric.distSq(p.x, p.z, o.x, o.z));
      a.threat.addProximity(o.eid, h, Math.max(0, 1 - d / sense), DECISION_DT_SEC, now);
    }

    const top = a.threat.top((eid) => this.canFight(a, w.byEid.get(eid), now));
    let target: Perception["target"] = null;
    if (top) {
      const o = w.byEid.get(top.eid)!;
      target = {
        eid: o.eid,
        dist: Math.sqrt(this.metric.distSq(p.x, p.z, o.x, o.z)),
        threat: top.threat,
        hostility: this.hostilityTo(a, o),
        power: firepower(o.shipType, o.hp / Math.max(1, o.maxHp)),
      };
    }
    let loot: Perception["loot"] = null;
    for (const g of w.gold) {
      const d = Math.sqrt(this.metric.distSq(p.x, p.z, g.x, g.z));
      if (d <= LOOT_RADIUS && (!loot || d < loot.dist)) loot = { dist: d };
    }
    const prev = a.brain.state;
    decide(a.brain, a.arch, {
      nowMs: now,
      hpFrac: p.hp / Math.max(1, p.maxHp),
      myPower: firepower(p.shipType, p.hp / Math.max(1, p.maxHp)),
      target,
      loot,
      hasRoute: a.rec.rail !== null,
    });

    // Attacker slots (fair play): hold one only while attacking a player.
    const tgt = a.brain.targetEid !== null ? w.byEid.get(a.brain.targetEid) : undefined;
    const attacking = a.brain.state === "engage" || a.brain.state === "pursue";
    if (attacking && tgt?.controller === "player") {
      if (!this.fairplay.claim(p.eid, tgt.id)) {
        a.threat.remove(tgt.eid);
        a.brain.state = prev === "engage" || prev === "pursue" ? (a.arch.patrols ? "patrol" : "travel") : prev;
        a.brain.targetEid = null;
      }
    } else {
      this.fairplay.release(p.eid);
    }

    // Merchants strike their colours once: drop cargo (capped per attacking player).
    if (a.brain.state === "surrender" && !a.struck) {
      a.struck = true;
      const taker = tgt?.controller === "player" ? tgt : undefined;
      const amount = taker ? this.fairplay.grantLoot(taker.id, a.rec.loot, now) : Math.round(a.rec.loot * NPC_KILL_LOOT_SHARE);
      if (amount > 0) w.dropGold(p.x, p.z, amount, now);
      a.rec.loot = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Per-tick action: state → desired velocity → {th, ru, f}
  // ---------------------------------------------------------------------------------------------

  private act(a: ActiveNpc, now: number): void {
    const w = this.world;
    const p = a.p;
    const self: SteerShip = { x: p.x, z: p.z, rotationY: p.rotationY, velocity: p.speed, maxSpeed: p.maxSpeed };
    const target = a.brain.targetEid !== null ? w.byEid.get(a.brain.targetEid) : undefined;
    const live =
      target && !target.sunk && !target.dead
        ? { x: target.x, z: target.z, rotationY: target.rotationY, velocity: target.speed }
        : undefined;
    let v: Vec = { x: 0, z: 0 };
    let fire = false;

    switch (a.brain.state) {
      case "engage": {
        if (!live) break;
        const reloading = now - p.lastFired < p.reloadTime;
        const order = engage(self, live, { range: a.arch.engageRange, aimError: a.arch.aimError }, reloading, this.metric, a.rng);
        const d = moveDir(order.heading);
        v = { x: d.x * order.speed, z: d.z * order.speed };
        fire = order.fire;
        break;
      }
      case "pursue":
        if (live) v = pursue(self, live, this.metric);
        break;
      case "flee":
        if (live) v = evade(self, live, this.metric);
        else v = wander(self, a.wander, a.rng);
        break;
      case "surrender":
        v = { x: 0, z: 0 };
        break;
      case "loot": {
        let best: { x: number; z: number } | null = null;
        let bd = Infinity;
        for (const g of w.gold) {
          const d = this.metric.distSq(p.x, p.z, g.x, g.z);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
        v = best ? arrive(self, best.x, best.z, this.metric, 150, 0) : wander(self, a.wander, a.rng);
        break;
      }
      case "travel":
      case "patrol":
      default:
        v = this.followLaneOrWander(a, self, now);
        break;
    }

    const avoid = avoidLand(self, this.land, this.metric);
    const steer = toSteer(self, withAvoidance(v, avoid));
    const input = toInput(self, steer.heading, steer.speed, p.physics);
    if (fire) input.f = 1;
    w.setNpcInput(p, input);
  }

  private followLaneOrWander(a: ActiveNpc, self: SteerShip, now: number): Vec {
    const rail = a.rec.rail;
    const patrolSpeed = a.brain.state === "patrol" ? 0.7 : 1;
    if (!rail) {
      const d2 = this.metric.distSq(self.x, self.z, a.home.x, a.home.z);
      if (d2 > PATROL_LEASH * PATROL_LEASH) return seek(self, a.home.x, a.home.z, this.metric);
      const v = wander(self, a.wander, a.rng);
      return { x: v.x * patrolSpeed, z: v.z * patrolSpeed };
    }
    if (now < a.idleUntilMs) return { x: 0, z: 0 };
    if (a.rec.port) {
      // Done idling at the dock: take the next lane out.
      a.rec.departAtMs = now;
      this.director.arrive(a.rec, now, false);
      a.rec.port = null;
      a.followS = a.rec.rail!.s;
    }
    const r = a.rec.rail!;
    const m = this.metric;
    // Advance the follow point while it is closer than the lookahead.
    for (let i = 0; i < 20; i++) {
      const q = pointAt(r.poly, a.followS, m, r.dir);
      if (m.distSq(self.x, self.z, q.x, q.z) > LANE_LOOKAHEAD * LANE_LOOKAHEAD) break;
      const nextS = a.followS + r.dir * 50;
      if (nextS < 0 || nextS > r.poly.total) break;
      a.followS = nextS;
    }
    r.s = a.followS;
    const end = r.dir === 1 ? r.poly.total : 0;
    const q = pointAt(r.poly, a.followS, m, r.dir);
    const atEnd = Math.abs(a.followS - end) < 1 && m.distSq(self.x, self.z, q.x, q.z) < LANE_ARRIVE * LANE_ARRIVE;
    if (atEnd) {
      if (!a.arch.patrols) {
        // Merchants dock (idle) in the active tier, then sail on.
        this.director.arrive(a.rec, now, true);
        a.idleUntilMs = a.rec.departAtMs;
        return { x: 0, z: 0 };
      }
      this.director.arrive(a.rec, now, false);
      a.followS = a.rec.rail!.s;
    }
    const v = seek(self, q.x, q.z, m);
    return { x: v.x * patrolSpeed, z: v.z * patrolSpeed };
  }
}

export type { Lane } from "./lod";
export type { LandQuery } from "./steering";
export type { SafeZone } from "./fairplay";
