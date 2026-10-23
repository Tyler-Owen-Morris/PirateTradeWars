/**
 * Market rules shared by the server (trade execution, the goods API) and the client (the trade screen).
 *
 * - A port good's stored `currentPrice` is the port's SELLING price: what a player pays to buy.
 * - The port BUYS at `sellPriceOf(currentPrice)`, about 10% less (the spread), so a buy-and-sell round
 *   trip in one port always loses a little.
 * - `notSold` means the port does not sell that good but still buys it. The market model
 *   (shared/world/goodMarkets.ts) sets it on exotic goods away from their sources; the server stores it on
 *   the port row at seed time and re-syncs it on every market move.
 * - "Wanted" = the good's GOOD_MARKETS `wanted` list names this port (`isWanted`).
 */
import { isWanted, type MarketPort } from "./world/goodMarkets";

/** What the port pays, as a fraction of what it charges. */
export const SELL_SPREAD = 0.9;

/** The price the port pays a player for one unit, given its selling price. Never below 1. */
export function sellPriceOf(buyPrice: number): number {
  return Math.max(1, Math.round(buyPrice * SELL_SPREAD));
}

/** A port good as stored in Redis (`port:<id>:goods`). */
export interface MarketRow {
  goodId: number;
  /** The port's selling price (what the player pays). */
  currentPrice: number;
  stock: number;
  /** The port doesn't sell this good (it still buys it). */
  notSold?: boolean;
}

/** One line of the goods API (`GET /api/ports/:id/goods`) as the trade screen reads it. */
export interface PortGoodView {
  goodId: number;
  /** What the player pays per unit; null when the port doesn't sell it. */
  buyPrice: number | null;
  /** What the port pays per unit. */
  sellPrice: number;
  stock: number;
  /** Regional demand: the port pays well for it. */
  wanted: boolean;
  /** Legacy field (old clients): same as the selling price. */
  currentPrice: number;
}

export function portGoodView(row: MarketRow, port: MarketPort | null, goodName: string): PortGoodView {
  return {
    goodId: row.goodId,
    buyPrice: row.notSold ? null : row.currentPrice,
    sellPrice: sellPriceOf(row.currentPrice),
    stock: row.notSold ? 0 : row.stock,
    wanted: port ? isWanted(port, goodName) : false,
    currentPrice: row.currentPrice,
  };
}
