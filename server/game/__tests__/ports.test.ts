// Card W4: Redis port seeding (fake store), port spawns on the REAL land data, and player migration.
import { describe, expect, it } from "vitest";
import path from "path";
import { ensurePortGoods, seedPorts, updatePortMarkets, type PortStore, type PortGoodRow, type GoodRow } from "../ports";
import { loadLandSync } from "../landLoader";
import { World, PORT_SPAWN_MIN_WATER, needsRelocation } from "../world";
import { PORTS, PORTS_VERSION, STARTER_PORTS, portByKey, type GamePort } from "@shared/world/ports";
import { GOODS } from "@shared/gameConstants";
import { WORLD_VERSION, metricDist, xOfLon, zOfLat } from "@shared/world/geo";
import { stepShip, shipPhysicsStats, type ShipKinematics } from "@shared/physics";

/** In-memory PortStore with the same semantics as RedisStorage. */
class FakeStore implements PortStore {
  version: string | null = null;
  ports = new Map<number, GamePort>();
  goods: GoodRow[] = GOODS.map((g) => ({ ...g }));
  portGoods = new Map<number, { goodId: number; stock: number; currentPrice: number }[]>();
  replaced = 0;
  async getPortsVersion() {
    return this.version;
  }
  async replacePorts(ports: readonly GamePort[], version: string) {
    this.replaced++;
    for (const id of [...this.ports.keys(), ...ports.map((p) => p.id)]) this.portGoods.delete(id);
    this.ports = new Map(ports.map((p) => [p.id, p]));
    this.version = version;
  }
  async getPorts() {
    return [...this.ports.values()];
  }
  async getGoods() {
    return this.goods;
  }
  async getPortGoods(id: number) {
    return (this.portGoods.get(id) ?? []).map((r) => ({ ...r }));
  }
  async createPortGood(row: PortGoodRow) {
    const list = this.portGoods.get(row.portId) ?? [];
    list.push({ goodId: row.goodId, stock: row.stock, currentPrice: row.currentPrice });
    this.portGoods.set(row.portId, list);
  }
  async updatePortGoodPrice(portId: number, goodId: number, price: number) {
    const r = this.portGoods.get(portId)?.find((g) => g.goodId === goodId);
    if (r) r.currentPrice = price;
  }
  async updatePortGoodStock(portId: number, goodId: number, stock: number) {
    const r = this.portGoods.get(portId)?.find((g) => g.goodId === goodId);
    if (r) r.stock = stock;
  }
}

describe("port seeding (portsVersion)", () => {
  it("seeds an empty store, then is a no-op while the version matches", async () => {
    const s = new FakeStore();
    expect(await seedPorts(s)).toBe(true);
    expect(s.version).toBe(PORTS_VERSION);
    expect((await s.getPorts()).map((p) => p.key)).toEqual(PORTS.map((p) => p.key));
    expect(await seedPorts(s)).toBe(false);
    expect(s.replaced).toBe(1);
  });

  it("re-seeds when the stored version differs and regenerates goods for the new port ids", async () => {
    const s = new FakeStore();
    // An old (pre-W4) world: 14 torus ports with their own goods, no portsVersion.
    for (let id = 1; id <= 14; id++) {
      s.ports.set(id, { ...PORTS[0], id, key: String(id), name: `Old ${id}`, x: 1000 * id, z: 1000 });
      s.portGoods.set(id, [{ goodId: 1, stock: 3, currentPrice: 999 }]);
    }
    expect(await seedPorts(s)).toBe(true);
    expect(s.ports.size).toBe(PORTS.length);
    expect(s.ports.get(1)!.name).toBe(PORTS[0].name);
    expect(s.portGoods.size).toBe(0); // stale goods dropped
    await ensurePortGoods(s, () => 0.5);
    for (const p of PORTS) {
      const goods = await s.getPortGoods(p.id);
      expect(goods.length).toBe(GOODS.length);
      expect(goods.every((g) => g.currentPrice !== 999)).toBe(true);
    }
    // A version bump re-seeds again.
    expect(await seedPorts(s, PORTS, "different")).toBe(true);
    expect(s.version).toBe("different");
  });

  it("market updates keep regional pricing and restock low goods", async () => {
    const s = new FakeStore();
    await seedPorts(s);
    await ensurePortGoods(s, () => 0.5);
    const pr = portByKey("port_royal")!;
    const sugar = GOODS.find((g) => g.name === "Sugar")!;
    await s.updatePortGoodStock(pr.id, sugar.id, 2);
    await updatePortMarkets(s, () => 0.5);
    const row = (await s.getPortGoods(pr.id)).find((g) => g.goodId === sugar.id)!;
    expect(row.currentPrice).toBe(Math.round(sugar.basePrice * 0.7));
    expect(row.stock).toBeGreaterThanOrEqual(20);
  });
});

describe("port spawns on the real land", () => {
  const land = loadLandSync([path.resolve(__dirname, "../../../client/public/world/land")], () => {}).field;

  it("every starter port: 200 spawns, all water with distance > 150, near the port, heading out to sea", () => {
    const w = new World({ land, rng: Math.random });
    const stats = shipPhysicsStats("sloop");
    for (const port of STARTER_PORTS) {
      for (let i = 0; i < 200; i++) {
        const s = w.starterSpawn(port);
        expect(land.distance(s.x, s.z), `${port.key} #${i}`).toBeGreaterThan(PORT_SPAWN_MIN_WATER);
        expect(metricDist(s.x, s.z, port.spawn.x, port.spawn.z)).toBeLessThan(150 * Math.SQRT2 + 1);
        // Heading out to sea: half a second of full sail does not get closer to land.
        if (i < 10) {
          let k: ShipKinematics = { x: s.x, z: s.z, rotationY: s.rotationY, velocity: -stats.maxSpeed * 0.5 };
          const d0 = land.distance(s.x, s.z);
          for (let t = 0; t < 10; t++) k = stepShip(k, { th: 1, ru: 0, f: 0 }, stats, land);
          expect(land.distance(k.x, k.z), `${port.key} heading`).toBeGreaterThanOrEqual(Math.min(d0, 400) - 1);
        }
      }
    }
  });

  it("new players spawn at a random starter port", () => {
    const w = new World({ land, rng: Math.random });
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const p = w.createPlayer({ id: `n${i}`, name: `n${i}`, shipType: "sloop" });
      expect(land.distance(p.x, p.z)).toBeGreaterThan(PORT_SPAWN_MIN_WATER);
      const near = STARTER_PORTS.find((sp) => metricDist(p.x, p.z, sp.spawn.x, sp.spawn.z) < 300);
      expect(near).toBeDefined();
      seen.add(near!.key);
    }
    expect(seen.size).toBe(STARTER_PORTS.length);
  });

  it("migration: old-world and on-land records move to a starter port and keep gold, ship and cargo", () => {
    const w = new World({ land, rng: Math.random });
    const base = {
      shipType: "galleon",
      gold: 12345,
      hp: 77,
      maxHp: 300,
      cargoUsed: 42,
      cargoCapacity: 100,
      damage: 33,
      cannonCount: 6,
    };
    const old = w.restorePlayer({ id: "old", name: "old", ...base, x: 4321, z: 1234 }); // no worldVersion (10000² torus)
    const madrid = w.restorePlayer({ id: "mad", name: "mad", ...base, x: xOfLon(-3.7), z: zOfLat(40.42), worldVersion: WORLD_VERSION });
    for (const p of [old, madrid]) {
      expect(land.distance(p.x, p.z)).toBeGreaterThan(PORT_SPAWN_MIN_WATER);
      expect(STARTER_PORTS.some((sp) => metricDist(p.x, p.z, sp.spawn.x, sp.spawn.z) < 300)).toBe(true);
      expect(p.worldVersion).toBe(WORLD_VERSION);
      expect(p.gold).toBe(12345);
      expect(p.shipType).toBe("galleon");
      expect(p.hp).toBe(77);
      expect(p.maxHp).toBe(300);
      expect(p.cargoUsed).toBe(42);
      expect(p.cargoCapacity).toBe(100);
    }
    // A valid record at sea stays put.
    const pr = portByKey("port_royal")!;
    const ok = w.restorePlayer({ id: "ok", name: "ok", ...base, x: pr.dock.x, z: pr.dock.z, worldVersion: WORLD_VERSION });
    expect(ok.x).toBeCloseTo(pr.dock.x, 6);
    expect(ok.z).toBeCloseTo(pr.dock.z, 6);
    expect(needsRelocation({ x: pr.dock.x, z: pr.dock.z, worldVersion: WORLD_VERSION }, land)).toBe(false);
    expect(needsRelocation({ x: pr.x, z: pr.z, worldVersion: WORLD_VERSION }, land)).toBe(true); // the town is on land
    expect(needsRelocation({ x: pr.dock.x, z: pr.dock.z }, land)).toBe(true);
  });
});
