/**
 * Factions, the static relation matrix, player standing, and THE hostility plug point.
 *
 * `baseHostility(npc, other)` is the ONLY place that decides how much an NPC wants to fight
 * something. Everything else (threat proximity, target choice, call for help) goes through it, so
 * richer faction logic later (per-nation reputation, treaties, wars, bounties) changes this file
 * only. Phase 1 (WORLD_SPEC §8): a static matrix — lawful nations friendly-ish to each other and
 * to the merchants guild, everybody hostile to pirates, pirates hostile to everybody else.
 *
 * Reputation persistence (Redis, with the player) is NPC2's job. This file provides the data
 * model, pure update functions, and `emitRepChanges` which pushes `npcRepChange` effects onto
 * `world.effects` for the wiring layer to persist.
 */
import type { WorldEffect } from "../world";
import { clamp } from "./util";

export const FACTION_IDS = ["england", "spain", "france", "portugal", "netherlands", "pirates", "merchants_guild"] as const;
export type FactionId = (typeof FACTION_IDS)[number];

export function isFactionId(v: unknown): v is FactionId {
  return typeof v === "string" && (FACTION_IDS as readonly string[]).includes(v);
}

export interface Faction {
  id: FactionId;
  name: string;
  /** Adjective for titles ("Spanish Navy"). */
  adjective: string;
  lawful: boolean;
}

export const FACTIONS: Readonly<Record<FactionId, Faction>> = {
  england: { id: "england", name: "England", adjective: "English", lawful: true },
  spain: { id: "spain", name: "Spain", adjective: "Spanish", lawful: true },
  france: { id: "france", name: "France", adjective: "French", lawful: true },
  portugal: { id: "portugal", name: "Portugal", adjective: "Portuguese", lawful: true },
  netherlands: { id: "netherlands", name: "the Netherlands", adjective: "Dutch", lawful: true },
  pirates: { id: "pirates", name: "the Brethren", adjective: "Pirate", lawful: false },
  merchants_guild: { id: "merchants_guild", name: "the Merchants' Guild", adjective: "Guild", lawful: true },
};

export const NATIONS: readonly FactionId[] = ["england", "spain", "france", "portugal", "netherlands"];

/** Relation values, −100 (war) … 100 (allied). */
export const REL_SELF = 100;
export const REL_LAWFUL = 25;
export const REL_GUILD = 50;
export const REL_PIRATE = -100;

export type RelationMatrix = Readonly<Record<FactionId, Readonly<Record<FactionId, number>>>>;

function buildMatrix(): RelationMatrix {
  const m = {} as Record<FactionId, Record<FactionId, number>>;
  for (const a of FACTION_IDS) {
    m[a] = {} as Record<FactionId, number>;
    for (const b of FACTION_IDS) {
      let r: number;
      if (a === b) r = REL_SELF;
      else if (a === "pirates" || b === "pirates") r = REL_PIRATE;
      else if (a === "merchants_guild" || b === "merchants_guild") r = REL_GUILD;
      else r = REL_LAWFUL;
      m[a][b] = r;
    }
  }
  return m;
}

/** Phase 1 static relation matrix (symmetric). */
export const RELATIONS: RelationMatrix = buildMatrix();

export function relation(a: string, b: string, matrix: RelationMatrix = RELATIONS): number {
  if (!isFactionId(a) || !isFactionId(b)) return 0;
  return matrix[a][b];
}

/** Allies answer each other's calls for help. */
export const ALLY_THRESHOLD = 25;
export function areAllies(a: string, b: string, matrix: RelationMatrix = RELATIONS): boolean {
  return relation(a, b, matrix) >= ALLY_THRESHOLD;
}

// ---------------------------------------------------------------------------------------------
// Player standing
// ---------------------------------------------------------------------------------------------

/** Per-player standing. Persisted with the player by NPC2 (Redis); in memory here. */
export interface PlayerStanding {
  /** Reputation per faction, −100 … 100. Missing = DEFAULT_PLAYER_REP. */
  rep: Partial<Record<FactionId, number>>;
  /** 0 … 100: how infamous the player is with lawful nations (attacking lawful ships raises it). */
  notoriety: number;
  /** Gold on the player's head (navies hunt players with a bounty). */
  bounty: number;
}

/** A new player's reputation: pirates see every captain as prey, nations are neutral. */
export const DEFAULT_PLAYER_REP: Readonly<Record<FactionId, number>> = {
  england: 0,
  spain: 0,
  france: 0,
  portugal: 0,
  netherlands: 0,
  pirates: -60,
  merchants_guild: 10,
};

export function newStanding(): PlayerStanding {
  return { rep: {}, notoriety: 0, bounty: 0 };
}

export function repOf(s: PlayerStanding, f: FactionId): number {
  return s.rep[f] ?? DEFAULT_PLAYER_REP[f];
}

/** How a faction regards a player, −100 … 100. Lawful factions also count notoriety and bounty. */
export function playerRelation(f: FactionId, s: PlayerStanding): number {
  let r = repOf(s, f);
  if (FACTIONS[f].lawful && f !== "merchants_guild") {
    r -= s.notoriety * 0.5;
    if (s.bounty > 0) r -= 40;
  }
  return clamp(r, -100, 100);
}

// ---------------------------------------------------------------------------------------------
// THE plug point
// ---------------------------------------------------------------------------------------------

/** Who is asking. */
export interface HostilitySubject {
  faction: string;
}
/** Who is being looked at: another NPC (by faction) or a player (by standing). */
export type HostilityObject = { kind: "npc"; faction: string } | { kind: "player"; standing: PlayerStanding };

/**
 * How hostile `npc` is toward `other`, 0 (friendly/neutral) … 1 (attack on sight).
 * hostility = clamp(−relation / 100, 0, 1). The archetype's aggression is applied by the brain,
 * not here: this is purely "are we enemies".
 */
export function baseHostility(npc: HostilitySubject, other: HostilityObject, matrix: RelationMatrix = RELATIONS): number {
  if (!isFactionId(npc.faction)) return 0;
  const rel = other.kind === "npc" ? relation(npc.faction, other.faction, matrix) : playerRelation(npc.faction, other.standing);
  const h = -rel / 100;
  return h <= 0 ? 0 : h >= 1 ? 1 : h; // (never -0)
}

// ---------------------------------------------------------------------------------------------
// Reputation changes
// ---------------------------------------------------------------------------------------------

export interface RepChange {
  faction: FactionId;
  delta: number;
}

export const REP_ATTACK = -5;
export const REP_SINK = -20;
/** Enemies of the victim like it a bit (positive share of |delta|). */
export const REP_ENEMY_SHARE = 0.25;
/** Allies of the victim dislike it half as much. */
export const REP_ALLY_SHARE = 0.5;

/**
 * Reputation consequences of a player attacking (first hit) or sinking an NPC of `victim`.
 * "Spain likes you, so Portugal attacks you" emerges from this plus the matrix.
 */
export function repChangesFor(victim: string, act: "attack" | "sink", matrix: RelationMatrix = RELATIONS): RepChange[] {
  if (!isFactionId(victim)) return [];
  const base = act === "sink" ? REP_SINK : REP_ATTACK;
  const out: RepChange[] = [{ faction: victim, delta: base }];
  for (const f of FACTION_IDS) {
    if (f === victim) continue;
    const r = matrix[victim][f];
    if (r >= ALLY_THRESHOLD) out.push({ faction: f, delta: Math.round(base * REP_ALLY_SHARE) });
    else if (r <= -50) out.push({ faction: f, delta: Math.round(-base * REP_ENEMY_SHARE) });
  }
  return out;
}

/** Notoriety gained by attacking/sinking a lawful ship (0 for pirates). */
export function notorietyFor(victim: string, act: "attack" | "sink"): number {
  if (!isFactionId(victim) || !FACTIONS[victim].lawful) return 0;
  return act === "sink" ? 10 : 2;
}

/** Apply changes to a standing in place (rep clamped to ±100, notoriety to 0…100). */
export function applyRepChanges(s: PlayerStanding, changes: RepChange[], notoriety = 0): PlayerStanding {
  for (const c of changes) s.rep[c.faction] = clamp(repOf(s, c.faction) + c.delta, -100, 100);
  s.notoriety = clamp(s.notoriety + notoriety, 0, 100);
  return s;
}

// NPC2: notoriety decay.
/** Notoriety lost per minute (online, and for the time offline on reconnect). A lawful sink (+10)
 *  fades in 5 minutes. */
export const NOTORIETY_DECAY_PER_MIN = 2;

/** Decay notoriety by `minutes` in place. Returns true when the whole-number value changed (worth
 *  telling the client). */
export function decayNotoriety(s: { notoriety: number }, minutes: number): boolean {
  if (!(s.notoriety > 0) || !(minutes > 0)) return false;
  const before = Math.ceil(s.notoriety);
  s.notoriety = Math.max(0, s.notoriety - NOTORIETY_DECAY_PER_MIN * minutes);
  return Math.ceil(s.notoriety) !== before;
}

/** Push one `npcRepChange` effect per change (persisted by the wiring layer; NPC2). */
export function emitRepChanges(effects: WorldEffect[], playerId: string, changes: RepChange[], reason: string): void {
  for (const c of changes) effects.push({ type: "npcRepChange", playerId, faction: c.faction, delta: c.delta, reason });
}
