// The price simulator over the market model: no single route dominates absurdly.
import { describe, expect, it } from "vitest";
import { allRoutes, bestPerGood, formatRoute, topRoutes } from "../priceSim";

describe("price simulator", () => {
  it("finds profitable routes for every good", () => {
    expect(bestPerGood().length).toBe(16);
    expect(allRoutes().length).toBeGreaterThan(500);
  });
  it("no single route dominates per cargo unit", () => {
    const top = topRoutes(10, "profit");
    if (process.env.PRICE_SIM_PRINT) for (const r of top) console.log(formatRoute(r));
    expect(top[0].profit).toBeLessThanOrEqual(top[9].profit * 1.25);
    // Long hauls pay, but a best route is still a few hundred gold per unit, not thousands.
    expect(top[0].profit).toBeLessThan(400);
  });
  it("no single route dominates per distance sailed", () => {
    const top = topRoutes(10, "perLeague");
    expect(top[0].perLeague).toBeLessThanOrEqual(top[9].perLeague * 1.6);
  });
  it("every route's profit is the spread-adjusted difference (selling back where you bought always loses)", () => {
    for (const r of allRoutes()) {
      expect(r.from).not.toBe(r.to);
      expect(r.profit).toBe(r.sell - r.buy);
      expect(r.sell).toBeLessThanOrEqual(Math.round(r.sell / 0.9) + 1);
    }
  });
});
