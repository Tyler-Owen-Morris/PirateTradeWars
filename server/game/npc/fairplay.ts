/**
 * Fair-play rules (proposal §3 "Fair-play rules"). Pure bookkeeping, no world access.
 *
 * - new players are ignored for their first 10 minutes unless they provoke (hit an NPC)
 * - at most 2 NPCs attack one player at a time (attacker slots, claimed/released by the system)
 * - hostile NPCs prefer targets of a similar ship class (`classMatch` scales proximity threat)
 * - no fighting inside port safe zones (neither shooter nor target may be inside one)
 * - NPC loot is capped per player per hour (`grantLoot`)
 * - NPC kills don't count toward player-kill stats (`countsAsPlayerKill`; World flags
 *   `playerSunk.byNpc`)
 */
import { SHIP_TYPES } from "@shared/gameConstants";
import type { NpcMetric } from "./metric";

export const NEW_PLAYER_SHIELD_MS = 10 * 60 * 1000;
export const MAX_ATTACKERS_PER_PLAYER = 2;
/** Gold a single player may take from NPCs per rolling hour. */
export const LOOT_CAP_PER_HOUR = 3000;
export const LOOT_WINDOW_MS = 60 * 60 * 1000;
/** Default port safe radius when a zone does not say (WORLD_SPEC §5 safeRadius). */
export const DEFAULT_SAFE_RADIUS = 600;

export const SHIP_CLASS_ORDER: readonly string[] = [
  SHIP_TYPES.SLOOP,
  SHIP_TYPES.BRIGANTINE,
  SHIP_TYPES.GALLEON,
  SHIP_TYPES.MAN_O_WAR,
  SHIP_TYPES.DREADNAUGHT,
];

export function shipClass(shipType: string): number {
  const i = SHIP_CLASS_ORDER.indexOf(shipType);
  return i < 0 ? 0 : i;
}

/** Preference for a target of `targetShip` by an NPC in `npcShip`: 1 same class, 0.6 one apart,
 *  0.25 two apart, 0.1 beyond. */
export function classMatch(npcShip: string, targetShip: string): number {
  const d = Math.abs(shipClass(npcShip) - shipClass(targetShip));
  return d === 0 ? 1 : d === 1 ? 0.6 : d === 2 ? 0.25 : 0.1;
}

export interface SafeZone {
  x: number;
  z: number;
  safeRadius?: number;
}

export function inSafeZone(x: number, z: number, zones: readonly SafeZone[], m: NpcMetric): boolean {
  for (const p of zones) {
    const r = p.safeRadius ?? DEFAULT_SAFE_RADIUS;
    if (m.distSq(x, z, p.x, p.z) <= r * r) return true;
  }
  return false;
}

/** Only real players' kills count toward player-kill stats. */
export function countsAsPlayerKill(killer: { controller: "player" | "npc" } | undefined): boolean {
  return killer !== undefined && killer.controller === "player";
}

export interface FairPlayConfig {
  shieldMs: number;
  maxAttackers: number;
  lootCapPerHour: number;
}

export const DEFAULT_FAIRPLAY: FairPlayConfig = {
  shieldMs: NEW_PLAYER_SHIELD_MS,
  maxAttackers: MAX_ATTACKERS_PER_PLAYER,
  lootCapPerHour: LOOT_CAP_PER_HOUR,
};

export class FairPlay {
  /** First time the NPC system saw each player (sim ms). */
  private readonly firstSeen = new Map<string, number>();
  private readonly provoked = new Set<string>();
  /** playerId → NPC eids currently attacking it. */
  private readonly attackers = new Map<string, Set<number>>();
  /** npc eid → playerId it holds a slot on. */
  private readonly slotOf = new Map<number, string>();
  /** playerId → [simMs, amount] grants in the rolling window. */
  private readonly loot = new Map<string, { atMs: number; amount: number }[]>();

  constructor(readonly config: FairPlayConfig = DEFAULT_FAIRPLAY) {}

  /** Record a player's first appearance (no-op afterwards). `joinedMs` may be in the past. */
  seePlayer(playerId: string, nowMs: number): void {
    if (!this.firstSeen.has(playerId)) this.firstSeen.set(playerId, nowMs);
  }

  /** The player attacked an NPC: the new-player shield drops. */
  provoke(playerId: string): void {
    this.provoked.add(playerId);
  }

  isProvoked(playerId: string): boolean {
    return this.provoked.has(playerId);
  }

  shielded(playerId: string, nowMs: number): boolean {
    if (this.provoked.has(playerId)) return false;
    const t = this.firstSeen.get(playerId);
    if (t === undefined) return true; // never seen = brand new
    return nowMs - t < this.config.shieldMs;
  }

  /** May `npcEid` take (or keep) an attacker slot on `playerId`? */
  slotAvailable(npcEid: number, playerId: string): boolean {
    const set = this.attackers.get(playerId);
    if (!set || set.has(npcEid)) return true;
    return set.size < this.config.maxAttackers;
  }

  /** Claim a slot (releases any slot the NPC held on another player). False if full, unless
   *  `force` (F1 self-defence: an NPC the player just hit may always fight back, even as a 3rd). */
  claim(npcEid: number, playerId: string, force = false): boolean {
    const held = this.slotOf.get(npcEid);
    if (held === playerId) return true;
    if (!force && !this.slotAvailable(npcEid, playerId)) return false;
    this.release(npcEid);
    let set = this.attackers.get(playerId);
    if (!set) this.attackers.set(playerId, (set = new Set()));
    set.add(npcEid);
    this.slotOf.set(npcEid, playerId);
    return true;
  }

  release(npcEid: number): void {
    const held = this.slotOf.get(npcEid);
    if (held === undefined) return;
    this.slotOf.delete(npcEid);
    const set = this.attackers.get(held);
    if (set) {
      set.delete(npcEid);
      if (set.size === 0) this.attackers.delete(held);
    }
  }

  attackerCount(playerId: string): number {
    return this.attackers.get(playerId)?.size ?? 0;
  }

  /**
   * Can NPC `npcEid` engage player `playerId` right now? (Shield, attacker slots and safe zones;
   * hostility itself is factions.baseHostility's job.)
   */
  canEngagePlayer(
    npcEid: number,
    playerId: string,
    npcPos: { x: number; z: number },
    playerPos: { x: number; z: number },
    zones: readonly SafeZone[],
    m: NpcMetric,
    nowMs: number,
  ): boolean {
    if (this.shielded(playerId, nowMs)) return false;
    if (!this.slotAvailable(npcEid, playerId)) return false;
    if (inSafeZone(playerPos.x, playerPos.z, zones, m) || inSafeZone(npcPos.x, npcPos.z, zones, m)) return false;
    return true;
  }

  /** Grant up to `amount` NPC loot to a player under the hourly cap. Returns the amount allowed. */
  grantLoot(playerId: string, amount: number, nowMs: number): number {
    let list = this.loot.get(playerId);
    if (!list) this.loot.set(playerId, (list = []));
    while (list.length && nowMs - list[0].atMs >= LOOT_WINDOW_MS) list.shift();
    let used = 0;
    for (const g of list) used += g.amount;
    const allowed = Math.max(0, Math.min(amount, this.config.lootCapPerHour - used));
    if (allowed > 0) list.push({ atMs: nowMs, amount: allowed });
    return allowed;
  }

  /** Forget a player entirely (left the world). */
  forgetPlayer(playerId: string): void {
    const set = this.attackers.get(playerId);
    if (set) for (const eid of set) this.slotOf.delete(eid);
    this.attackers.delete(playerId);
  }
}
