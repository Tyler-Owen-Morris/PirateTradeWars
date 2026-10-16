/**
 * NPC2: the live NPC population on the real map. Pure data + builders, no World access.
 *
 * Inputs are the generated world data (WORLD_SPEC §5, §6):
 *   - shared/world/ports.json: 27 ports with `nation`, `region`, `dock`, `safeRadius`
 *   - shared/world/lanes.json: 75 lanes `{from, to, points}` (`from` is the smaller id; x unwrapped
 *     along the route, consumers wrap — NpcMetric.offset does)
 *
 * Every lane gets a *zone* from its two ports' regions (`laneZone`):
 *
 * | zone     | lanes                                                                     |
 * |----------|---------------------------------------------------------------------------|
 * | americas | both ends in the Caribbean/Gulf or the American Atlantic coast            |
 * | atlantic | one end in the Americas, the other in Europe/Africa (the crossings)       |
 * | europe   | both ends in Europe                                                       |
 * | africa   | touches West/South Africa, nothing further east                           |
 * | east     | touches the Indian Ocean, East Asia or the Pacific (Acapulco)             |
 *
 * `LIVE_FLEETS` turns that into ~300 persistent NPCs, heavy in the Caribbean/Gulf and on the
 * Europe–Caribbean crossings (see the population table in server/game/npc/README.md).
 */
import portsJson from "@shared/world/ports.json";
import lanesJson from "@shared/world/lanes.json";
import type { DirectorConfig, RegionTarget } from "./director";
import type { FactionId } from "./factions";
import type { SafeZone } from "./fairplay";
import type { Lane } from "./lod";

export interface PortDef {
  id: string;
  name: string;
  nation: string;
  region: string;
  dock: { x: number; z: number };
  spawn: { x: number; z: number };
  safeRadius: number;
}

export const PORTS: readonly PortDef[] = portsJson as unknown as PortDef[];
export const LANES: readonly Lane[] = lanesJson as unknown as Lane[];

const PORT_BY_ID = new Map(PORTS.map((p) => [p.id, p]));

export function portById(id: string): PortDef | undefined {
  return PORT_BY_ID.get(id);
}

/** Faction a merchant sailing out of port `id` flies: the port's nation. Ships out of the pirate
 *  havens (Nassau, Tortuga, Île Sainte-Marie) sail as the Merchants' Guild (neutral traders who
 *  deal with pirates), not as pirates. */
export function portFaction(id: string): FactionId | undefined {
  const n = PORT_BY_ID.get(id)?.nation;
  if (!n) return undefined;
  return n === "pirates" ? "merchants_guild" : (n as FactionId);
}

export type LaneZone = "americas" | "atlantic" | "europe" | "africa" | "east";

const AMERICAS = new Set(["caribbean", "north_atlantic"]);
const EUROPE_AFRICA = new Set(["europe", "africa"]);
const EAST = new Set(["indian_ocean", "east_asia", "americas_pacific"]);

/** Zone of a lane from its two ports' regions (table in the file header). */
export function laneZone(lane: Lane): LaneZone {
  const a = PORT_BY_ID.get(lane.from)?.region ?? "";
  const b = PORT_BY_ID.get(lane.to)?.region ?? "";
  if (EAST.has(a) || EAST.has(b)) return "east";
  if (AMERICAS.has(a) && AMERICAS.has(b)) return "americas";
  if ((AMERICAS.has(a) && EUROPE_AFRICA.has(b)) || (AMERICAS.has(b) && EUROPE_AFRICA.has(a))) return "atlantic";
  if (a === "africa" || b === "africa") return "africa";
  return "europe";
}

/** Pirate havens (WORLD_SPEC §5 nation "pirates"). */
export const PIRATE_PORTS: readonly string[] = PORTS.filter((p) => p.nation === "pirates").map((p) => p.id);

const touches = (lane: Lane, ids: readonly string[]) => ids.includes(lane.from) || ids.includes(lane.to);
const nationPorts = (nation: string, zones?: readonly string[]) =>
  PORTS.filter((p) => p.nation === nation && (!zones || zones.includes(p.region))).map((p) => p.id);

/** Lanes that start or end at one of `nation`'s ports (optionally only ports in `regions`) and lie
 *  in `zones`: a navy patrol stays on these, so it never leaves home waters. */
function homeWaters(nation: FactionId, zones: readonly LaneZone[], regions?: readonly string[]) {
  const ports = nationPorts(nation, regions);
  return (lane: Lane) => zones.includes(laneZone(lane)) && touches(lane, ports);
}

const inZones = (...zones: LaneZone[]) => (lane: Lane) => zones.includes(laneZone(lane));

/**
 * The live fleets: ~300 persistent NPCs. Region labels are unique per target (the director counts
 * per label + archetype). Tune counts here; the README has the same table.
 */
export function liveFleets(): RegionTarget[] {
  const CARIB = ["caribbean", "north_atlantic"];
  const EU = ["europe"];
  return [
    // Merchants (160): nation of the origin port; convoys of 1–3.
    { region: "americas/merchant", archetype: "merchant", count: 60, lanes: inZones("americas"), originFaction: true },
    { region: "atlantic/merchant", archetype: "merchant", count: 30, lanes: inZones("atlantic"), originFaction: true },
    { region: "europe/merchant", archetype: "merchant", count: 30, lanes: inZones("europe"), originFaction: true },
    { region: "africa/merchant", archetype: "merchant", count: 12, lanes: inZones("africa"), originFaction: true },
    { region: "east/merchant", archetype: "merchant", count: 28, lanes: inZones("east"), originFaction: true },
    // Navy patrols (55): near their own nation's ports.
    { region: "americas/navy/spain", archetype: "navy", count: 10, factions: ["spain"], lanes: homeWaters("spain", ["americas"], CARIB) },
    { region: "americas/navy/england", archetype: "navy", count: 8, factions: ["england"], lanes: homeWaters("england", ["americas"], CARIB) },
    { region: "americas/navy/france", archetype: "navy", count: 4, factions: ["france"], lanes: homeWaters("france", ["americas"], CARIB) },
    { region: "americas/navy/netherlands", archetype: "navy", count: 3, factions: ["netherlands"], lanes: homeWaters("netherlands", ["americas"], CARIB) },
    { region: "europe/navy/england", archetype: "navy", count: 5, factions: ["england"], lanes: homeWaters("england", ["europe"], EU) },
    { region: "europe/navy/spain", archetype: "navy", count: 4, factions: ["spain"], lanes: homeWaters("spain", ["europe"], EU) },
    { region: "europe/navy/france", archetype: "navy", count: 3, factions: ["france"], lanes: homeWaters("france", ["europe"], EU) },
    { region: "europe/navy/netherlands", archetype: "navy", count: 3, factions: ["netherlands"], lanes: homeWaters("netherlands", ["europe"], EU) },
    { region: "europe/navy/portugal", archetype: "navy", count: 3, factions: ["portugal"], lanes: homeWaters("portugal", ["europe"], EU) },
    { region: "east/navy/portugal", archetype: "navy", count: 4, factions: ["portugal"], lanes: homeWaters("portugal", ["east"]) },
    { region: "east/navy/netherlands", archetype: "navy", count: 4, factions: ["netherlands"], lanes: homeWaters("netherlands", ["east", "africa"]) },
    { region: "east/navy/spain", archetype: "navy", count: 4, factions: ["spain"], lanes: homeWaters("spain", ["east"]) },
    // Pirates (65): around the havens and on the busy crossings.
    { region: "americas/pirate/havens", archetype: "pirate", count: 35, lanes: (l) => laneZone(l) === "americas" && touches(l, PIRATE_PORTS) },
    { region: "americas/pirate/lanes", archetype: "pirate", count: 6, lanes: inZones("americas") },
    { region: "atlantic/pirate", archetype: "pirate", count: 12, lanes: inZones("atlantic") },
    { region: "east/pirate/sainte_marie", archetype: "pirate", count: 12, lanes: (l) => touches(l, ["sainte_marie"]) },
    // Privateers (20): letters of marque in the Caribbean, the Spanish guarda costa on the crossings.
    { region: "americas/privateer", archetype: "privateer", count: 16, factions: ["england", "france", "netherlands"], lanes: inZones("americas") },
    { region: "atlantic/privateer", archetype: "privateer", count: 4, factions: ["spain"], lanes: inZones("atlantic") },
  ];
}

/** Port safe zones (fair play: no fighting within `safeRadius` of a dock). */
export function portSafeZones(): SafeZone[] {
  return PORTS.map((p) => ({ x: p.dock.x, z: p.dock.z, safeRadius: p.safeRadius }));
}

/** Director config for the live world. */
export function liveDirector(over: Partial<DirectorConfig> = {}): Partial<DirectorConfig> {
  return { targets: liveFleets(), laneRegion: laneZone, portFaction, ...over };
}
