/**
 * Trade rules (pure) and the per-key serial queue that fixes the trade race.
 *
 * Why: the old `handleTrade` read the inventory, awaited Redis, then wrote an ABSOLUTE quantity, so two
 * trades from one player in flight at once both saw the old inventory: two sells paid twice, two buys
 * charged twice and delivered once. Now every port action of a player runs through `portActions`
 * (a KeyedQueue keyed by player id, and inside it by port id for the port's stock), and the decision is
 * a pure function of loaded data (`applyTrade` / `applySellAll`), unit-tested in __tests__/trade.test.ts.
 *
 * Rules (docs/netcode/PROTOCOL.md "Trading (2026-10-23)"):
 * - The stored `currentPrice` is what the port charges; it pays `sellPriceOf(currentPrice)` (~10% less).
 * - Buying takes stock from the port; selling adds to it.
 * - `expectedPrice` refuses only a move AGAINST the player (buy up / sell down); a better price is used.
 * - `avgPaid` per inventory row = weighted average buy price. Rows bought before avgPaid existed count
 *   their old units at the new price (an approximation; there is no history to do better).
 * - Cargo used = the sum of inventory quantities (the same rule redisStorage uses).
 */
import type { InventoryRow, TradeCode } from "@shared/protocol";
import { sellPriceOf, type MarketRow } from "@shared/market";

export interface TraderState {
  gold: number;
  cargoCapacity: number;
  inventory: InventoryRow[];
}
export interface TradeRequest {
  action: "buy" | "sell";
  goodId: number;
  quantity: number;
  expectedPrice?: number;
}
export interface Refusal {
  ok: false;
  code: TradeCode;
  message: string;
}
export interface TradeOk {
  ok: true;
  price: number;
  total: number;
  gold: number;
  cargoUsed: number;
  inventory: InventoryRow[];
  /** The port's goods after the trade (a new array; stock changed on one row). */
  market: MarketRow[];
}
export interface SellAllOk {
  ok: true;
  total: number;
  lines: { goodId: number; quantity: number; price: number }[];
  gold: number;
  cargoUsed: number;
  inventory: InventoryRow[];
  market: MarketRow[];
}

export const cargoOf = (inv: readonly InventoryRow[]): number => inv.reduce((a, r) => a + (r.quantity > 0 ? r.quantity : 0), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const refuse = (code: TradeCode, message: string): Refusal => ({ ok: false, code, message });

/** Decide and compute one buy or sell. Inputs are not mutated. */
export function applyTrade(st: TraderState, market: readonly MarketRow[], req: TradeRequest, goodName = "that good"): TradeOk | Refusal {
  const row = market.find((m) => m.goodId === req.goodId);
  if (!row) return refuse("not_traded", `${goodName} is not traded at this port.`);
  const q = req.quantity;
  const inv = st.inventory.filter((r) => r.quantity > 0).map((r) => ({ ...r }));
  const item = inv.find((r) => r.goodId === req.goodId);
  const held = item ? item.quantity : 0;
  const used = cargoOf(inv);

  if (req.action === "buy") {
    if (row.notSold) return refuse("not_sold", `${goodName} is not sold here.`);
    const price = row.currentPrice;
    if (req.expectedPrice !== undefined && price > req.expectedPrice)
      return refuse("price_changed", `The price of ${goodName} rose from ${req.expectedPrice} to ${price} g. Nothing was traded.`);
    if (row.stock < q) return refuse("no_stock", row.stock > 0 ? `The port has only ${row.stock} ${goodName} left.` : `Sold out: the port has no ${goodName}.`);
    const total = price * q;
    if (st.gold < total) return refuse("no_gold", `Your purse is short: ${q} ${goodName} cost ${total} g and you have ${st.gold} g.`);
    if (used + q > st.cargoCapacity) return refuse("no_space", `Your hold has room for ${Math.max(0, st.cargoCapacity - used)} more.`);
    const avg = round2(((item?.avgPaid ?? price) * held + price * q) / (held + q));
    if (item) { item.quantity = held + q; item.avgPaid = avg; } else inv.push({ goodId: req.goodId, quantity: q, avgPaid: avg });
    return {
      ok: true, price, total, gold: st.gold - total, cargoUsed: used + q, inventory: inv,
      market: market.map((m) => (m === row ? { ...m, stock: m.stock - q } : m)),
    };
  }

  const price = sellPriceOf(row.currentPrice);
  if (req.expectedPrice !== undefined && price < req.expectedPrice)
    return refuse("price_changed", `The price of ${goodName} fell from ${req.expectedPrice} to ${price} g. Nothing was traded.`);
  if (held < q) return refuse("not_owned", held ? `You carry only ${held} ${goodName}.` : `You carry no ${goodName}.`);
  const total = price * q;
  const out = held === q ? inv.filter((r) => r !== item) : inv.map((r) => (r === item ? { ...r, quantity: held - q } : r));
  return {
    ok: true, price, total, gold: st.gold + total, cargoUsed: used - q, inventory: out,
    market: market.map((m) => (m === row ? { ...m, stock: m.stock + q } : m)),
  };
}

/** Sell everything aboard, all or nothing. `lines` (optional) must match the hold exactly. */
export function applySellAll(
  st: TraderState,
  market: readonly MarketRow[],
  lines: readonly { goodId: number; quantity: number; expectedPrice?: number }[] | undefined,
  nameOf: (goodId: number) => string = () => "that good",
): SellAllOk | Refusal {
  const inv = st.inventory.filter((r) => r.quantity > 0);
  if (!inv.length) return refuse("empty_hold", "Your hold is empty.");
  if (lines) {
    const same = lines.length === inv.length && inv.every((r) => lines.some((l) => l.goodId === r.goodId && l.quantity === r.quantity));
    if (!same) return refuse("hold_changed", "Your hold changed since you looked. Check the bill and sign again.");
  }
  const sold: SellAllOk["lines"] = [];
  let total = 0;
  const next = market.map((m) => ({ ...m }));
  for (const r of inv) {
    const row = next.find((m) => m.goodId === r.goodId);
    if (!row) return refuse("not_traded", `${nameOf(r.goodId)} is not traded at this port. Nothing was sold.`);
    const price = sellPriceOf(row.currentPrice);
    const exp = lines?.find((l) => l.goodId === r.goodId)?.expectedPrice;
    if (exp !== undefined && price < exp)
      return refuse("price_changed", `The price of ${nameOf(r.goodId)} fell from ${exp} to ${price} g. Nothing was sold.`);
    row.stock += r.quantity;
    total += price * r.quantity;
    sold.push({ goodId: r.goodId, quantity: r.quantity, price });
  }
  return { ok: true, total, lines: sold, gold: st.gold + total, cargoUsed: 0, inventory: [], market: next };
}

/**
 * Runs async jobs one at a time per key, in arrival order. A job that throws does not block the next.
 * Used per player (all port actions) and per port (stock read-modify-write).
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(() => job());
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
  /** Keys with work queued or running (for tests). */
  get size(): number {
    return this.tails.size;
  }
}

/** The process-wide queues: one per player for all port actions, one per port for its stock. */
export const playerQueue = new KeyedQueue();
export const portQueue = new KeyedQueue();
