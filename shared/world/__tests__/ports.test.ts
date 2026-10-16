// shared/world/ports.ts (card W4): the typed port list, dock-radius checks, market profiles.
import { describe, expect, it } from "vitest";
import raw from "../ports.json";
import versions from "../versions.json";
import {
  CHEAP_PRICE_FACTOR,
  DEAR_PRICE_FACTOR,
  PORTS,
  PORTS_VERSION,
  STARTER_PORTS,
  dockDistance,
  goodPriceFactor,
  nearestDockPort,
  portById,
  portByKey,
  portGoodPrice,
  portGoodStock,
  withinDock,
} from "../ports";
import { PORT_INTERACTION_RADIUS } from "../../gameConstants";
import { metricDist, metricX } from "../geo";

describe("PORTS", () => {
  it("mirrors ports.json with 1-based numeric ids and the string key", () => {
    expect(PORTS.length).toBe(raw.length);
    PORTS.forEach((p, i) => {
      expect(p.id).toBe(i + 1);
      expect(p.key).toBe(raw[i].id);
      expect(p.dock).toEqual(raw[i].dock);
      expect(p.spawn).toEqual(raw[i].spawn);
      expect(p.y).toBe(0);
    });
    expect(portByKey("port_royal")!.name).toBe("Port Royal");
    expect(portById(portByKey("havana")!.id)!.key).toBe("havana");
    expect(PORTS_VERSION).toBe(versions.ports);
  });

  it("starter ports are the five Caribbean ports", () => {
    expect(STARTER_PORTS.map((p) => p.key)).toEqual(["port_royal", "nassau", "tortuga", "havana", "bridgetown"]);
    for (const p of STARTER_PORTS) expect(p.region).toBe("caribbean");
  });
});

describe("dock checks", () => {
  const pr = portByKey("port_royal")!;

  it("withinDock uses the metric distance to the dock, radius PORT_INTERACTION_RADIUS", () => {
    expect(PORT_INTERACTION_RADIUS).toBe(300);
    expect(withinDock(pr.dock.x, pr.dock.z, pr)).toBe(true);
    expect(withinDock(pr.dock.x, pr.dock.z + 299, pr)).toBe(true);
    expect(withinDock(pr.dock.x, pr.dock.z + 301, pr)).toBe(false);
    // x is scaled by metricX: 290 metric east is inside, 310 metric east is outside.
    const mx = metricX(pr.dock.z);
    expect(withinDock(pr.dock.x + 290 / mx, pr.dock.z, pr)).toBe(true);
    expect(withinDock(pr.dock.x + 310 / mx, pr.dock.z, pr)).toBe(false);
    expect(dockDistance(pr.dock.x, pr.dock.z + 100, pr)).toBeCloseTo(100, 5);
  });

  it("the town itself is not the reference point", () => {
    // Port Royal's town is ~138 units from its dock; a point 280 beyond the dock on the far side is in range
    // of the dock but > 300 from the town.
    const dz = pr.dock.z - pr.z;
    const p = { x: pr.dock.x, z: pr.dock.z + Math.sign(dz) * 280 };
    expect(withinDock(p.x, p.z, pr)).toBe(true);
    expect(metricDist(p.x, p.z, pr.x, pr.z)).toBeGreaterThan(300);
  });

  it("nearestDockPort finds the closest dock (wrapping x)", () => {
    for (const p of PORTS) {
      const hit = nearestDockPort(p.dock.x + 1, p.dock.z, PORTS)!;
      expect(hit.port.key).toBe(p.key);
      expect(hit.distance).toBeLessThan(1);
    }
    expect(nearestDockPort(0, 0, [])).toBeNull();
  });
});

describe("markets", () => {
  const rng = () => 0.5; // zero fluctuation
  const good = (name: string, basePrice = 100) => ({ name, basePrice, fluctuation: 20 });

  it("regional specialities are cheap and plentiful; demand is dear and scarce", () => {
    const pr = portByKey("port_royal")!; // caribbean
    const macau = portByKey("macau")!; // east_asia
    expect(goodPriceFactor(pr, "Sugar")).toBe(CHEAP_PRICE_FACTOR);
    expect(goodPriceFactor(pr, "Silk")).toBe(DEAR_PRICE_FACTOR);
    expect(goodPriceFactor(macau, "Silk")).toBe(CHEAP_PRICE_FACTOR);
    expect(goodPriceFactor(pr, "Fish")).toBe(1);
    expect(portGoodPrice(pr, good("Sugar"), rng)).toBe(70);
    expect(portGoodPrice(macau, good("Sugar"), rng)).toBe(135);
    expect(portGoodStock(pr, "Sugar", rng)).toBeGreaterThan(portGoodStock(pr, "Fish", rng));
    expect(portGoodStock(pr, "Silk", rng)).toBeLessThan(portGoodStock(pr, "Fish", rng));
  });

  it("pirate havens sell cheap rum", () => {
    const capeTownLike = { region: "africa", nation: "pirates" };
    expect(goodPriceFactor(capeTownLike, "Rum")).toBe(CHEAP_PRICE_FACTOR); // africa demands Rum, pirates override
    expect(goodPriceFactor(portByKey("sainte_marie")!, "Rum")).toBe(CHEAP_PRICE_FACTOR);
  });

  it("prices stay at least 1", () => {
    expect(portGoodPrice({ region: "caribbean" }, { name: "Sugar", basePrice: 1, fluctuation: 100 }, () => 0)).toBeGreaterThanOrEqual(1);
  });
});
