/**
 * Port seeding and markets (card W4, WORLD_SPEC §5). Redis-free logic over a small store interface
 * so it can be unit tested with an in-memory fake (`__tests__/ports.test.ts`); `redisStorage`
 * implements the interface for real.
 *
 * - `seedPorts`: when the stored `portsVersion` differs from `PORTS_VERSION` (the ports hash in
 *   shared/world/versions.json), the `ports` hash is replaced by `PORTS` (shared/world/ports.ts) and
 *   every port's goods (`port:<id>:goods`) are deleted; `ensurePortGoods` then regenerates them.
 *   Port ids are reused across versions, so stale goods must not survive a re-seed.
 * - Goods (the GOODS catalogue) are unchanged, so player inventories (by goodId) stay valid.
 * - Prices and stock use the regional market profile (`portGoodPrice` / `portGoodStock`): local
 *   specialities are cheap and plentiful, goods in demand are dear and scarce.
 */
import { PORTS, PORTS_VERSION, portGoodPrice, portGoodStock, type GamePort } from "@shared/world/ports";

export interface PortGoodRow {
  portId: number;
  goodId: number;
  currentPrice: number;
  stock: number;
  updatedAt: Date;
}

export interface GoodRow {
  id: number;
  name: string;
  basePrice: number;
  fluctuation: number;
}

/** The storage surface the seeding needs (implemented by RedisStorage). */
export interface PortStore {
  getPortsVersion(): Promise<string | null>;
  /** Atomically replace the `ports` hash with `ports`, delete the goods of every old and new port
   *  id, and store `version` as the new portsVersion. */
  replacePorts(ports: readonly GamePort[], version: string): Promise<void>;
  getPorts(): Promise<GamePort[]>;
  getGoods(): Promise<GoodRow[]>;
  getPortGoods(portId: number): Promise<{ goodId: number; stock: number; currentPrice: number }[]>;
  createPortGood(row: PortGoodRow): Promise<unknown>;
  updatePortGoodPrice(portId: number, goodId: number, price: number): Promise<void>;
  updatePortGoodStock(portId: number, goodId: number, stock: number): Promise<void>;
}

/** Below this stock a good is replenished (on boot and on each price update). */
export const RESTOCK_BELOW = 10;

/** Re-seed the ports when the stored version is stale. Returns true if it re-seeded. */
export async function seedPorts(store: PortStore, ports: readonly GamePort[] = PORTS, version: string = PORTS_VERSION): Promise<boolean> {
  const stored = await store.getPortsVersion();
  if (stored === version) return false;
  await store.replacePorts(ports, version);
  console.log(`[ports] seeded ${ports.length} ports (portsVersion ${stored ?? "none"} -> ${version})`);
  return true;
}

/** Give every port without goods a fresh market; restock low goods at the others. */
export async function ensurePortGoods(store: PortStore, rng: () => number = Math.random): Promise<void> {
  const goods = await store.getGoods();
  for (const port of await store.getPorts()) {
    const portGoods = await store.getPortGoods(port.id);
    if (portGoods.length === 0) {
      for (const good of goods) {
        await store.createPortGood({
          portId: port.id,
          goodId: good.id,
          currentPrice: portGoodPrice(port, good, rng),
          stock: portGoodStock(port, good.name, rng),
          updatedAt: new Date(),
        });
      }
      continue;
    }
    for (const pg of portGoods) {
      if (pg.stock >= RESTOCK_BELOW) continue;
      const good = goods.find((g) => g.id === pg.goodId);
      await store.updatePortGoodStock(port.id, pg.goodId, portGoodStock(port, good?.name ?? "", rng, true));
    }
  }
}

/** The periodic market move: new prices (regional factor + fluctuation) and restocks. */
export async function updatePortMarkets(store: PortStore, rng: () => number = Math.random): Promise<void> {
  const goods = await store.getGoods();
  for (const port of await store.getPorts()) {
    const portGoods = await store.getPortGoods(port.id);
    if (portGoods.length === 0) continue; // ensurePortGoods creates them
    for (const pg of portGoods) {
      const good = goods.find((g) => g.id === pg.goodId);
      if (!good) continue;
      await store.updatePortGoodPrice(port.id, pg.goodId, portGoodPrice(port, good, rng));
      if (pg.stock < RESTOCK_BELOW) await store.updatePortGoodStock(port.id, pg.goodId, portGoodStock(port, good.name, rng, true));
    }
  }
}
