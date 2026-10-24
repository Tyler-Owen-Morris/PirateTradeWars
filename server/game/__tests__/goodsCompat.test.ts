// New Horizons phase 1: protocol and inventory back-compat with the 5 appended goods (ids 9-13).
import { describe, expect, it } from "vitest";
import { GOODS } from "@shared/gameConstants";
import { parseClientMessage } from "@shared/protocol";
import { applyTrade, applySellAll } from "../trade";
import { buildLedger, groupLedger } from "../../../client/src/lib/trade/logic";

describe("goods ids are append-only", () => {
  it("the original 8 ids keep their names (player inventories are keyed by goodId)", () => {
    expect(GOODS.slice(0, 8).map((g) => `${g.id}:${g.name}`)).toEqual([
      "1:Fish", "2:Wood", "3:Sugar", "4:Cotton", "5:Rum", "6:Tobacco", "7:Spices", "8:Silk",
    ]);
    expect(new Set(GOODS.map((g) => g.id)).size).toBe(GOODS.length);
  });
});

describe("protocol", () => {
  it("accepts trades and sellAll lines for the new goods, old and new message shapes", () => {
    expect(parseClientMessage({ type: "trade", portId: 30, action: "buy", goodId: 9, quantity: 3 })).toMatchObject({ goodId: 9, quantity: 3 });
    expect(parseClientMessage({ type: "trade", portId: 30, action: "sell", goodId: 13, quantity: 1, ref: 7, expectedPrice: 40 })).toMatchObject({ goodId: 13, ref: 7, expectedPrice: 40 });
    expect(parseClientMessage({ type: "sellAll", portId: 30, lines: [{ goodId: 1, quantity: 2 }, { goodId: 10, quantity: 1 }] })).toMatchObject({ type: "sellAll" });
  });
});

describe("inventory back-compat", () => {
  // A player saved before the expansion: rows without avgPaid, old ids only.
  const old = { gold: 2000, cargoCapacity: 40, inventory: [{ goodId: 3, quantity: 10 }, { goodId: 5, quantity: 4 }] };
  const market = [
    { goodId: 3, currentPrice: 30, stock: 50 },
    { goodId: 5, currentPrice: 60, stock: 50 },
    { goodId: 9, currentPrice: 84, stock: 120 },
    { goodId: 10, currentPrice: 300, stock: 0, notSold: true },
  ];
  it("an old hold can buy a new good and keeps its old rows", () => {
    const r = applyTrade(old, market, { action: "buy", goodId: 9, quantity: 5 }, "Silver");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inventory).toEqual([{ goodId: 3, quantity: 10 }, { goodId: 5, quantity: 4 }, { goodId: 9, quantity: 5, avgPaid: 84 }]);
    expect(r.gold).toBe(2000 - 5 * 84);
  });
  it("a not-sold new good is refused for buying but bought from the player", () => {
    const refused = applyTrade(old, market, { action: "buy", goodId: 10, quantity: 1 }, "Gold");
    expect(refused).toMatchObject({ ok: false, code: "not_sold" });
    const st = { ...old, inventory: [...old.inventory, { goodId: 10, quantity: 2, avgPaid: 108 }] };
    const sold = applyTrade(st, market, { action: "sell", goodId: 10, quantity: 2 }, "Gold");
    expect(sold).toMatchObject({ ok: true, price: 270, total: 540 });
    expect(applySellAll(st, market, undefined)).toMatchObject({ ok: true });
  });
  it("the trade screen ledger lists all 16 goods; an old server's 8 rows leave the new ones 'not traded'", () => {
    const ledger = buildLedger(GOODS, market.slice(0, 2).map(({ goodId, currentPrice, stock }) => ({ goodId, currentPrice, stock })), old.inventory);
    expect(ledger.length).toBe(16);
    expect(ledger.find((g) => g.id === 9)).toMatchObject({ untraded: true, buyPrice: null });
    expect(ledger.find((g) => g.id === 3)).toMatchObject({ held: 10, paid: undefined, buyPrice: 30 });
    const groups = groupLedger(buildLedger(GOODS, market, old.inventory)).map((s) => s.id);
    expect(groups).toEqual(["staples", "colonial", "luxuries", "specie", "northern"]);
    expect(groupLedger(buildLedger(GOODS, market, [])).find((s) => s.id === "specie")!.goods.map((g) => g.name)).toEqual(["Silver", "Gold"]);
    // New Horizons phase 2: the Northern group
    expect(groupLedger(buildLedger(GOODS, market, [])).find((s) => s.id === "northern")!.goods.map((g) => g.name)).toEqual(["Furs", "Whale Oil", "Naval Stores"]);
  });
});
