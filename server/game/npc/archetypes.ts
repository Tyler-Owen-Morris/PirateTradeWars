/**
 * NPC archetypes (proposal §3 table): ship types, personality, combat knobs and loot.
 * Pure data + tiny helpers. Tune NPC behaviour here first.
 *
 * Ship mapping: the game has sloop / brigantine / galleon / man-o-war / dreadnaught. The proposal's
 * "frigate" maps to galleon, "brig" to brigantine.
 */
import { SHIP_TYPES } from "@shared/gameConstants";
import { FACTIONS, NATIONS, type FactionId } from "./factions";
import { DEFAULT_CANNON_RANGE } from "./tactics";

export type ArchetypeId = "merchant" | "navy" | "pirate" | "privateer" | "pirate_hunter";

export interface Archetype {
  id: ArchetypeId;
  /** Ship types to pick from (weighted equally). */
  ships: readonly string[];
  /** 0..1: how readily it attacks. */
  aggression: number;
  /** 0..1: how long it stays in a losing fight. */
  courage: number;
  /** Aim error, radians (± uniform). The difficulty knob. */
  aimError: number;
  /** Cannon/engagement range, units. */
  engageRange: number;
  /** Radius within which it notices ships (units). */
  senseRadius: number;
  /** Merchants strike their colours (drop cargo) at low hp instead of fighting to the death. */
  surrenders: boolean;
  /** Patrols (navy/pirates) wander their lanes; traders travel port to port. */
  patrols: boolean;
  /** Group size when spawned [min, max]. */
  group: readonly [number, number];
  /** Factions this archetype can belong to. */
  factions: readonly FactionId[];
  /** Gold carried (dropped on sink / surrender), [min, max]. */
  loot: readonly [number, number];
  /** Speed on rails as a fraction of max speed. */
  railSpeedFrac: number;
  /** Phase-1 stub: not spawned by the default director config. */
  stub?: boolean;
}

export const ARCHETYPES: Readonly<Record<ArchetypeId, Archetype>> = {
  merchant: {
    id: "merchant",
    ships: [SHIP_TYPES.SLOOP, SHIP_TYPES.BRIGANTINE],
    aggression: 0.05,
    courage: 0.2,
    aimError: 0.25,
    engageRange: DEFAULT_CANNON_RANGE * 0.8,
    senseRadius: 1500,
    surrenders: true,
    patrols: false,
    group: [1, 3],
    factions: [...NATIONS, "merchants_guild"],
    loot: [150, 500],
    railSpeedFrac: 0.7,
  },
  navy: {
    id: "navy",
    ships: [SHIP_TYPES.GALLEON, SHIP_TYPES.MAN_O_WAR],
    aggression: 0.6,
    courage: 0.9,
    aimError: 0.08,
    engageRange: DEFAULT_CANNON_RANGE,
    senseRadius: 1800,
    surrenders: false,
    patrols: true,
    group: [1, 2],
    factions: NATIONS,
    loot: [100, 300],
    railSpeedFrac: 0.6,
  },
  pirate: {
    id: "pirate",
    ships: [SHIP_TYPES.SLOOP, SHIP_TYPES.BRIGANTINE],
    aggression: 0.8,
    courage: 0.5,
    aimError: 0.15,
    engageRange: DEFAULT_CANNON_RANGE,
    senseRadius: 1800,
    surrenders: false,
    patrols: true,
    group: [1, 2],
    factions: ["pirates"],
    loot: [100, 400],
    railSpeedFrac: 0.7,
  },
  privateer: {
    id: "privateer",
    ships: [SHIP_TYPES.BRIGANTINE, SHIP_TYPES.GALLEON],
    aggression: 0.6,
    courage: 0.6,
    aimError: 0.12,
    engageRange: DEFAULT_CANNON_RANGE,
    senseRadius: 1800,
    surrenders: false,
    patrols: true,
    group: [1, 1],
    factions: NATIONS,
    loot: [150, 400],
    railSpeedFrac: 0.7,
  },
  // Stub (proposal "PirateHunter"): hunts players with bounties. Not spawned by default; NPC2 wires it.
  pirate_hunter: {
    id: "pirate_hunter",
    ships: [SHIP_TYPES.MAN_O_WAR],
    aggression: 0.9,
    courage: 0.95,
    aimError: 0.06,
    engageRange: DEFAULT_CANNON_RANGE,
    senseRadius: 2200,
    surrenders: false,
    patrols: true,
    group: [1, 1],
    factions: NATIONS,
    loot: [200, 500],
    railSpeedFrac: 0.8,
    stub: true,
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

/** Nameplate title, e.g. "Spanish Navy", "Dutch Merchant", "Pirate", "English Privateer". */
export function titleFor(arch: ArchetypeId, faction: FactionId): string {
  const adj = FACTIONS[faction].adjective;
  switch (arch) {
    case "merchant":
      return faction === "merchants_guild" ? "Guild Merchant" : `${adj} Merchant`;
    case "navy":
      return `${adj} Navy`;
    case "pirate":
      return "Pirate";
    case "privateer":
      return `${adj} Privateer`;
    case "pirate_hunter":
      return `${adj} Pirate Hunter`;
  }
}

const SHIP_NAMES = [
  "Adventure", "Revenge", "Fortune", "Swift", "Dolphin", "Mermaid", "Falcon", "Hope", "Endeavour",
  "Santa Maria", "Concord", "Pelican", "Raven", "Seahorse", "Speedwell", "Unicorn", "Griffin",
];

/** Pick deterministic ship type, faction and name for a new NPC of `arch`. */
export function rollNpc(arch: ArchetypeId, rng: () => number, faction?: FactionId) {
  const a = ARCHETYPES[arch];
  const shipType = a.ships[Math.floor(rng() * a.ships.length) % a.ships.length];
  const f = faction ?? a.factions[Math.floor(rng() * a.factions.length) % a.factions.length];
  const name = SHIP_NAMES[Math.floor(rng() * SHIP_NAMES.length) % SHIP_NAMES.length];
  const gold = Math.round(a.loot[0] + rng() * (a.loot[1] - a.loot[0]));
  return { shipType, faction: f, name, title: titleFor(arch, f), gold };
}
