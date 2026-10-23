/**
 * Trade screen logic (pure, framework-free; unit-tested in __tests__/logic.test.ts).
 * The screen itself is components/ui/trade/BillOfGoods.tsx; the design is docs/design/STYLE_GUIDE.md and
 * docs/proposals/trade-redesign/PROPOSAL.md.
 *
 * - `buildLedger` merges the goods catalogue, the port's goods (GET /api/ports/:id/goods) and the hold.
 * - `limitFor` = how many of a line can be traded and, when none, why (the words the slip shows).
 * - `parseTyped` implements exact amount entry: the box, the Sign label and the request always agree.
 * - `tradeReducer` owns the selection grammar: ONE selection `{goodId, side}`; pointer re-press clears,
 *   keyboard (B/S/Space/Enter) only chooses; tab changes clear everything.
 */
import { GOOD_GROUPS, type GoodDef } from "@shared/gameConstants";
import { sellPriceOf } from "@shared/market";
import type { InventoryRow, TradeCode } from "@shared/protocol";

export type Side = "buy" | "sell";

/** One line of the bill of goods. */
export interface LedgerGood {
  id: number;
  name: string;
  group: string;
  /** The good's base price (for "cheap here" / "pays well"). */
  usual: number;
  /** What the player pays; null = not sold here. */
  buyPrice: number | null;
  /** What the port pays. */
  sellPrice: number;
  stock: number;
  wanted: boolean;
  held: number;
  /** Average price paid (unknown for cargo bought before avgPaid existed). */
  paid?: number;
  /** The port has no market row for this good at all. */
  untraded?: boolean;
}

/** The goods API row (new fields optional: an old server sends only currentPrice/stock). */
export interface PortGoodRow {
  goodId: number;
  currentPrice: number;
  stock: number;
  buyPrice?: number | null;
  sellPrice?: number;
  wanted?: boolean;
}

export function buildLedger(catalog: readonly GoodDef[], portGoods: readonly PortGoodRow[], inventory: readonly InventoryRow[]): LedgerGood[] {
  return catalog.map((g) => {
    const row = portGoods.find((r) => r.goodId === g.id);
    const inv = inventory.find((r) => r.goodId === g.id);
    const held = inv && inv.quantity > 0 ? inv.quantity : 0;
    const buyPrice = row ? (row.buyPrice !== undefined ? row.buyPrice : row.currentPrice) : null;
    return {
      id: g.id,
      name: g.name,
      group: g.group ?? "",
      usual: g.basePrice,
      buyPrice,
      sellPrice: row ? (row.sellPrice ?? sellPriceOf(row.currentPrice)) : 0,
      stock: row && buyPrice !== null ? row.stock : 0,
      wanted: !!row?.wanted,
      held,
      paid: held && inv?.avgPaid !== undefined ? inv.avgPaid : undefined,
      untraded: !row,
    };
  });
}

/** Sections in GOOD_GROUPS order; goods with an unknown group go to a final "Other goods" section. */
export function groupLedger(goods: readonly LedgerGood[]): { id: string; label: string; note: string; goods: LedgerGood[] }[] {
  const known = new Set(GOOD_GROUPS.map((g) => g.id as string));
  const out = GOOD_GROUPS.map((g) => ({ id: g.id as string, label: g.label, note: g.note, goods: goods.filter((x) => x.group === g.id) }));
  const other = goods.filter((x) => !known.has(x.group));
  if (other.length) out.push({ id: "other", label: "Other goods", note: "", goods: other });
  return out.filter((s) => s.goods.length);
}

export type Filter = "all" | "hold" | "wanted" | "here";
export const FILTERS: { id: Filter; label: string; test: (g: LedgerGood) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "hold", label: "In my hold", test: (g) => g.held > 0 },
  { id: "wanted", label: "Wanted", test: (g) => g.wanted },
  { id: "here", label: "Sold here", test: (g) => g.buyPrice !== null },
];

export interface Purse {
  gold: number;
  used: number;
  cap: number;
}
export interface Limit {
  max: number;
  /** Sentence shown when nothing can be traded. */
  block?: string;
  /** Two words for the ledger cell ("hold full") or the limiting factor ("hold" | "purse" | "stock"). */
  short?: string;
  /** Sell side with nothing aboard (informational, not a refusal). */
  idle?: boolean;
}

export function limitFor(g: LedgerGood, side: Side, p: Purse): Limit {
  if (side === "sell") {
    if (g.untraded) return { max: 0, block: `${g.name} is not traded at this port.`, short: "not traded" };
    return g.held ? { max: g.held, short: "aboard" } : { max: 0, idle: true, block: `You carry no ${g.name}. Buy some first, or pick another line.` };
  }
  if (g.buyPrice === null) return { max: 0, block: `${g.name} is not sold here. The port will still buy it from you.`, short: "not sold" };
  if (!g.stock) return { max: 0, block: `Sold out. The warehouse has no ${g.name} today.`, short: "sold out" };
  const free = Math.max(0, p.cap - p.used), byGold = Math.floor(p.gold / g.buyPrice);
  const max = Math.min(g.stock, byGold, free);
  if (max <= 0) {
    if (free <= 0) return { max: 0, block: `Your hold is full (${p.cap}/${p.cap}). Sell something first.`, short: "hold full" };
    return { max: 0, block: `Your purse is short: one costs ${fmt(g.buyPrice)} g and you have ${fmt(p.gold)} g.`, short: "too dear" };
  }
  return { max, short: max === free ? "hold" : max === byGold ? "purse" : "stock" };
}

export function limitLine(side: Side, l: Limit): string {
  if (side === "sell") return `${l.max} aboard.`;
  const by = l.short === "hold" ? "the room in your hold" : l.short === "purse" ? "your purse" : "the port's stock";
  return `Max ${l.max}: limited by ${by}.`;
}

export const isCheap = (g: LedgerGood) => g.buyPrice !== null && g.stock > 0 && g.buyPrice <= g.usual * 0.8;
export const paysWell = (g: LedgerGood) => !g.wanted && !g.untraded && g.sellPrice >= g.usual * 1.2;

/** Tapping a line's name: sell if aboard; else buy if it can be bought; else the side that has a price. */
export function rowSide(g: LedgerGood): Side {
  if (g.held) return "sell";
  if (g.buyPrice !== null) return "buy";
  return "sell";
}

/** Default amount: Sell = all aboard; Buy = the last quick chip used this session (1 or 10), never Max. */
export function defaultQty(g: LedgerGood, side: Side, p: Purse, lastBuyChip: 1 | 10 = 1): number {
  const m = limitFor(g, side, p).max;
  if (!m) return 0;
  return side === "sell" ? m : Math.min(lastBuyChip, m);
}

/** Exact amount entry. Digits only; above max is rewritten to max at once; empty or 0 is invalid (null). */
export function parseTyped(raw: string, max: number): { qty: number | null; text: string; clamped: boolean } {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits === "" || Number(digits) < 1) return { qty: null, text: digits, clamped: false };
  const n = Number(digits);
  if (n > max) return { qty: max, text: String(max), clamped: true };
  return { qty: n, text: digits, clamped: false };
}

export const clampQty = (v: number, max: number) => (max < 1 ? 0 : Math.max(1, Math.min(max, Math.round(v))));

/** In-world wording for a refusal from the server (tradeResult.code). */
export function refusalText(code: TradeCode | undefined, message: string | undefined): string {
  switch (code) {
    case "too_far": return "The harbourmaster refuses: you have drifted out of the harbour. Sail back inside the ring at the pier to trade.";
    case "price_changed": return `${message ?? "The price moved."} Check the new total and sign again.`;
    case "dead": return "A sunk ship can't trade.";
    case "hold_changed": return message ?? "Your hold changed since you looked. Check the bill and sign again.";
    default: return message ? `The clerk refuses: ${message}` : "The clerk refuses the bill.";
  }
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---------------------------------------------------------------------------------------------
// Selection reducer (the parts with rules worth testing)
// ---------------------------------------------------------------------------------------------

export interface SelState {
  sel: { goodId: number; side: Side } | null;
  /** null = the box is empty or 0 (invalid; Sign disabled). */
  qty: number | null;
  /** What the box shows. Always equals String(qty) when qty is valid. */
  text: string;
  lastBuyChip: 1 | 10;
}
export const initialSel: SelState = { sel: null, qty: null, text: "", lastBuyChip: 1 };

export type SelAction =
  | { type: "choose"; good: LedgerGood; side: Side; via: "pointer" | "keyboard"; purse: Purse }
  | { type: "clear" }
  | { type: "set"; qty: number; max: number }
  | { type: "chip"; chip: 1 | 10 | "max"; max: number }
  | { type: "typed"; raw: string; max: number }
  | { type: "reset"; good: LedgerGood | null; purse: Purse };

export function selReducer(s: SelState, a: SelAction): SelState {
  switch (a.type) {
    case "choose": {
      const same = s.sel && s.sel.goodId === a.good.id && s.sel.side === a.side;
      if (same) return a.via === "pointer" ? { ...s, sel: null, qty: null, text: "" } : s;   // B/S never clear
      const q = defaultQty(a.good, a.side, a.purse, s.lastBuyChip);
      return { ...s, sel: { goodId: a.good.id, side: a.side }, qty: q || null, text: q ? String(q) : "" };
    }
    case "clear":
      return { ...s, sel: null, qty: null, text: "" };
    case "set": {
      const q = clampQty(a.qty, a.max);
      return { ...s, qty: q || null, text: q ? String(q) : "" };
    }
    case "chip": {
      const q = clampQty(a.chip === "max" ? a.max : a.chip, a.max);
      return { ...s, qty: q || null, text: q ? String(q) : "", lastBuyChip: a.chip === "max" || !s.sel || s.sel.side !== "buy" ? s.lastBuyChip : a.chip };
    }
    case "typed": {
      const r = parseTyped(a.raw, a.max);
      return { ...s, qty: r.qty, text: r.text };
    }
    case "reset": {
      // After a trade: keep the line while more can be traded (amount back to the default), else clear.
      if (!s.sel || !a.good) return { ...s, sel: null, qty: null, text: "" };
      const q = defaultQty(a.good, s.sel.side, a.purse, s.lastBuyChip);
      return q ? { ...s, qty: q, text: String(q) } : { ...s, sel: null, qty: null, text: "" };
    }
  }
}
