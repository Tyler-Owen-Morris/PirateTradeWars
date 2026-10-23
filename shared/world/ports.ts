/**
 * Game ports (card W4, WORLD_SPEC §5). One typed view of the generated `ports.json` (card W2) shared
 * by the server (Redis seed, dock-radius checks, spawns) and the client (towns, docking prompt,
 * offline fallback for `GET /api/ports`).
 *
 * - `id` is a small integer (1-based index in ports.json): the wire protocol, Redis keys
 *   (`port:<id>:goods`) and the client all use numeric port ids. `key` is the generated string id
 *   (e.g. "port_royal"). Ids are only stable for one `PORTS_VERSION`; the server re-seeds ports and
 *   their goods whenever the version changes (server/game/ports.ts).
 * - `x`/`z` is the TOWN (on land, for rendering). Gameplay uses `dock` (in water): trade, upgrade
 *   and repair need a metric distance to the dock ≤ PORT_INTERACTION_RADIUS. `spawn` is deeper water
 *   (land distance > 150) for new players and migrated records.
 *
 * Pure: imports only shared modules (relative), no Node or DOM APIs.
 */
import rawPorts from "./ports.json";
import versions from "./versions.json";
import { metricDistSq } from "./geo";
import { PORT_INTERACTION_RADIUS } from "../gameConstants";

export type PortNation = "england" | "spain" | "france" | "portugal" | "netherlands" | "pirates";
export type PortRegion =
  | "caribbean"
  | "north_atlantic"
  | "europe"
  | "africa"
  | "indian_ocean"
  | "east_asia"
  | "americas_pacific"
  | "south_atlantic";

export interface GamePort {
  /** Numeric id used on the wire and in Redis (1-based index in ports.json). */
  id: number;
  /** Generated string id from ports.json, e.g. "port_royal". */
  key: string;
  name: string;
  nation: PortNation;
  region: PortRegion;
  lat: number;
  lon: number;
  /** Town position (on land near the coast). */
  x: number;
  /** Always 0 (kept for the legacy Port shape). */
  y: number;
  z: number;
  /** Harbour point in water: interaction is measured from here. */
  dock: { x: number; z: number };
  /** Deep-water spawn point (land distance > 150). */
  spawn: { x: number; z: number };
  /** Generated safe radius around the dock (600). No gameplay effect today (see SERVER_CONTEXT). */
  safeRadius: number;
}

/** Content hash of ports.json (shared/world/versions.json); Redis re-seeds ports when it changes. */
export const PORTS_VERSION: string = versions.ports;

/** Every port, in ports.json order. */
export const PORTS: readonly GamePort[] = Object.freeze(
  (rawPorts as Array<Omit<GamePort, "id" | "key" | "y"> & { id: string }>).map((p, i) =>
    Object.freeze({
      id: i + 1,
      key: p.id,
      name: p.name,
      nation: p.nation as PortNation,
      region: p.region as PortRegion,
      lat: p.lat,
      lon: p.lon,
      x: p.x,
      y: 0,
      z: p.z,
      dock: Object.freeze({ x: p.dock.x, z: p.dock.z }),
      spawn: Object.freeze({ x: p.spawn.x, z: p.spawn.z }),
      safeRadius: p.safeRadius,
    }),
  ),
);

/** New players (and migrated records) start at one of these Caribbean ports, chosen at random. */
export const STARTER_PORT_KEYS: readonly string[] = Object.freeze(["port_royal", "nassau", "tortuga", "havana", "bridgetown"]);

export const STARTER_PORTS: readonly GamePort[] = Object.freeze(
  STARTER_PORT_KEYS.map((k) => {
    const p = PORTS.find((q) => q.key === k);
    if (!p) throw new Error(`starter port ${k} missing from ports.json`);
    return p;
  }),
);

export function portById(id: number, ports: readonly GamePort[] = PORTS): GamePort | undefined {
  return ports.find((p) => p.id === id);
}

export function portByKey(key: string, ports: readonly GamePort[] = PORTS): GamePort | undefined {
  return ports.find((p) => p.key === key);
}

/** Minimal shape for dock checks (a GamePort, or a Redis/API port record). */
export interface DockedPortLike {
  dock: { x: number; z: number };
}

/** Squared metric distance from (x, z) to the port's dock. */
export function dockDistSq(x: number, z: number, port: DockedPortLike): number {
  return metricDistSq(x, z, port.dock.x, port.dock.z);
}

/** Metric distance from (x, z) to the port's dock. */
export function dockDistance(x: number, z: number, port: DockedPortLike): number {
  return Math.sqrt(dockDistSq(x, z, port));
}

/** True if (x, z) is within `radius` (default PORT_INTERACTION_RADIUS = 300, metric) of the dock. */
export function withinDock(x: number, z: number, port: DockedPortLike, radius: number = PORT_INTERACTION_RADIUS): boolean {
  return dockDistSq(x, z, port) <= radius * radius;
}

/** The port whose dock is nearest to (x, z), with its metric distance; null for an empty list. */
export function nearestDockPort<P extends DockedPortLike>(x: number, z: number, ports: readonly P[]): { port: P; distance: number } | null {
  let best: P | null = null;
  let bestSq = Infinity;
  for (const p of ports) {
    const d = dockDistSq(x, z, p);
    if (d < bestSq) {
      bestSq = d;
      best = p;
    }
  }
  return best ? { port: best, distance: Math.sqrt(bestSq) } : null;
}

// ---------------------------------------------------------------------------------------------
// Market profiles: regional specialities (cheap, plentiful) and demand (dear, scarce).
// ---------------------------------------------------------------------------------------------

export interface MarketProfile {
  /** Good names produced locally: lower price, more stock. */
  cheap: readonly string[];
  /** Good names in demand locally: higher price, less stock. */
  dear: readonly string[];
}

export const REGION_MARKETS: Readonly<Record<PortRegion, MarketProfile>> = Object.freeze({
  caribbean: { cheap: ["Sugar", "Rum", "Tobacco"], dear: ["Wood", "Silk"] },
  north_atlantic: { cheap: ["Fish", "Wood"], dear: ["Sugar", "Rum"] },
  europe: { cheap: ["Wood", "Cotton"], dear: ["Sugar", "Spices", "Tobacco"] },
  africa: { cheap: ["Cotton", "Fish"], dear: ["Rum", "Wood"] },
  indian_ocean: { cheap: ["Spices", "Cotton"], dear: ["Wood", "Rum"] },
  east_asia: { cheap: ["Silk", "Spices"], dear: ["Sugar", "Tobacco"] },
  americas_pacific: { cheap: ["Silk", "Fish"], dear: ["Wood", "Rum"] },
  south_atlantic: { cheap: ["Sugar", "Tobacco"], dear: ["Wood", "Cotton"] },
});

export const CHEAP_PRICE_FACTOR = 0.7;
export const DEAR_PRICE_FACTOR = 1.35;

/** The market profile of a port: its region's, plus cheap Rum at pirate havens. */
export function marketProfile(port: { region?: string; nation?: string }): MarketProfile {
  const base = REGION_MARKETS[port.region as PortRegion] ?? { cheap: [], dear: [] };
  if (port.nation !== "pirates" || base.cheap.includes("Rum")) return base;
  return { cheap: [...base.cheap, "Rum"], dear: base.dear.filter((g) => g !== "Rum") };
}

/** Price factor for `goodName` at this port: CHEAP_PRICE_FACTOR, DEAR_PRICE_FACTOR or 1. */
export function goodPriceFactor(port: { region?: string; nation?: string }, goodName: string): number {
  const m = marketProfile(port);
  if (m.cheap.includes(goodName)) return CHEAP_PRICE_FACTOR;
  if (m.dear.includes(goodName)) return DEAR_PRICE_FACTOR;
  return 1;
}

/** A fresh price: base × regional factor × random fluctuation (±fluctuation%). At least 1. */
export function portGoodPrice(
  port: { region?: string; nation?: string },
  good: { name: string; basePrice: number; fluctuation: number },
  rng: () => number = Math.random,
): number {
  const fluct = ((rng() * 2 - 1) * good.fluctuation) / 100;
  return Math.max(1, Math.round(good.basePrice * goodPriceFactor(port, good.name) * (1 + fluct)));
}

/** A fresh stock level: 50–99 normally, more for local specialities, less for goods in demand.
 *  `restock` gives the smaller replenish amount used when stock runs low (20–49 normally). */
export function portGoodStock(port: { region?: string; nation?: string }, goodName: string, rng: () => number = Math.random, restock = false): number {
  const base = restock ? Math.floor(rng() * 30) + 20 : Math.floor(rng() * 50) + 50;
  const f = goodPriceFactor(port, goodName);
  if (f < 1) return base + (restock ? 30 : 60);
  if (f > 1) return Math.max(5, Math.floor(base / 2));
  return base;
}
