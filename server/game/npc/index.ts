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
 * NPC2: ON by default (`NPCS_ENABLED=0|false|off|no` disables it). `createLiveNpcSystem` builds it
 * with the real lanes (shared/world/lanes.json), port safe zones, the live fleets (population.ts)
 * and the World's LandField.
 */
import type { World, WorldEvent, WorldPlayer } from "../world";
import { ARCHETYPES, rollNpc, type Archetype, type ArchetypeId } from "./archetypes";
import { decide, isCombatState, isDecisionTick, newBrain, DECISION_DT_SEC, LOOT_RADIUS, type Brain, type Perception } from "./brain";
import { DEFAULT_DIRECTOR, Director, type DirectorConfig, type NpcRecord } from "./director";
import { DEFAULT_FAIRPLAY, FairPlay, classMatch, inSafeZone, type FairPlayConfig, type SafeZone } from "./fairplay";
import {
  applyRepChanges,
  decayNotoriety,
  areAllies,
  baseHostility,
  emitRepChanges,
  newStanding,
  notorietyFor,
  repChangesFor,
  type FactionId,
  type PlayerStanding,
} from "./factions";
import { pointAt, projectOnto, type Lane } from "./lod";
import { normalizeAngle, stepShip, type ShipInput } from "@shared/physics";
import { defaultMetric, type NpcMetric } from "./metric";
import {
  arrive,
  avoidLand,
  flee,
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
  type AvoidMemo,
} from "./steering";
import { FIRE_RANGE_FACTOR, beamError, engage, fireTolerance, firepower } from "./tactics";
import { callForHelp, ThreatTable } from "./threat";
import { headingForDir, moveDir, mulberry32 } from "./util";
import { LANES as LIVE_LANES, liveDirector, portSafeZones } from "./population";
import { planPath, segmentClear, type NavPoint } from "./nav";

/** NPC2: NPCs are ON unless NPCS_ENABLED is 0 / false / no / off. */
export function npcsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.NPCS_ENABLED ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
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
/** NPC2 unstick: consecutive 1 s checks without progress while touching the coast. */
export const UNSTICK_AFTER_S = 2;
/** NPC2 unstick: how long the turn-away manoeuvre lasts. */
export const UNSTICK_MS = 3000;
/** NPC2 unstick: "touching the coast" = land distance < hullRadius + this. */
export const UNSTICK_COAST = 40;
/** NPC2 lane line of sight: required land clearance beyond the hull, sample spacing, and how far
 *  ahead of the nearest lane point to steer when the lookahead point is out of sight. */
export const LOS_MARGIN = 15;
export const LOS_SAMPLE = 40;
export const LOS_STEP = 60;
/** NPC2 coast following (lane behind land): standoff beyond the hull, and when to try the other way. */
export const WALL_STANDOFF = 80;
export const WALL_FLIP_MS = 40_000;
/** NPC2 path planning (nav.ts): plans allowed per tick (all NPCs), replan interval, waypoint reached. */
export const NAV_PLANS_PER_TICK = 2;
export const NAV_REPLAN_MS = 5000;
export const NAV_REACHED = 100;
/** NPC2: notoriety decay cadence (ticks; 200 = every 10 s). */
export const NOTORIETY_DECAY_EVERY_TICKS = 200;
/** F1: an NPC a player hit may fight that player back for this long even when the player's
 *  attacker slots (fair play, max 2) are taken by other NPCs. Without it a provoked pirate could
 *  lose the slot race to its neighbours, drop the player and sail off without firing (Q1 B2). */
export const SELF_DEFENCE_MS = 60_000;
/** F1 (Q1 B3): after a hit an NPC is "under fire" this long: it will not dock at its lane end, and a
 *  hit on a ship idling at a dock cancels the idle (it sails out instead of sitting dead in the
 *  water for the 20–60 s dock time while being shot; port safe zones stop NPCs fighting back, so
 *  the brain never leaves `travel` there). */
export const UNDER_FIRE_MS = 10_000;
/** F1 (B2): a fleeing ship keeps its escape course until the threat is more than this off dead
 *  astern (radians; 90° = abeam, so a faster attacker can still come up alongside for a broadside),
 *  then re-aims straight away from it (see `act`, case "flee"). */
export const FLEE_REAIM_ANGLE = Math.PI / 2;
const TICK_SEC = 0.05;

export interface NpcSystemOptions {
  lanes?: Lane[];
  /** Port safe zones (WORLD_SPEC §5 dock/safeRadius). */
  safeZones?: SafeZone[];
  land?: LandQuery;
  metric?: NpcMetric;
  seed?: number;
  director?: Partial<DirectorConfig>;
  fairplay?: Partial<FairPlayConfig>;
  /** Tests only: active director NPCs are never demoted (no players needed to keep them active). */
  pinActive?: boolean;
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
  /** NPC2: world tick of the last lane-following step (a gap → re-project onto the lane). */
  followTick: number;
  /** NPC2: coast deadlock breaker (see NpcSystem.unstick). */
  unstickUntilMs: number;
  stuckChecks: number;
  progress: { x: number; z: number };
  /** NPC2: coast-following side while the lane is behind land (0 = not wall following). */
  wallSide: -1 | 0 | 1;
  wallSinceMs: number;
  /** NPC2: avoidLand tangent-side memory (hysteresis). */
  avoid: AvoidMemo;
  /** NPC2: planned path back to the lane when it is behind land (nav.ts), and progress along it. */
  path: NavPoint[] | null;
  pathIdx: number;
  nextPlanMs: number;
  /** F1: this volley's accepted extra beam error (0..arch.aimError), re-rolled after each shot. */
  aimSlack: number;
  /** F1: `p.lastFired` when `aimSlack` was rolled (a new shot → roll again). */
  aimSlackFor: number;
  /** F1: playerId → sim ms of that player's last hit on this NPC (self-defence, SELF_DEFENCE_MS). */
  attackedBy: Map<string, number>;
  /** F1 (B3): sim ms until which the NPC counts as under fire (no docking), see UNDER_FIRE_MS. */
  underFireUntilMs: number;
  /** F1 (B2): committed escape direction (unit, metric) while fleeing; null otherwise. */
  fleeDir: Vec | null;
}

export interface NpcStats {
  records: number;
  active: number;
  fires: number;
  hitsByNpc: number;
  sunkNpcs: number;
  /** NPC2: times an NPC pinned against a coast ran the unstick manoeuvre. */
  unsticks: number;
  /** NPC2: path plans run (lane behind land). */
  navPlans: number;
  /** NPC2: slowest single path plan and LOD pass (ms) since the stats were last reset. */
  navMaxMs: number;
  lodMaxMs: number;
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
  readonly stats: NpcStats = { records: 0, active: 0, fires: 0, hitsByNpc: 0, sunkNpcs: 0, unsticks: 0, navPlans: 0, navMaxMs: 0, lodMaxMs: 0, lastTickMs: 0, maxTickMs: 0 };
  private readonly safeZones: SafeZone[];
  private readonly rng: () => number;
  private readonly provokedPairs = new Set<string>();
  private readonly players: WorldPlayer[] = [];
  private seedCounter = 1;
  private manualKey = -1;
  private readonly pinActive: boolean;
  private plansThisTick = 0;

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
    this.pinActive = opts.pinActive ?? false;
  }

  /** Install as the world's AI hook. */
  attach(): this {
    this.world.npcHook = (_w, ev) => this.tick(ev);
    return this;
  }

  detach(): void {
    if (this.world.npcHook) this.world.npcHook = null;
  }

  /**
   * A player's standing. NPC2: for a player in the world it lives on the WorldPlayer (`standing`,
   * persisted with the player record in Redis and restored by World.restorePlayer); it is created
   * on first use. The `standings` map only holds players that are not in the world.
   */
  standingOf(playerId: string): PlayerStanding {
    const p = this.world.getPlayer(playerId);
    if (p && p.controller === "player") {
      if (!p.standing) {
        p.standing = this.standings.get(playerId) ?? newStanding();
        this.standings.delete(playerId);
        p.standingVersion++;
      }
      return p.standing as PlayerStanding;
    }
    let s = this.standings.get(playerId);
    if (!s) this.standings.set(playerId, (s = newStanding()));
    return s;
  }

  /** NPC2: notoriety decay for players in the world, every NOTORIETY_DECAY_EVERY_TICKS. */
  private decayStandings(): void {
    const minutes = (NOTORIETY_DECAY_EVERY_TICKS * TICK_SEC) / 60;
    this.world.players.forEach((p) => {
      if (p.controller === "player" && p.standing && decayNotoriety(p.standing, minutes)) p.standingVersion++;
    });
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

  /** Promote a director record (rail tier) into the world now, at its lane position (tests, tools). */
  promoteRecord(rec: NpcRecord): ActiveNpc | null {
    if (rec.tier !== "rail" || !rec.rail) return null;
    const pos = this.director.positionOf(rec);
    return pos ? this.promote(rec, pos, rec.rail.speed / 60) : null;
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
      followTick: this.world.tick,
      unstickUntilMs: 0,
      stuckChecks: 0,
      progress: { x: p.x, z: p.z },
      wallSide: 0,
      wallSinceMs: 0,
      avoid: { side: 0 },
      path: null,
      pathIdx: 0,
      nextPlanMs: 0,
      aimSlack: 0,
      aimSlackFor: NaN,
      attackedBy: new Map(),
      underFireUntilMs: 0,
      fleeDir: null,
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
    this.plansThisTick = 0;
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
    if (w.tick % NOTORIETY_DECAY_EVERY_TICKS === 0) this.decayStandings();

    // Director, rails, LOD (only when there are lanes to sail).
    if (this.director.polys.length > 0) {
      this.director.topUp(now, players);
      this.director.stepRails(now);
      if (w.tick % LOD_EVERY_TICKS === 0) {
        const l0 = performance.now();
        this.lodPass();
        const ld = performance.now() - l0;
        if (ld > this.stats.lodMaxMs) this.stats.lodMaxMs = ld;
      }
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
        // F1: friendly fire (an ally's stray ball, e.g. a pirate pair both shooting at a player
        // between them) is not a reason to turn on that ally or call the fleet against it.
        if (shooter?.controller === "npc" && areAllies(victim.rec.faction, shooter.faction ?? "")) continue;
        const dmg = ev.damage ?? 0;
        victim.threat.addDamage(ev.ownerEid, dmg, now);
        if (shooter?.controller === "player") victim.attackedBy.set(shooter.id, now);
        // F1 (B3): under fire → no docking; a ship idling at a dock leaves right away.
        victim.underFireUntilMs = now + UNDER_FIRE_MS;
        if (victim.rec.port && victim.idleUntilMs > now) {
          victim.idleUntilMs = now;
          victim.rec.departAtMs = now;
        }
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
    const p = this.world.getPlayer(playerId);
    if (p) p.standingVersion++; // NPC2: re-send to the client
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
      return { x: a.p.x, z: a.p.z, inCombat: this.pinActive || isCombatState(a.brain.state) };
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

  /** F1: did player `playerId` hit `a` within SELF_DEFENCE_MS? */
  private defending(a: ActiveNpc, playerId: string, now: number): boolean {
    const t = a.attackedBy.get(playerId);
    return t !== undefined && now - t < SELF_DEFENCE_MS;
  }

  /** May `a` fight `o` now (alive, fair play, safe zones)? Never an ally. */
  private canFight(a: ActiveNpc, o: WorldPlayer | undefined, now: number): boolean {
    if (!o || o.sunk || o.dead || this.world.byEid.get(o.eid) !== o) return false;
    if (o.controller === "player") {
      // F1: self-defence ignores the shield and the attacker-slot cap (not the safe zones).
      if (this.defending(a, o.id, now)) {
        return !(this.safeZones.length && (inSafeZone(o.x, o.z, this.safeZones, this.metric) || inSafeZone(a.p.x, a.p.z, this.safeZones, this.metric)));
      }
      return this.fairplay.canEngagePlayer(a.p.eid, o.id, a.p, o, this.safeZones, this.metric, now);
    }
    if (areAllies(a.rec.faction, o.faction ?? "")) return false;
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
      if (!this.fairplay.claim(p.eid, tgt.id, this.defending(a, tgt.id, now))) {
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
        ? {
            x: target.x,
            z: target.z,
            rotationY: target.rotationY,
            velocity: target.speed,
            // F1: the rudder it is holding (players: last applied input) → lead along the arc.
            turnRate: target.lastInput.ru * target.physics.turnSpeed,
          }
        : undefined;
    let v: Vec = { x: 0, z: 0 };
    let tryFire = false;
    if (a.brain.state !== "flee") a.fleeDir = null;

    switch (a.brain.state) {
      case "engage": {
        if (!live) break;
        const reloading = now - p.lastFired < p.reloadTime;
        if (a.aimSlackFor !== p.lastFired) {
          // F1: one aim-error roll per volley (re-rolled after each shot).
          a.aimSlackFor = p.lastFired;
          a.aimSlack = a.rng() * a.arch.aimError;
        }
        const order = engage(
          self,
          live,
          { range: a.arch.engageRange, aimError: a.arch.aimError, cannonCount: p.cannonCount, aimSlack: a.aimSlack },
          reloading,
          this.metric,
          a.rng,
        );
        const d = moveDir(order.heading);
        v = { x: d.x * order.speed, z: d.z * order.speed };
        // F1: whether to fire is decided below on the pose AFTER this tick's rudder (see aim()).
        tryFire = !reloading && order.dist <= a.arch.engageRange * FIRE_RANGE_FACTOR;
        break;
      }
      case "pursue":
        if (live) v = pursue(self, live, this.metric);
        break;
      case "flee":
        // F1 (Q1 B2): commit to an escape course. `evade` ran from the threat's predicted position
        // every tick; an attacker orbiting at broadside range (tactics.engage) moves tangentially,
        // so that direction swept round and the runner sailed in circles beside it (≈ 2 laps in
        // 17 s, never opening the range) — the 375–1060 loop Q1 saw from the player's seat. Now the
        // course is "straight away from where the threat is" when the flight starts, and is only
        // re-picked when the threat gets more than FLEE_REAIM_ANGLE off dead astern.
        if (live) {
          const away = flee(self, live.x, live.z, this.metric);
          const al = Math.hypot(away.x, away.z);
          if (al > 1e-9) {
            const ux = away.x / al;
            const uz = away.z / al;
            if (!a.fleeDir || ux * a.fleeDir.x + uz * a.fleeDir.z < Math.cos(FLEE_REAIM_ANGLE)) a.fleeDir = { x: ux, z: uz };
            v = { x: a.fleeDir.x * self.maxSpeed, z: a.fleeDir.z * self.maxSpeed };
          }
        } else v = wander(self, a.wander, a.rng);
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

    const avoid = avoidLand(self, this.land, this.metric, undefined, v, a.avoid);
    const steer = toSteer(self, withAvoidance(v, avoid));
    let input = toInput(self, steer.heading, steer.speed, p.physics);
    input = this.unstick(a, steer.speed, input, now);
    if (tryFire && target && now >= a.unstickUntilMs) input = this.aim(a, target, input);
    w.setNpcInput(p, input);
  }

  /**
   * F1 (Q1 B2): fire control. The World applies this tick's rudder and throttle BEFORE it spawns the
   * broadside, and one tick of rudder is 0.15 rad (≈ 75 units of aim at 500), so the shot is judged
   * on the predicted pose: for the planned rudder and the alternatives (0, ±1) step this ship and the
   * target one tick with the real `stepShip` (the target with the input it is holding), and fire with
   * the rudder whose beam error is smallest, if it is within `fireTolerance` (+ this volley's aim
   * slack). Otherwise keep the planned input and wait: the bearing sweeps as the ships move.
   */
  private aim(a: ActiveNpc, target: WorldPlayer, input: ShipInput): ShipInput {
    const p = a.p;
    const land = this.world.land;
    const t = stepShip(
      { x: target.x, z: target.z, rotationY: target.rotationY, velocity: target.speed },
      { th: target.lastInput.th, ru: target.lastInput.ru, f: 0 },
      target.physics,
      land,
    );
    const tgt = { x: t.x, z: t.z, rotationY: t.rotationY, velocity: t.velocity, turnRate: target.lastInput.ru * target.physics.turnSpeed };
    const maxDist = a.arch.engageRange * FIRE_RANGE_FACTOR;
    let bestRu: -1 | 0 | 1 | null = null;
    let bestErr = Infinity;
    for (const ru of [input.ru, 0, 1, -1] as const) {
      const me = stepShip({ x: p.x, z: p.z, rotationY: p.rotationY, velocity: p.speed }, { th: input.th, ru, f: 0 }, p.physics, land);
      const dist = Math.sqrt(this.metric.distSq(me.x, me.z, tgt.x, tgt.z));
      if (dist > maxDist) continue;
      const err = Math.abs(beamError({ x: me.x, z: me.z, rotationY: me.rotationY, velocity: me.velocity }, tgt, this.metric));
      if (err <= fireTolerance(dist, p.cannonCount) + a.aimSlack && err < bestErr - 1e-9) {
        bestErr = err;
        bestRu = ru;
      }
    }
    return bestRu === null ? input : { th: input.th, ru: bestRu, f: 1 };
  }

  /**
   * NPC2: coast deadlock breaker. A ship pressed bow-first into a concave coast can sit still: the
   * slide removes its speed and the two coast tangents flip from tick to tick. Once a second
   * (staggered by eid) we check progress; after UNSTICK_AFTER_S checks with less than 15 % of the
   * expected distance made while touching the coast and wanting to move, the ship turns its bow
   * along the land normal (away from the coast), reversing until it points within 60° of it, for
   * UNSTICK_MS. It then re-projects onto its lane (`followTick` reset).
   */
  private unstick(a: ActiveNpc, wantSpeed: number, input: ShipInput, now: number): ShipInput {
    const p = a.p;
    const hull = p.physics.hullRadius ?? 20;
    if (now < a.unstickUntilMs) {
      const n = this.land.normal(p.x, p.z);
      if (n.nx === 0 && n.nz === 0) return input;
      const err = normalizeAngle(headingForDir(n.nx, n.nz) - p.rotationY);
      const ru: -1 | 0 | 1 = Math.abs(err) < 0.05 ? 0 : err > 0 ? 1 : -1;
      return { th: Math.abs(err) > Math.PI / 3 ? -1 : 1, ru, f: 0 };
    }
    if ((this.world.tick + p.eid) % 20 !== 0) return input;
    const moved = Math.sqrt(this.metric.distSq(a.progress.x, a.progress.z, p.x, p.z));
    a.progress.x = p.x;
    a.progress.z = p.z;
    const touching = this.land.distance(p.x, p.z) < hull + UNSTICK_COAST;
    if (touching && wantSpeed > 1 && moved < p.maxSpeed * 20 * 0.15) a.stuckChecks++;
    else a.stuckChecks = 0;
    if (a.stuckChecks >= UNSTICK_AFTER_S) {
      a.stuckChecks = 0;
      a.unstickUntilMs = now + UNSTICK_MS;
      a.followTick = -1; // re-project onto the lane afterwards
      this.stats.unsticks++;
    }
    return input;
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
    // NPC2: back on the lane after a fight, a chase or an unstick → resume from the nearest lane
    // point instead of the old follow point (which may now lie across a headland).
    const w = this.world;
    if (a.followTick !== w.tick - 1 && a.followTick !== w.tick && !a.rec.port) {
      a.followS = projectOnto(rail.poly, self.x, self.z, this.metric).s;
    }
    a.followTick = w.tick;
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
      // NPC2: clamp to the lane end (lengths are not multiples of 50; the end must be reachable).
      const nextS = Math.max(0, Math.min(r.poly.total, a.followS + r.dir * 50));
      if (nextS === a.followS) break;
      a.followS = nextS;
    }
    r.s = a.followS;
    const end = r.dir === 1 ? r.poly.total : 0;
    const q = pointAt(r.poly, a.followS, m, r.dir);
    const atEnd = Math.abs(a.followS - end) < 1 && m.distSq(self.x, self.z, q.x, q.z) < LANE_ARRIVE * LANE_ARRIVE;
    if (atEnd) {
      if (!a.arch.patrols && now >= a.underFireUntilMs) {
        // Merchants dock (idle) in the active tier, then sail on (F1 B3: not while under fire).
        this.director.arrive(a.rec, now, true);
        a.idleUntilMs = a.rec.departAtMs;
        return { x: 0, z: 0 };
      }
      this.director.arrive(a.rec, now, false);
      a.followS = a.rec.rail!.s;
    }
    // NPC2: line of sight. Lanes keep ≥ 80 units of clearance, but the straight line to a point
    // 250 ahead can cut across a spit or headland (Cavite, the Thames, ...), where avoidance and
    // seek cancel out. If it does, steer for the lane just ahead of our nearest lane point instead;
    // if that is behind land too (far off the lane after a chase), plan a path (nav.ts) to it.
    let tx = q.x;
    let tz = q.z;
    const hull = a.p.physics.hullRadius ?? 20;
    const clear = hull + LOS_MARGIN;
    if (this.clearPath(self.x, self.z, tx, tz, clear)) {
      a.path = null;
      a.wallSide = 0;
    } else {
      const wp = this.pathWaypoint(a, self, clear);
      if (wp) {
        tx = wp.x;
        tz = wp.z;
      } else {
        const rr = a.rec.rail!;
        const near = projectOnto(rr.poly, self.x, self.z, m).s;
        const s2 = Math.max(0, Math.min(rr.poly.total, near + rr.dir * LOS_STEP));
        const q2 = pointAt(rr.poly, s2, m, rr.dir);
        tx = q2.x;
        tz = q2.z;
        if (this.clearPath(self.x, self.z, tx, tz, clear)) a.wallSide = 0;
        else {
          let planned: NavPoint | null = null;
          if (this.plansThisTick < NAV_PLANS_PER_TICK && now >= a.nextPlanMs) {
            this.plansThisTick++;
            this.stats.navPlans++;
            a.nextPlanMs = now + NAV_REPLAN_MS;
            const n0 = performance.now();
            a.path = planPath(this.land, m, { x: self.x, z: self.z }, { x: tx, z: tz }, clear);
            const nd = performance.now() - n0;
            if (nd > this.stats.navMaxMs) this.stats.navMaxMs = nd;
            a.pathIdx = 0;
            planned = this.pathWaypoint(a, self, clear);
          }
          if (planned) {
            tx = planned.x;
            tz = planned.z;
          } else {
            // No plan this tick (budget) or none found: follow the coast.
            const wv = this.wallFollow(a, self, tx, tz, hull, now);
            if (wv) return { x: wv.x * patrolSpeed, z: wv.z * patrolSpeed };
          }
        }
      }
    }
    const v = seek(self, tx, tz, m);
    return { x: v.x * patrolSpeed, z: v.z * patrolSpeed };
  }

  /** NPC2: the current waypoint of a planned path (advancing past reached ones), or null when there
   *  is no path, it is finished, or the next waypoint went out of sight (replan later). */
  private pathWaypoint(a: ActiveNpc, self: SteerShip, clearance: number): NavPoint | null {
    const path = a.path;
    if (!path) return null;
    while (a.pathIdx < path.length && this.metric.distSq(self.x, self.z, path[a.pathIdx].x, path[a.pathIdx].z) < NAV_REACHED * NAV_REACHED) a.pathIdx++;
    if (a.pathIdx >= path.length) {
      a.path = null;
      return null;
    }
    const wp = path[a.pathIdx];
    if (this.world.tick % 10 === a.p.eid % 10 && !this.clearPath(self.x, self.z, wp.x, wp.z, clearance * 0.5)) {
      a.path = null;
      return null;
    }
    return wp;
  }

  /**
   * NPC2: "bug" navigation. The goal is behind land: keep the coast on one side at a standoff of
   * about hull + WALL_STANDOFF and sail along it until the goal is in sight again. The side is the
   * tangent closer to the goal when the manoeuvre starts and flips after WALL_FLIP_MS (so a ship
   * that picked the long way round an island turns back). null = no coast gradient here.
   */
  private wallFollow(a: ActiveNpc, self: SteerShip, tx: number, tz: number, hull: number, now: number): Vec | null {
    const n = this.land.normal(self.x, self.z);
    if (n.nx === 0 && n.nz === 0) return null;
    const tanX = -n.nz;
    const tanZ = n.nx;
    if (a.wallSide === 0 || now - a.wallSinceMs > WALL_FLIP_MS) {
      if (a.wallSide === 0) {
        const g = this.metric.delta(self.x, self.z, tx, tz);
        a.wallSide = tanX * g.dx + tanZ * g.dz >= 0 ? 1 : -1;
      } else a.wallSide = a.wallSide === 1 ? -1 : 1;
      a.wallSinceMs = now;
    }
    const d = this.land.distance(self.x, self.z);
    const k = Math.max(-0.5, Math.min(1, (hull + WALL_STANDOFF - d) / WALL_STANDOFF));
    const vx = tanX * a.wallSide + n.nx * k;
    const vz = tanZ * a.wallSide + n.nz * k;
    const l = Math.hypot(vx, vz) || 1;
    return { x: (vx / l) * self.maxSpeed, z: (vz / l) * self.maxSpeed };
  }

  /** NPC2: true if the straight (metric) segment a→b keeps at least `clearance` from land. */
  private clearPath(ax: number, az: number, bx: number, bz: number, clearance: number): boolean {
    return segmentClear(this.land, this.metric, ax, az, bx, bz, clearance, LOS_SAMPLE);
  }
}

/**
 * NPC2: the live NPC system for the real map: lanes.json, port safe zones, the live fleets
 * (population.ts) and the World's LandField. Not attached; call `.attach()`.
 */
export function createLiveNpcSystem(world: World, opts: NpcSystemOptions = {}): NpcSystem {
  return new NpcSystem(world, {
    lanes: LIVE_LANES as Lane[],
    safeZones: portSafeZones(),
    seed: 0x5eed,
    ...opts,
    director: liveDirector(opts.director),
  });
}

export type { Lane } from "./lod";
export type { LandQuery } from "./steering";
export type { SafeZone } from "./fairplay";
