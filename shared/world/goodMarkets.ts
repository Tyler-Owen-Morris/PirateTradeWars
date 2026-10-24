/**
 * The market model (New Horizons phase 1, 2026-10-23). Replaces the flat regional factors (0.7× cheap /
 * 1.35× dear, the old `REGION_MARKETS`) with data per good:
 *
 *   price(port, good) = basePrice × distanceFactor(d) × (wanted ? WANTED_FACTOR : 1) × (1 ± fluctuation%)
 *
 * - `d` is the SEA-LANE distance (shared/world/lanes.json, metric units along each lane, shortest path over
 *   the lane graph) from the port to the good's nearest SOURCE port. The lane graph has no Panama canal,
 *   so Panamá to Portobelo is a voyage round Cape Horn, as it was.
 * - `distanceFactor` rises linearly from SOURCE_FACTOR (0.6) at a source to FAR_FACTOR (2.0) at
 *   FAR_DISTANCE (200 000 units, half the world) and stays there beyond.
 * - "Wanted at" ports multiply by WANTED_FACTOR (1.3) on top, hold less stock, and the trade screen marks
 *   them ("pays well").
 * - EXOTIC goods (Spices, Silk, the phase 1 goods and the phase 2 Northern goods) are only stocked for sale within EXOTIC_SOLD_WITHIN
 *   lane units of a source: elsewhere the port row is `notSold` (stock 0), though every port still BUYS
 *   every good. Staples (Fish, Wood, Sugar, Cotton, Rum, Tobacco) are on sale everywhere.
 * - Pirate havens are Rum sources (`nation:pirates`), so they keep their cheap Rum.
 * - The ~10% buy/sell spread is applied on top by shared/market.ts (`sellPriceOf`).
 *
 * Selectors in `sources` / `wanted`: a port key ("callao"), a region id ("caribbean"), or "nation:<id>".
 * Tune the table here; `scripts/price-sim.ts` prints the best routes and the test asserts no route dominates.
 *
 * Pure (shared): imports only ports.json/lanes.json and shared helpers. The lane graph is built lazily on
 * first use, so a bundle that never prices anything (the client) does not pay for it.
 */
import lanesJson from "./lanes.json";
import { PORTS, type GamePort } from "./ports";
import { metricDist } from "./geo";

export interface GoodMarket {
  /** Where the good is produced: cheap and plentiful there. */
  sources: readonly string[];
  /** Where it is in demand: the port pays well (×WANTED_FACTOR) and holds little. */
  wanted: readonly string[];
  /** Only on sale near its sources (everyone still buys it). */
  exotic?: boolean;
}

/** Per good (by name, matching GOODS in shared/gameConstants.ts). */
export const GOOD_MARKETS: Readonly<Record<string, GoodMarket>> = Object.freeze({
  // Staples: on sale everywhere, cheap near their sources.
  // Phase 2: the arctic ports (Bergen stockfish, Iceland) are Fish sources; the Baltic is a Wood source and pays
  // well for sugar, rum and wine (Copenhagen); Guam wants silver.
  Fish: { sources: ["north_atlantic", "africa", "americas_pacific", "arctic"], wanted: ["caribbean", "lisbon", "porto"] }, // salt cod
  Wood: { sources: ["north_atlantic", "europe", "baltic"], wanted: ["caribbean", "africa", "indian_ocean", "americas_pacific", "south_atlantic"] },
  Sugar: { sources: ["caribbean", "south_atlantic"], wanted: ["north_atlantic", "europe", "east_asia", "baltic"] },
  Cotton: { sources: ["indian_ocean", "africa", "europe"], wanted: ["south_atlantic", "americas_pacific"] },
  Rum: { sources: ["caribbean", "nation:pirates"], wanted: ["north_atlantic", "africa", "indian_ocean", "americas_pacific", "baltic"] },
  Tobacco: { sources: ["caribbean", "salvador", "recife"], wanted: ["europe", "east_asia", "africa"] },
  // Exotics: only stocked near their sources.
  Spices: { sources: ["indian_ocean", "east_asia"], wanted: ["europe"], exotic: true },
  Silk: { sources: ["east_asia", "acapulco"], wanted: ["europe", "caribbean"], exotic: true }, // Acapulco: the Manila galleon
  Silver: { sources: ["callao", "portobelo", "panama", "buenos_aires", "acapulco"], wanted: ["manila", "macau", "goa", "batavia", "guam"], exotic: true },
  Gold: { sources: ["rio_de_janeiro", "elmina"], wanted: ["lisbon", "london", "goa"], exotic: true },
  Cacao: { sources: ["la_guaira", "guayaquil", "paramaribo"], wanted: ["cadiz", "seville", "amsterdam", "veracruz"], exotic: true },
  Hides: { sources: ["buenos_aires", "montevideo", "valparaiso"], wanted: ["london", "amsterdam", "cadiz", "boston"], exotic: true },
  Wine: { sources: ["porto", "funchal", "valparaiso", "cape_town"], wanted: ["london", "amsterdam", "boston", "caribbean", "baltic"], exotic: true },
  // New Horizons phase 2 (2026-10-24): the Northern group.
  Furs: {
    sources: ["quebec", "york_factory", "okhotsk", "petropavlovsk", "sitka", "arkhangelsk"],
    wanted: ["london", "amsterdam", "macau", "manila"], // the European fur markets and Canton (via Macau)
    exotic: true,
  },
  "Whale Oil": { sources: ["bergen", "reykjavik", "godthab", "st_johns"], wanted: ["london", "amsterdam", "saint_malo", "lisbon"], exotic: true }, // lamp oil
  "Naval Stores": {
    sources: ["riga", "st_petersburg", "stockholm", "arkhangelsk"],
    wanted: ["london", "bristol", "amsterdam", "cadiz", "lisbon", "havana", "port_royal"], // the navy yards
    exotic: true,
  },
});

export const SOURCE_FACTOR = 0.6;
export const FAR_FACTOR = 2.0;
/** Lane distance at which the distance premium tops out (half the circumference). */
export const FAR_DISTANCE = 200_000;
/** Shape of the distance premium (1 = linear; < 1 rises faster near the source). */
export const DISTANCE_CURVE = 0.6;
export const WANTED_FACTOR = 1.3;
/** An exotic good is on sale at a port within this lane distance of a source (the source and its roadsteads). */
export const EXOTIC_SOLD_WITHIN = 3_000;
/** Ports at or below this distance factor count as "local" (more stock). */
const LOCAL_FACTOR = 0.7;

/** The port fields the model reads (a GamePort, a Redis port record, or a test stub). */
export interface MarketPort {
  key?: string;
  region?: string;
  nation?: string;
  dock?: { x: number; z: number };
  x?: number;
  z?: number;
}

interface LaneLike {
  from: string;
  to: string;
  points: [number, number][];
}

// ---------------------------------------------------------------------------------------------
// Lane graph and distance to the nearest source (multi-source Dijkstra, cached per good)
// ---------------------------------------------------------------------------------------------

let graph: Map<string, { to: string; d: number }[]> | null = null;

function laneGraph(): Map<string, { to: string; d: number }[]> {
  if (graph) return graph;
  const g = new Map<string, { to: string; d: number }[]>();
  for (const p of PORTS) g.set(p.key, []);
  for (const lane of lanesJson as unknown as LaneLike[]) {
    let d = 0;
    for (let i = 1; i < lane.points.length; i++) {
      const [ax, az] = lane.points[i - 1];
      const [bx, bz] = lane.points[i];
      d += metricDist(ax, az, bx, bz);
    }
    for (const [a, b] of [[lane.from, lane.to], [lane.to, lane.from]]) {
      const edges = g.get(a) ?? [];
      const prev = edges.find((e) => e.to === b);
      if (!prev) edges.push({ to: b, d });
      else prev.d = Math.min(prev.d, d);
      g.set(a, edges);
    }
  }
  return (graph = g);
}

function matches(sel: string, p: { key?: string; region?: string; nation?: string }): boolean {
  if (sel.startsWith("nation:")) return p.nation === sel.slice(7);
  return sel === p.key || sel === p.region;
}

/** The ports a list of selectors names. */
export function portsMatching(selectors: readonly string[], ports: readonly GamePort[] = PORTS): GamePort[] {
  return ports.filter((p) => selectors.some((s) => matches(s, p)));
}

const distCache = new Map<string, Map<string, number>>();

/** Lane distance from every port to the nearest of `sourceKeys` (Infinity if unreachable). */
function distancesFrom(cacheKey: string, sourceKeys: readonly string[]): Map<string, number> {
  const hit = distCache.get(cacheKey);
  if (hit) return hit;
  const g = laneGraph();
  const dist = new Map<string, number>();
  for (const k of g.keys()) dist.set(k, Infinity);
  for (const k of sourceKeys) dist.set(k, 0);
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; u = k; }
    if (u === null) break;
    done.add(u);
    for (const e of g.get(u) ?? []) {
      const nd = best + e.d;
      if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd);
    }
  }
  distCache.set(cacheKey, dist);
  return dist;
}

/** Shortest sea-lane distance between two ports (by key); Infinity if either is unknown or unreachable. */
export function laneDistance(fromKey: string, toKey: string): number {
  if (fromKey === toKey) return 0;
  return distancesFrom(`port:${fromKey}`, [fromKey]).get(toKey) ?? Infinity;
}

/** Sea-lane distance from `port` to the nearest source of `goodName`; null for a good with no market data. */
export function sourceDistance(port: MarketPort, goodName: string): number | null {
  const m = GOOD_MARKETS[goodName];
  if (!m) return null;
  const sources = portsMatching(m.sources);
  if (port.key && sources.some((s) => s.key === port.key)) return 0;
  const known = port.key ? distancesFrom(goodName, sources.map((s) => s.key)).get(port.key) : undefined;
  if (known !== undefined) return known;
  // A port outside the generated graph (a legacy record, a test stub): matching selectors still count as a
  // source; otherwise straight-line metric distance to the nearest source dock, plus 30% for the coast.
  if (m.sources.some((s) => matches(s, port))) return 0;
  const at = port.dock ?? (port.x !== undefined && port.z !== undefined ? { x: port.x, z: port.z } : null);
  if (!at) return FAR_DISTANCE / 2;
  let best = Infinity;
  for (const s of sources) best = Math.min(best, metricDist(at.x, at.z, s.dock.x, s.dock.z) * 1.3);
  return Number.isFinite(best) ? best : FAR_DISTANCE / 2;
}

/** 0.6 at a source, rising to 2.0 at FAR_DISTANCE and beyond, along (d / FAR)^DISTANCE_CURVE: concave, so
 *  a short regional hop (Caribbean rum to Charleston, ~12k) is already worth making. */
export function distanceFactor(d: number): number {
  const t = Math.min(1, Math.max(0, d) / FAR_DISTANCE);
  return SOURCE_FACTOR + (FAR_FACTOR - SOURCE_FACTOR) * Math.pow(t, DISTANCE_CURVE);
}

/** Everything the model says about one good at one port. */
export interface GoodMarketAt {
  /** Lane distance to the nearest source (0 at a source); null when the good has no market data. */
  distance: number | null;
  source: boolean;
  wanted: boolean;
  /** The port stocks it for sale (false = `notSold`; it still buys it). */
  sold: boolean;
  /** Deterministic price factor: distanceFactor × (wanted ? WANTED_FACTOR : 1). */
  factor: number;
}

export function goodMarketAt(port: MarketPort, goodName: string): GoodMarketAt {
  const m = GOOD_MARKETS[goodName];
  if (!m) return { distance: null, source: false, wanted: false, sold: true, factor: 1 };
  const distance = sourceDistance(port, goodName) ?? 0;
  const source = distance === 0;
  const wanted = !source && m.wanted.some((s) => matches(s, port));
  const sold = !m.exotic || distance <= EXOTIC_SOLD_WITHIN;
  return { distance, source, wanted, sold, factor: distanceFactor(distance) * (wanted ? WANTED_FACTOR : 1) };
}

/** Deterministic price factor for `goodName` at this port (no fluctuation). */
export function goodPriceFactor(port: MarketPort, goodName: string): number {
  return goodMarketAt(port, goodName).factor;
}

/** The port pays well for it (the trade screen's "wanted"). */
export function isWanted(port: MarketPort, goodName: string): boolean {
  return goodMarketAt(port, goodName).wanted;
}

/** The port stocks it for sale (otherwise the row is `notSold`). */
export function isSoldAt(port: MarketPort, goodName: string): boolean {
  return goodMarketAt(port, goodName).sold;
}

/** A fresh price: base × model factor × random fluctuation (±fluctuation%). At least 1. */
export function portGoodPrice(
  port: MarketPort,
  good: { name: string; basePrice: number; fluctuation: number },
  rng: () => number = Math.random,
): number {
  const fluct = ((rng() * 2 - 1) * good.fluctuation) / 100;
  return Math.max(1, Math.round(good.basePrice * goodPriceFactor(port, good.name) * (1 + fluct)));
}

/** A fresh stock level: 0 where the good is not sold; 50–99 normally (20–49 on `restock`), +60 (+30) near a
 *  source, halved (at least 5) where it is wanted. */
export function portGoodStock(port: MarketPort, goodName: string, rng: () => number = Math.random, restock = false): number {
  const m = goodMarketAt(port, goodName);
  if (!m.sold) return 0;
  const base = restock ? Math.floor(rng() * 30) + 20 : Math.floor(rng() * 50) + 50;
  if (m.wanted) return Math.max(5, Math.floor(base / 2));
  if (distanceFactor(m.distance ?? FAR_DISTANCE) <= LOCAL_FACTOR) return base + (restock ? 30 : 60);
  return base;
}
