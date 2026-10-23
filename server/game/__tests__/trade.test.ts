// Trading (2026-10-23): the pure trade rules (spread, stock, avgPaid, expectedPrice, sellAll) and the
// per-key queue that serializes a player's trades.
import { describe, expect, it } from "vitest";
import { applySellAll, applyTrade, KeyedQueue, cargoOf } from "../trade";
import { sellPriceOf, portGoodView, SELL_SPREAD } from "@shared/market";

const market = () => [
  { goodId: 1, currentPrice: 10, stock: 100 },
  { goodId: 3, currentPrice: 30, stock: 5 },
  { goodId: 8, currentPrice: 100, stock: 50, notSold: true },
];
const trader = (over: Partial<{ gold: number; cargoCapacity: number; inventory: any[] }> = {}) => ({
  gold: 1000, cargoCapacity: 20, inventory: [] as any[], ...over,
});

describe("spread", () => {
  it("the port pays about 10% less than it charges, never below 1", () => {
    expect(SELL_SPREAD).toBe(0.9);
    expect(sellPriceOf(100)).toBe(90);
    expect(sellPriceOf(18)).toBe(16);
    expect(sellPriceOf(1)).toBe(1);
  });
  it("the goods view exposes buy/sell prices and keeps the legacy currentPrice", () => {
    const v = portGoodView({ goodId: 3, currentPrice: 30, stock: 5 }, { region: "north_atlantic" }, "Sugar");
    expect(v).toMatchObject({ buyPrice: 30, sellPrice: 27, stock: 5, wanted: true, currentPrice: 30 });
    expect(portGoodView({ goodId: 8, currentPrice: 100, stock: 9, notSold: true }, null, "Silk")).toMatchObject({ buyPrice: null, sellPrice: 90, stock: 0, wanted: false });
  });
});

describe("applyTrade: buy", () => {
  it("charges the price, takes stock, fills the hold and records avgPaid", () => {
    const r = applyTrade(trader(), market(), { action: "buy", goodId: 1, quantity: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ price: 10, total: 40, gold: 960, cargoUsed: 4 });
    expect(r.inventory).toEqual([{ goodId: 1, quantity: 4, avgPaid: 10 }]);
    expect(r.market.find((m) => m.goodId === 1)!.stock).toBe(96);
  });
  it("averages what was paid across purchases", () => {
    const r = applyTrade(trader({ inventory: [{ goodId: 1, quantity: 2, avgPaid: 7 }] }), market(), { action: "buy", goodId: 1, quantity: 2 });
    expect(r.ok && r.inventory[0].avgPaid).toBe(8.5);
  });
  it("refuses with a code when it can't", () => {
    const code = (t: any, req: any) => { const r = applyTrade(t, market(), req); return r.ok ? "ok" : r.code; };
    expect(code(trader(), { action: "buy", goodId: 3, quantity: 6 })).toBe("no_stock");
    expect(code(trader({ gold: 39 }), { action: "buy", goodId: 1, quantity: 4 })).toBe("no_gold");
    expect(code(trader({ inventory: [{ goodId: 3, quantity: 18 }] }), { action: "buy", goodId: 1, quantity: 3 })).toBe("no_space");
    expect(code(trader(), { action: "buy", goodId: 8, quantity: 1 })).toBe("not_sold");
    expect(code(trader(), { action: "buy", goodId: 99, quantity: 1 })).toBe("not_traded");
  });
  it("expectedPrice: refuses a rise, runs at a fall", () => {
    const up = applyTrade(trader(), market(), { action: "buy", goodId: 1, quantity: 1, expectedPrice: 9 });
    expect(up.ok ? "ok" : up.code).toBe("price_changed");
    const down = applyTrade(trader(), market(), { action: "buy", goodId: 1, quantity: 1, expectedPrice: 12 });
    expect(down.ok && down.price).toBe(10);
  });
  it("never mutates its inputs", () => {
    const t = trader({ inventory: [{ goodId: 1, quantity: 2, avgPaid: 7 }] }), m = market();
    const snap = JSON.stringify([t, m]);
    applyTrade(t, m, { action: "buy", goodId: 1, quantity: 2 });
    applyTrade(t, m, { action: "sell", goodId: 1, quantity: 2 });
    expect(JSON.stringify([t, m])).toBe(snap);
  });
});

describe("applyTrade: sell", () => {
  const t = () => trader({ inventory: [{ goodId: 1, quantity: 5, avgPaid: 8 }] });
  it("pays the spread price, returns stock, keeps avgPaid on the rest", () => {
    const r = applyTrade(t(), market(), { action: "sell", goodId: 1, quantity: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ price: 9, total: 18, gold: 1018, cargoUsed: 3 });
    expect(r.inventory).toEqual([{ goodId: 1, quantity: 3, avgPaid: 8 }]);
    expect(r.market.find((m) => m.goodId === 1)!.stock).toBe(102);
  });
  it("drops the row when everything is sold", () => {
    const r = applyTrade(t(), market(), { action: "sell", goodId: 1, quantity: 5 });
    expect(r.ok && r.inventory).toEqual([]);
  });
  it("a port that doesn't sell a good still buys it", () => {
    const r = applyTrade(trader({ inventory: [{ goodId: 8, quantity: 1 }] }), market(), { action: "sell", goodId: 8, quantity: 1 });
    expect(r.ok && r.total).toBe(90);
  });
  it("refuses selling more than aboard, and a price that fell", () => {
    const a = applyTrade(t(), market(), { action: "sell", goodId: 1, quantity: 6 });
    expect(a.ok ? "ok" : a.code).toBe("not_owned");
    const b = applyTrade(t(), market(), { action: "sell", goodId: 1, quantity: 1, expectedPrice: 10 });
    expect(b.ok ? "ok" : b.code).toBe("price_changed");
    const c = applyTrade(t(), market(), { action: "sell", goodId: 1, quantity: 1, expectedPrice: 8 });
    expect(c.ok && c.price).toBe(9);
  });
});

describe("applySellAll", () => {
  const inv = [{ goodId: 1, quantity: 5, avgPaid: 8 }, { goodId: 3, quantity: 2 }];
  it("sells every line at the spread price, all at once", () => {
    const r = applySellAll(trader({ inventory: inv }), market(), undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(5 * 9 + 2 * 27);
    expect(r.inventory).toEqual([]);
    expect(r.cargoUsed).toBe(0);
    expect(r.market.find((m) => m.goodId === 3)!.stock).toBe(7);
  });
  it("is all-or-nothing: a stale bill or a price drop sells nothing", () => {
    const stale = applySellAll(trader({ inventory: inv }), market(), [{ goodId: 1, quantity: 5 }]);
    expect(stale.ok ? "ok" : stale.code).toBe("hold_changed");
    const drop = applySellAll(trader({ inventory: inv }), market(), [{ goodId: 1, quantity: 5, expectedPrice: 10 }, { goodId: 3, quantity: 2 }]);
    expect(drop.ok ? "ok" : drop.code).toBe("price_changed");
    const empty = applySellAll(trader(), market(), undefined);
    expect(empty.ok ? "ok" : empty.code).toBe("empty_hold");
  });
  it("cargoOf sums positive quantities", () => {
    expect(cargoOf([{ goodId: 1, quantity: 3 }, { goodId: 2, quantity: 0 }, { goodId: 3, quantity: 4 }])).toBe(7);
  });
});

describe("KeyedQueue", () => {
  it("runs jobs for one key strictly one after another, keys in parallel", async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const job = (k: string, n: number, ms: number) => q.run(k, async () => {
      log.push(`${k}${n}+`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${k}${n}-`);
      return n;
    });
    const res = await Promise.all([job("a", 1, 20), job("a", 2, 1), job("b", 1, 5)]);
    expect(res).toEqual([1, 2, 1]);
    expect(log.indexOf("a1-")).toBeLessThan(log.indexOf("a2+"));
    expect(log.indexOf("b1+")).toBeLessThan(log.indexOf("a1-"));
    await new Promise((r) => setTimeout(r, 0));
    expect(q.size).toBe(0);
  });
  it("a failing job doesn't block the next", async () => {
    const q = new KeyedQueue();
    const a = q.run("k", async () => { throw new Error("x"); });
    const b = q.run("k", async () => 2);
    await expect(a).rejects.toThrow("x");
    await expect(b).resolves.toBe(2);
  });
});
