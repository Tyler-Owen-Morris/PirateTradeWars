import { describe, expect, it } from "vitest";
import {
  buildLedger, groupLedger, limitFor, limitLine, parseTyped, defaultQty, rowSide, selReducer, initialSel,
  isCheap, paysWell, type LedgerGood,
} from "../logic";

const catalog = [
  { id: 1, name: "Fish", basePrice: 10, fluctuation: 20, group: "staples" as const },
  { id: 3, name: "Sugar", basePrice: 30, fluctuation: 25, group: "colonial" as const },
  { id: 8, name: "Silk", basePrice: 100, fluctuation: 50, group: "luxuries" as const },
  { id: 42, name: "Whale Oil", basePrice: 55, fluctuation: 20 },
];
const portGoods = [
  { goodId: 1, currentPrice: 8, stock: 120, buyPrice: 8, sellPrice: 7 },
  { goodId: 3, currentPrice: 18, stock: 14, buyPrice: 18, sellPrice: 16, wanted: false },
  { goodId: 8, currentPrice: 140, stock: 0, buyPrice: null, sellPrice: 126, wanted: true },
];
const inv = [{ goodId: 1, quantity: 5, avgPaid: 9 }];
const purse = { gold: 1000, used: 26, cap: 40 };
const ledger = buildLedger(catalog, portGoods, inv);
const get = (id: number) => ledger.find((g) => g.id === id)!;

describe("buildLedger / groups", () => {
  it("merges catalogue, market and hold", () => {
    expect(get(1)).toMatchObject({ buyPrice: 8, sellPrice: 7, held: 5, paid: 9, stock: 120 });
    expect(get(8)).toMatchObject({ buyPrice: null, sellPrice: 126, wanted: true, stock: 0 });
    expect(get(42)).toMatchObject({ untraded: true, buyPrice: null });
  });
  it("an old server (currentPrice only) still works: spread computed client-side", () => {
    const old = buildLedger(catalog, [{ goodId: 3, currentPrice: 20, stock: 5 }], []);
    expect(old.find((g) => g.id === 3)).toMatchObject({ buyPrice: 20, sellPrice: 18 });
  });
  it("groups follow GOOD_GROUPS; unknown groups land last", () => {
    expect(groupLedger(ledger).map((s) => s.id)).toEqual(["staples", "colonial", "luxuries", "other"]);
  });
});

describe("limits", () => {
  it("names the limiting factor", () => {
    expect(limitFor(get(3), "buy", purse)).toMatchObject({ max: 14, short: "hold" });
    expect(limitFor(get(3), "buy", { gold: 90, used: 0, cap: 40 })).toMatchObject({ max: 5, short: "purse" });
    expect(limitFor(get(3), "buy", { gold: 9999, used: 0, cap: 40 })).toMatchObject({ max: 14, short: "stock" });
    expect(limitLine("buy", { max: 14, short: "hold" })).toBe("Max 14: limited by the room in your hold.");
  });
  it("explains every blocked case", () => {
    expect(limitFor(get(8), "buy", purse)).toMatchObject({ max: 0, short: "not sold" });
    expect(limitFor(get(3), "buy", { gold: 1000, used: 40, cap: 40 })).toMatchObject({ max: 0, short: "hold full" });
    expect(limitFor(get(3), "buy", { gold: 5, used: 0, cap: 40 })).toMatchObject({ max: 0, short: "too dear" });
    expect(limitFor({ ...get(3), stock: 0 }, "buy", purse)).toMatchObject({ max: 0, short: "sold out" });
    expect(limitFor(get(3), "sell", purse)).toMatchObject({ max: 0, idle: true });
    expect(limitFor(get(1), "sell", purse)).toMatchObject({ max: 5 });
  });
  it("hints judge the deal from the player's side", () => {
    expect(isCheap(get(3))).toBe(true);
    expect(isCheap(get(8))).toBe(false);
    expect(paysWell({ ...get(8), wanted: false })).toBe(true);
  });
  it("row tap falls back to the side with a price", () => {
    expect(rowSide(get(1))).toBe("sell");
    expect(rowSide(get(3))).toBe("buy");
    expect(rowSide(get(8))).toBe("sell");
  });
});

describe("amount entry (UX review B1)", () => {
  it("rewrites over-max to max, rejects empty and 0, strips junk", () => {
    expect(parseTyped("999", 13)).toEqual({ qty: 13, text: "13", clamped: true });
    expect(parseTyped("", 13)).toEqual({ qty: null, text: "", clamped: false });
    expect(parseTyped("0", 13).qty).toBeNull();
    expect(parseTyped("007", 13)).toEqual({ qty: 7, text: "7", clamped: false });
    expect(parseTyped("1a2", 13)).toEqual({ qty: 12, text: "12", clamped: false });
  });
  it("defaults: sell = all aboard, buy = last chip (never max)", () => {
    expect(defaultQty(get(1), "sell", purse)).toBe(5);
    expect(defaultQty(get(3), "buy", purse)).toBe(1);
    expect(defaultQty(get(3), "buy", purse, 10)).toBe(10);
  });
});

describe("selection grammar", () => {
  const choose = (s: any, g: LedgerGood, side: "buy" | "sell", via: "pointer" | "keyboard") => selReducer(s, { type: "choose", good: g, side, via, purse });
  it("one selection; pointer re-press clears, keyboard only chooses", () => {
    let s = choose(initialSel, get(3), "buy", "pointer");
    expect(s.sel).toEqual({ goodId: 3, side: "buy" });
    expect(choose(s, get(3), "buy", "keyboard").sel).toEqual({ goodId: 3, side: "buy" });
    expect(choose(s, get(3), "buy", "pointer").sel).toBeNull();
    s = choose(s, get(1), "sell", "keyboard");
    expect(s).toMatchObject({ sel: { goodId: 1, side: "sell" }, qty: 5, text: "5" });
  });
  it("box and amount always agree", () => {
    let s = choose(initialSel, get(3), "buy", "pointer");
    s = selReducer(s, { type: "typed", raw: "999", max: 14 });
    expect([s.qty, s.text]).toEqual([14, "14"]);
    s = selReducer(s, { type: "typed", raw: "", max: 14 });
    expect([s.qty, s.text]).toEqual([null, ""]);
    s = selReducer(s, { type: "set", qty: 3, max: 14 });
    expect([s.qty, s.text]).toEqual([3, "3"]);
  });
  it("the 10 chip is remembered for buys; max is not", () => {
    let s = choose(initialSel, get(3), "buy", "pointer");
    s = selReducer(s, { type: "chip", chip: 10, max: 14 });
    s = selReducer(s, { type: "chip", chip: "max", max: 14 });
    expect(s.lastBuyChip).toBe(10);
    s = selReducer(s, { type: "clear" });
    s = choose(s, get(3), "buy", "pointer");
    expect(s.qty).toBe(10);
  });
  it("after a trade: keep the line if more can be traded, else clear", () => {
    let s = choose(initialSel, get(1), "sell", "pointer");
    s = selReducer(s, { type: "reset", good: { ...get(1), held: 0 }, purse });
    expect(s.sel).toBeNull();
    s = choose(initialSel, get(3), "buy", "pointer");
    s = selReducer(s, { type: "reset", good: get(3), purse });
    expect(s.sel).not.toBeNull();
  });
});
