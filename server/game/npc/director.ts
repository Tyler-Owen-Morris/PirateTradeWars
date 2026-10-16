/**
 * The fleet director: owns every persistent NPC as an `NpcRecord`, keeps each region's fleet
 * topped up (0.2 Hz), runs the rail and docked tiers, schedules respawns, and decides LOD
 * promotions/demotions. It never touches the World: the NPC system (index.ts) turns its decisions
 * into `world.addNpc` / `world.removeNpc`.
 *
 * Rules (proposal §3):
 * - at most `maxPersistent` (300) records, at most `maxActive` (80) active at once (closest first)
 * - new NPCs spawn only more than `minSpawnDist` (3000) from every player
 * - a sunk NPC's slot respawns after 2–5 minutes (the slot counts as occupied meanwhile)
 * - rail records advance every 0.5 s; merchants dock at the end of a lane for 20–60 s, then take
 *   another lane out of that port; patrols turn straight onto a new lane
 */
import { SHIP_STATS } from "@shared/gameConstants";
import type { ArchetypeId } from "./archetypes";
import { ARCHETYPES, rollNpc } from "./archetypes";
import type { FactionId } from "./factions";
import {
  ACTIVE_RADIUS,
  RAIL_STEP_MS,
  advanceRail,
  buildPolyline,
  nextTier,
  pointAt,
  projectOnto,
  railDestination,
  type Lane,
  type LodTier,
  type Polyline,
  type RailState,
} from "./lod";
import type { NpcMetric } from "./metric";
import { headingForDir } from "./util";

export const DIRECTOR_INTERVAL_MS = 5000; // 0.2 Hz
export const MIN_SPAWN_DIST = 3000;
export const RESPAWN_MIN_MS = 2 * 60 * 1000;
export const RESPAWN_MAX_MS = 5 * 60 * 1000;
export const DOCK_MIN_MS = 20_000;
export const DOCK_MAX_MS = 60_000;
/** NPC2: spacing between members of a convoy / patrol group along their lane (metric units). */
export const GROUP_SPACING = 160;

export interface RegionTarget {
  /** Label of this fleet. Records are counted per (region, archetype), so keep it unique per target
   *  when several targets share an archetype (e.g. "caribbean/navy/spain"). */
  region: string;
  archetype: ArchetypeId;
  count: number;
  /** Restrict factions (e.g. Spanish navy in the Caribbean). Default: the archetype's list. */
  factions?: FactionId[];
  /** NPC2: lanes this fleet sails (spawn AND every later lane hand-over). When absent, the lanes
   *  whose `laneRegion` equals `region` ("all" = every lane). A fleet ship that reaches a port with
   *  no matching lane turns around on the lane it came in on. */
  lanes?: (lane: Lane) => boolean;
  /** NPC2: take the nation of the departure port (`portFaction`) when no `factions` are given
   *  (merchants sail under the nation of their origin port). */
  originFaction?: boolean;
}

export interface DirectorConfig {
  maxPersistent: number;
  maxActive: number;
  minSpawnDist: number;
  respawnMinMs: number;
  respawnMaxMs: number;
  targets: RegionTarget[];
  /** Region of a lane (e.g. the region of its `from` port). Default: "all". */
  laneRegion: (lane: Lane) => string;
  /** NPC2: faction of a port id (for `originFaction` targets). Default: none (archetype list). */
  portFaction?: (port: string) => FactionId | undefined;
}

export const DEFAULT_TARGETS: RegionTarget[] = [
  { region: "all", archetype: "merchant", count: 150 },
  { region: "all", archetype: "navy", count: 60 },
  { region: "all", archetype: "pirate", count: 70 },
  { region: "all", archetype: "privateer", count: 20 },
];

export const DEFAULT_DIRECTOR: DirectorConfig = {
  maxPersistent: 300,
  maxActive: 80,
  minSpawnDist: MIN_SPAWN_DIST,
  respawnMinMs: RESPAWN_MIN_MS,
  respawnMaxMs: RESPAWN_MAX_MS,
  targets: DEFAULT_TARGETS,
  laneRegion: () => "all",
};

/** One persistent NPC, whatever its tier. */
export interface NpcRecord {
  key: number;
  archetype: ArchetypeId;
  faction: FactionId;
  shipType: string;
  name: string;
  title: string;
  /** Gold dropped (under the fair-play cap) when sunk or surrendering. */
  loot: number;
  region: string;
  tier: LodTier;
  /** Lane progress (rail tier, and the lane an active NPC is following). */
  rail: RailState | null;
  /** Port id while docked. */
  port: string | null;
  departAtMs: number;
  /** World eid while active. */
  eid: number | null;
  /** Last known hp (kept across demotion/promotion). null = full. */
  hp: number | null;
  /** NPC2: index into `config.targets` of the fleet that owns this record (-1/undefined = none). */
  target?: number;
  /** NPC2: key of the convoy leader (members follow its lane choices); null/undefined = solo or leader. */
  leader?: number | null;
}

interface Respawn {
  region: string;
  archetype: ArchetypeId;
  atMs: number;
}

export interface PlayerPos {
  x: number;
  z: number;
}

export interface LodDecision {
  promote: NpcRecord[];
  demote: NpcRecord[];
}

export class Director {
  readonly records = new Map<number, NpcRecord>();
  readonly respawns: Respawn[] = [];
  readonly polys: Polyline[];
  private readonly byPort = new Map<string, { poly: Polyline; dir: 1 | -1 }[]>();
  private readonly byRegion = new Map<string, Polyline[]>();
  /** Lanes per fleet target (index into config.targets). */
  private readonly byTarget: Polyline[][];
  private nextKey = 1;
  private lastDirectorMs = -Infinity;
  private lastRailMs = -1;

  constructor(
    lanes: Lane[],
    readonly metric: NpcMetric,
    readonly rng: () => number,
    readonly config: DirectorConfig = DEFAULT_DIRECTOR,
  ) {
    this.polys = lanes.filter((l) => l.points.length >= 2).map((l) => buildPolyline(l, metric));
    for (const p of this.polys) {
      this.addPort(p.lane.from, { poly: p, dir: 1 });
      this.addPort(p.lane.to, { poly: p, dir: -1 });
      const reg = config.laneRegion(p.lane);
      let list = this.byRegion.get(reg);
      if (!list) this.byRegion.set(reg, (list = []));
      list.push(p);
    }
    this.byTarget = config.targets.map((t) =>
      t.lanes ? this.polys.filter((p) => t.lanes!(p.lane)) : (this.byRegion.get(t.region) ?? (t.region === "all" ? this.polys : [])),
    );
  }

  private addPort(port: string, e: { poly: Polyline; dir: 1 | -1 }): void {
    let list = this.byPort.get(port);
    if (!list) this.byPort.set(port, (list = []));
    list.push(e);
  }

  get activeCount(): number {
    let n = 0;
    this.records.forEach((r) => {
      if (r.tier === "active") n++;
    });
    return n;
  }

  /** Coordinates and heading of a non-active record (rail position, or its port's lane end). */
  positionOf(r: NpcRecord): { x: number; z: number; rotationY: number } | null {
    if (!r.rail) return null;
    const p = pointAt(r.rail.poly, r.rail.s, this.metric, r.rail.dir);
    return { x: p.x, z: p.z, rotationY: headingForDir(p.dx, p.dz) };
  }

  private farFromPlayers(x: number, z: number, players: readonly PlayerPos[]): boolean {
    const d2 = this.config.minSpawnDist * this.config.minSpawnDist;
    for (const p of players) if (this.metric.distSq(x, z, p.x, p.z) <= d2) return false;
    return true;
  }

  private railFor(poly: Polyline, dir: 1 | -1, s: number, arch: ArchetypeId, shipSpeed: number): RailState {
    return { poly, dir, s, speed: shipSpeed * 60 * ARCHETYPES[arch].railSpeedFrac };
  }

  /** Create one record, or a group (convoy / patrol pair, at most `maxGroup`) on one lane, in the
   *  rail tier at a random spot on a lane of the fleet, more than minSpawnDist from every player.
   *  Group size comes from the archetype's `group`; members share ship type (so speed) and faction
   *  and trail the leader by GROUP_SPACING. Returns [] if no spot was found or the cap is full.
   *  `target` is an index into config.targets, or a region label (lanes by `laneRegion`). */
  spawn(target: number | string, arch: ArchetypeId, players: readonly PlayerPos[], factions?: FactionId[], maxGroup = 1): NpcRecord[] {
    const room = this.config.maxPersistent - this.records.size;
    if (room <= 0) return [];
    const ti = typeof target === "number" ? target : -1;
    const t = ti >= 0 ? this.config.targets[ti] : undefined;
    const region = t ? t.region : (target as string);
    const lanes = ti >= 0 ? this.byTarget[ti] : (this.byRegion.get(region) ?? (region === "all" ? this.polys : undefined));
    if (!lanes || lanes.length === 0) return [];
    const factionList = factions ?? t?.factions;
    for (let attempt = 0; attempt < 6; attempt++) {
      const poly = lanes[Math.floor(this.rng() * lanes.length) % lanes.length];
      const s = this.rng() * poly.total;
      const p = pointAt(poly, s, this.metric);
      if (!this.farFromPlayers(p.x, p.z, players)) continue;
      const dir: 1 | -1 = this.rng() < 0.5 ? 1 : -1;
      let f = factionList && factionList.length ? factionList[Math.floor(this.rng() * factionList.length) % factionList.length] : undefined;
      if (!f && t?.originFaction && this.config.portFaction) f = this.config.portFaction(dir === 1 ? poly.lane.from : poly.lane.to);
      const [gMin, gMax] = ARCHETYPES[arch].group;
      const want = gMin + Math.floor(this.rng() * (gMax - gMin + 1));
      const n = Math.max(1, Math.min(want, maxGroup, room));
      const out: NpcRecord[] = [];
      let shipType = "";
      for (let k = 0; k < n; k++) {
        const roll = rollNpc(arch, this.rng, f);
        if (k === 0) {
          shipType = roll.shipType;
          f = roll.faction;
        }
        const sk = Math.max(0, Math.min(poly.total, s - dir * k * GROUP_SPACING));
        const rec: NpcRecord = {
          key: this.nextKey++,
          archetype: arch,
          faction: roll.faction,
          shipType,
          name: roll.name,
          title: roll.title,
          loot: roll.gold,
          region,
          tier: "rail",
          rail: this.railFor(poly, dir, sk, arch, shipSpeedOf(shipType)),
          port: null,
          departAtMs: 0,
          eid: null,
          hp: null,
          target: ti,
          leader: k === 0 ? null : out[0].key,
        };
        this.records.set(rec.key, rec);
        out.push(rec);
      }
      return out;
    }
    return [];
  }

  /** 0.2 Hz: drop expired respawn timers and top every fleet target back up. Returns spawned. */
  topUp(nowMs: number, players: readonly PlayerPos[]): NpcRecord[] {
    if (nowMs - this.lastDirectorMs < DIRECTOR_INTERVAL_MS) return [];
    this.lastDirectorMs = nowMs;
    for (let i = this.respawns.length - 1; i >= 0; i--) if (this.respawns[i].atMs <= nowMs) this.respawns.splice(i, 1);
    const out: NpcRecord[] = [];
    this.config.targets.forEach((t, ti) => {
      if (ARCHETYPES[t.archetype].stub) return;
      let have = 0;
      this.records.forEach((r) => {
        if (r.region === t.region && r.archetype === t.archetype) have++;
      });
      for (const q of this.respawns) if (q.region === t.region && q.archetype === t.archetype) have++;
      while (have < t.count) {
        const rs = this.spawn(ti, t.archetype, players, t.factions, t.count - have);
        if (rs.length === 0) break;
        have += rs.length;
        out.push(...rs);
      }
    });
    return out;
  }

  /** A record's ship sank (or was removed): forget it and schedule its replacement. */
  sunk(key: number, nowMs: number): void {
    const r = this.records.get(key);
    if (!r) return;
    this.records.delete(key);
    const span = this.config.respawnMaxMs - this.config.respawnMinMs;
    this.respawns.push({ region: r.region, archetype: r.archetype, atMs: nowMs + this.config.respawnMinMs + this.rng() * span });
  }

  /** Pick a lane out of `port` (not the one we came in on if there is a choice), restricted to the
   *  record's fleet lanes when its target has a lane filter (null = none: turn around). */
  private nextLane(port: string, cameFrom: Polyline | null, r?: NpcRecord): { poly: Polyline; dir: 1 | -1 } | null {
    let list = this.byPort.get(port);
    if (!list || list.length === 0) return null;
    const t = r && r.target !== undefined && r.target >= 0 ? this.config.targets[r.target] : undefined;
    if (t?.lanes) {
      list = list.filter((l) => t.lanes!(l.poly.lane));
      if (list.length === 0) return null;
    }
    const choices = list.length > 1 && cameFrom ? list.filter((l) => l.poly !== cameFrom) : list;
    return choices[Math.floor(this.rng() * choices.length) % choices.length];
  }

  /** The live leader of a convoy member, if it still exists. */
  private leaderOf(r: NpcRecord): NpcRecord | undefined {
    return r.leader != null ? this.records.get(r.leader) : undefined;
  }

  /** Lane hand-over at the end of a lane (used for rail and active NPCs). */
  arrive(r: NpcRecord, nowMs: number, dock: boolean): void {
    if (!r.rail) return;
    const port = railDestination(r.rail);
    if (dock) {
      r.port = port;
      r.departAtMs = nowMs + DOCK_MIN_MS + this.rng() * (DOCK_MAX_MS - DOCK_MIN_MS);
      // Convoy members leave port right after their leader (keeping their spacing in time).
      const lead = this.leaderOf(r);
      if (lead && lead.port === port) r.departAtMs = Math.max(nowMs + 1000, lead.departAtMs + (r.key - lead.key) * 1500);
      if (r.tier !== "active") r.tier = "docked";
      return;
    }
    this.depart(r, port, r.rail.poly);
  }

  private depart(r: NpcRecord, port: string, cameFrom: Polyline | null): void {
    // Convoy members take the lane their leader took out of this port, if it already left on one.
    const lead = this.leaderOf(r);
    const leadOut =
      lead?.rail && lead.port === null && (lead.rail.dir === 1 ? lead.rail.poly.lane.from : lead.rail.poly.lane.to) === port
        ? { poly: lead.rail.poly, dir: lead.rail.dir }
        : null;
    const next = leadOut ?? this.nextLane(port, cameFrom, r);
    if (!next) {
      // Dead end: sail the same lane back.
      if (r.rail) r.rail.dir = r.rail.dir === 1 ? -1 : 1;
      r.port = null;
      if (r.tier === "docked") r.tier = "rail";
      return;
    }
    r.rail = this.railFor(next.poly, next.dir, next.dir === 1 ? 0 : next.poly.total, r.archetype, shipSpeedOf(r.shipType));
    r.port = null;
    if (r.tier === "docked") r.tier = "rail";
  }

  /** Re-attach an active ship to the nearest point of its lane (used when it is demoted). */
  snapToLane(r: NpcRecord, x: number, z: number): void {
    if (!r.rail) return;
    r.rail.s = projectOnto(r.rail.poly, x, z, this.metric).s;
  }

  /** Every 0.5 s: advance rail records, undock due docked records. */
  stepRails(nowMs: number): void {
    if (this.lastRailMs < 0) {
      this.lastRailMs = nowMs;
      return;
    }
    if (nowMs - this.lastRailMs < RAIL_STEP_MS) return;
    const dt = (nowMs - this.lastRailMs) / 1000;
    this.lastRailMs = nowMs;
    this.records.forEach((r) => {
      if (r.tier === "rail" && r.rail) {
        if (advanceRail(r.rail, dt)) this.arrive(r, nowMs, !ARCHETYPES[r.archetype].patrols);
      } else if (r.tier === "docked" && nowMs >= r.departAtMs && r.port) {
        this.depart(r, r.port, r.rail?.poly ?? null);
      }
    });
  }

  /**
   * LOD pass. `nearestDistSq(x, z)` = squared metric distance to the closest player;
   * `activePos(rec)` gives an active record's live position and whether it is in combat.
   * Promotions are capped at maxActive, closest first. `extraActive` = World ships the director
   * does not own as live records (wrecks waiting for removal, manual NPCs); they use up the cap too.
   */
  lod(
    nearestDistSq: (x: number, z: number) => number,
    activePos: (r: NpcRecord) => { x: number; z: number; inCombat: boolean } | null,
    extraActive = 0,
  ): LodDecision {
    const promote: { r: NpcRecord; d2: number }[] = [];
    const demote: NpcRecord[] = [];
    let active = 0;
    this.records.forEach((r) => {
      if (r.tier === "active") {
        const a = activePos(r);
        if (!a) return;
        if (nextTier("active", nearestDistSq(a.x, a.z), a.inCombat) === "rail") demote.push(r);
        else active++;
      } else if (r.tier === "rail") {
        const p = this.positionOf(r);
        if (!p) return;
        const d2 = nearestDistSq(p.x, p.z);
        if (nextTier("rail", d2, false) === "active") promote.push({ r, d2 });
      }
    });
    promote.sort((a, b) => a.d2 - b.d2);
    const room = Math.max(0, this.config.maxActive - active - extraActive);
    return { promote: promote.slice(0, room).map((p) => p.r), demote };
  }
}

/** Max speed of a ship type, units per 1/60 s frame. */
function shipSpeedOf(shipType: string): number {
  return SHIP_STATS[shipType]?.speed ?? 4;
}

export { ACTIVE_RADIUS };
