/**
 * Price simulator for the market model (shared/world/goodMarkets.ts). Pure; used by `npm run market:sim`
 * (scripts/market/run-price-sim.ts) and by the test that guards against a dominating route.
 *
 * A "route" is: buy one unit of a good at port A (where it is on sale), sail the shortest sea lanes to
 * port B, sell it there. Prices are the model's expected prices (zero fluctuation):
 *   buy  = round(basePrice × factor(A))            (what A charges)
 *   sell = sellPriceOf(round(basePrice × factor(B))) (what B pays: the ~10% spread)
 * `perLeague` is the profit per unit per 10 000 lane units sailed (about half a minute at average speed),
 * a rough "gold per hour" ranking; `profit` is per cargo unit.
 */
import { GOODS } from "@shared/gameConstants";
import { PORTS } from "@shared/world/ports";
import { goodMarketAt, laneDistance } from "@shared/world/goodMarkets";
import { sellPriceOf } from "@shared/market";

export interface Route {
  good: string;
  from: string;
  to: string;
  buy: number;
  sell: number;
  profit: number;
  /** Shortest sea-lane distance A -> B (units). */
  distance: number;
  /** Profit per unit per 10 000 lane units. */
  perLeague: number;
}

export function allRoutes(): Route[] {
  const out: Route[] = [];
  for (const g of GOODS) {
    const at = PORTS.map((p) => ({ p, m: goodMarketAt(p, g.name), price: 0 }));
    for (const a of at) a.price = Math.max(1, Math.round(g.basePrice * a.m.factor));
    for (const a of at) {
      if (!a.m.sold) continue;
      for (const b of at) {
        if (a === b) continue;
        const sell = sellPriceOf(b.price);
        const profit = sell - a.price;
        if (profit <= 0) continue;
        const distance = laneDistance(a.p.key, b.p.key);
        if (!Number.isFinite(distance)) continue;
        out.push({ good: g.name, from: a.p.key, to: b.p.key, buy: a.price, sell, profit, distance, perLeague: (profit * 10_000) / Math.max(distance, 2_000) });
      }
    }
  }
  return out;
}

/** The best `n` routes by profit per unit, one per good+destination pair is NOT enforced (the raw list). */
export function topRoutes(n = 10, by: "profit" | "perLeague" = "profit"): Route[] {
  return allRoutes()
    .sort((x, y) => y[by] - x[by] || x.distance - y.distance)
    .slice(0, n);
}

/** Best route per good (by profit per unit). */
export function bestPerGood(): Route[] {
  const best = new Map<string, Route>();
  for (const r of allRoutes()) {
    const b = best.get(r.good);
    if (!b || r.profit > b.profit) best.set(r.good, r);
  }
  return [...best.values()].sort((x, y) => y.profit - x.profit);
}

export function formatRoute(r: Route): string {
  const d = `${Math.round(r.distance / 1000)}k`;
  return `${r.good.padEnd(8)} ${r.from.padEnd(15)} -> ${r.to.padEnd(15)} buy ${String(r.buy).padStart(4)}  sell ${String(r.sell).padStart(4)}  +${String(r.profit).padStart(4)}/unit  ${d.padStart(5)} lanes  ${r.perLeague.toFixed(1).padStart(6)}/unit/10k`;
}
