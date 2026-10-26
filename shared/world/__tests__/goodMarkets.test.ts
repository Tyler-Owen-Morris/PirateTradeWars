// The market model (shared/world/goodMarkets.ts, New Horizons phase 1): sources cheap, the distance
// premium, notSold for exotics away from their sources, wanted, the spread, pirate rum.
import { describe, expect, it } from "vitest";
import {
  DISTANCE_CURVE,
  EXOTIC_SOLD_WITHIN,
  FAR_DISTANCE,
  FAR_FACTOR,
  GOOD_MARKETS,
  SOURCE_FACTOR,
  WANTED_FACTOR,
  distanceFactor,
  goodMarketAt,
  goodPriceFactor,
  isSoldAt,
  isWanted,
  laneDistance,
  portGoodPrice,
  portGoodStock,
  portsMatching,
  sourceDistance,
} from "../goodMarkets";
import { PORTS, portByKey } from "../ports";
import { GOODS } from "../../gameConstants";
import { SELL_SPREAD, portGoodView, sellPriceOf } from "../../market";

const P = (k: string) => {
  const p = portByKey(k);
  if (!p) throw new Error(`no port ${k}`);
  return p;
};
const rng = () => 0.5; // zero fluctuation
const STAPLES = ["Fish", "Wood", "Sugar", "Cotton", "Rum", "Tobacco"];
const EXOTICS = ["Spices", "Silk", "Silver", "Gold", "Cacao", "Hides", "Wine", "Furs", "Whale Oil", "Naval Stores"];

describe("GOOD_MARKETS data", () => {
  it("covers every good in the catalogue; every selector names a real port, region or nation", () => {
    for (const g of GOODS) expect(GOOD_MARKETS[g.name], g.name).toBeDefined();
    const regions = new Set(PORTS.map((p) => p.region as string));
    const keys = new Set(PORTS.map((p) => p.key));
    const nations = new Set(PORTS.map((p) => `nation:${p.nation}`));
    for (const [name, m] of Object.entries(GOOD_MARKETS)) {
      for (const s of [...m.sources, ...m.wanted]) expect(keys.has(s) || regions.has(s) || nations.has(s), `${name}: ${s}`).toBe(true);
      expect(portsMatching(m.sources).length, name).toBeGreaterThan(0);
    }
  });
  it("the phase 1 and phase 2 goods plus Spices and Silk are exotic; staples are not", () => {
    expect(Object.entries(GOOD_MARKETS).filter(([, m]) => m.exotic).map(([n]) => n).sort()).toEqual([...EXOTICS].sort());
  });
  it("the new goods are appended with the ids the inventories will use", () => {
    expect(GOODS.slice(8).map((g) => [g.id, g.name])).toEqual([[9, "Silver"], [10, "Gold"], [11, "Cacao"], [12, "Hides"], [13, "Wine"],
      [14, "Furs"], [15, "Whale Oil"], [16, "Naval Stores"]]);
    expect(GOODS.slice(13).every((g) => g.group === "northern")).toBe(true);
    expect(GOODS.slice(0, 8).map((g) => g.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("distance premium", () => {
  it("0.6 at a source, 2.0 at the far side, monotonic in between", () => {
    expect(distanceFactor(0)).toBe(SOURCE_FACTOR);
    expect(distanceFactor(FAR_DISTANCE)).toBeCloseTo(FAR_FACTOR, 9);
    expect(distanceFactor(FAR_DISTANCE * 3)).toBeCloseTo(FAR_FACTOR, 9);
    let prev = 0;
    for (let d = 0; d <= FAR_DISTANCE; d += 5000) {
      expect(distanceFactor(d)).toBeGreaterThanOrEqual(prev);
      prev = distanceFactor(d);
    }
    expect(DISTANCE_CURVE).toBeLessThanOrEqual(1);
  });
  it("lane distance is symmetric, 0 to itself, and goes round the Horn (no canal at Panamá)", () => {
    expect(laneDistance("callao", "callao")).toBe(0);
    expect(laneDistance("port_royal", "boston")).toBeCloseTo(laneDistance("boston", "port_royal"), 6);
    // Panamá and Portobelo are a few dozen km apart overland, a voyage of 100k+ units by sea.
    expect(laneDistance("panama", "portobelo")).toBeGreaterThan(100_000);
    for (const p of PORTS) expect(Number.isFinite(laneDistance("port_royal", p.key)), p.key).toBe(true);
  });
  it("a good is cheap at its source and dearer the further you sail from it", () => {
    expect(goodMarketAt(P("callao"), "Silver")).toMatchObject({ source: true, distance: 0, factor: SOURCE_FACTOR, sold: true });
    expect(portGoodPrice(P("callao"), { name: "Silver", basePrice: 140, fluctuation: 25 }, rng)).toBe(84);
    const near = sourceDistance(P("guayaquil"), "Silver")!;
    const far = sourceDistance(P("london"), "Silver")!;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(goodPriceFactor(P("london"), "Silver")).toBeGreaterThan(goodPriceFactor(P("guayaquil"), "Silver"));
    // The far side of the world approaches 2× (×1.3 where wanted).
    expect(goodPriceFactor(P("batavia"), "Silver")).toBeGreaterThan(1.8 * WANTED_FACTOR);
  });
  it("every source of every good prices it at 0.6×", () => {
    for (const [name, m] of Object.entries(GOOD_MARKETS))
      for (const p of portsMatching(m.sources)) expect(goodPriceFactor(p, name), `${name} at ${p.key}`).toBe(SOURCE_FACTOR);
  });
});

describe("not sold here", () => {
  it("staples are on sale at every port", () => {
    for (const p of PORTS) for (const g of STAPLES) expect(isSoldAt(p, g), `${g} at ${p.key}`).toBe(true);
  });
  it("exotics are only stocked near their sources", () => {
    for (const g of EXOTICS)
      for (const p of PORTS) expect(isSoldAt(p, g), `${g} at ${p.key}`).toBe(sourceDistance(p, g)! <= EXOTIC_SOLD_WITHIN);
    expect(isSoldAt(P("london"), "Silver")).toBe(false);
    expect(isSoldAt(P("buenos_aires"), "Silver")).toBe(true);
    expect(isSoldAt(P("montevideo"), "Silver")).toBe(true); // across the River Plate from Buenos Aires
    expect(isSoldAt(P("port_royal"), "Spices")).toBe(false);
    expect(isSoldAt(P("macau"), "Silk")).toBe(true);
    expect(isSoldAt(P("porto"), "Wine")).toBe(true);
    expect(isSoldAt(P("rio_de_janeiro"), "Gold")).toBe(true);
    expect(isSoldAt(P("la_guaira"), "Cacao")).toBe(true);
    expect(isSoldAt(P("valparaiso"), "Hides")).toBe(true);
  });
  it("a not-sold good has no stock", () => {
    expect(portGoodStock(P("london"), "Silver", rng)).toBe(0);
    expect(portGoodStock(P("london"), "Silver", rng, true)).toBe(0);
    expect(portGoodStock(P("callao"), "Silver", rng)).toBeGreaterThan(portGoodStock(P("guayaquil"), "Fish", () => 0.99) - 60);
  });
});

describe("wanted", () => {
  it("follows the table (and never at a source)", () => {
    expect(isWanted(P("manila"), "Silver")).toBe(true);
    expect(isWanted(P("callao"), "Silver")).toBe(false);
    expect(isWanted(P("lisbon"), "Gold")).toBe(true);
    expect(isWanted(P("cadiz"), "Cacao")).toBe(true);
    expect(isWanted(P("boston"), "Hides")).toBe(true);
    expect(isWanted(P("port_royal"), "Wine")).toBe(true); // "the Caribbean"
    expect(isWanted(P("port_royal"), "Sugar")).toBe(false);
    for (const [name, m] of Object.entries(GOOD_MARKETS)) for (const p of portsMatching(m.sources)) expect(isWanted(p, name)).toBe(false);
  });
  it("adds demand on top of the distance premium, and the port holds less", () => {
    const a = goodMarketAt(P("manila"), "Silver");
    expect(a.factor).toBeCloseTo(distanceFactor(a.distance!) * WANTED_FACTOR, 9);
    expect(portGoodStock(P("boston"), "Hides", rng)).toBe(0); // wanted but exotic: not sold there, bought dear
    expect(portGoodStock(P("boston"), "Rum", rng)).toBeLessThan(portGoodStock(P("port_royal"), "Rum", rng));
  });
});

describe("pirate havens keep cheap rum", () => {
  it("every pirate port is a Rum source", () => {
    for (const p of PORTS.filter((q) => q.nation === "pirates")) expect(goodPriceFactor(p, "Rum"), p.key).toBe(SOURCE_FACTOR);
    expect(goodPriceFactor(P("juan_fernandez"), "Rum")).toBe(SOURCE_FACTOR);
    expect(goodPriceFactor(P("sainte_marie"), "Rum")).toBe(SOURCE_FACTOR);
  });
});

describe("spread and the goods API view", () => {
  it("the port pays ~10% less than it charges; a not-sold row has no buy price", () => {
    expect(SELL_SPREAD).toBe(0.9);
    const v = portGoodView({ goodId: 9, currentPrice: 300, stock: 0, notSold: true }, P("manila"), "Silver");
    expect(v).toMatchObject({ buyPrice: null, sellPrice: sellPriceOf(300), stock: 0, wanted: true, currentPrice: 300 });
    const s = portGoodView({ goodId: 9, currentPrice: 84, stock: 120 }, P("callao"), "Silver");
    expect(s).toMatchObject({ buyPrice: 84, sellPrice: 76, wanted: false, stock: 120 });
  });
  it("a legacy port record without a key still prices (straight-line fallback)", () => {
    const legacy = { region: "europe", nation: "england", dock: P("london").dock };
    expect(goodPriceFactor(legacy, "Wood")).toBe(SOURCE_FACTOR); // europe is a Wood source by region
    expect(goodPriceFactor(legacy, "Silver")).toBeGreaterThan(1);
    expect(goodPriceFactor({}, "Unknown good")).toBe(1);
    expect(portGoodPrice({ region: "caribbean" }, { name: "Sugar", basePrice: 1, fluctuation: 100 }, () => 0)).toBeGreaterThanOrEqual(1);
  });
});
