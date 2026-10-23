/**
 * Port seeding and markets (card W4, WORLD_SPEC §5). Redis-free logic over a small store interface
 * so it can be unit tested with an in-memory fake (`__tests__/ports.test.ts`); `redisStorage`
 * implements the interface for real.
 *
 * - `seedPorts`: when the stored `portsVersion` differs from `PORTS_VERSION` (the ports hash in
 *   shared/world/versions.json), the `ports` hash is replaced by `PORTS` (shared/world/ports.ts) and
 *   every port's goods (`port:<id>:goods`) are deleted; `ensurePortGoods` then regenerates them.
 *   Port ids are reused across versions, so stale goods must not survive a re-seed.
 * - `seedGoods` (New Horizons phase 1): every GOODS entry missing from the `goods` hash is written BY ID at
 *   boot (it used to seed only an empty hash, so the live server would never have got new goods). Existing
 *   ids are left alone, so player inventories (keyed by goodId) stay valid.
 * - Prices, stock and `notSold` come from the market model (shared/world/goodMarkets.ts): cheap and
 *   plentiful near a good's sources, dearer with sea-lane distance, dear and scarce where it is wanted;
 *   exotic goods are not sold away from their sources. `ensurePortGoods` also adds rows for goods a port
 *   lacks (new goods on an existing port), and `updatePortMarkets` re-syncs `notSold` with the model.
 */
import { PORTS, PORTS_VERSION, type GamePort } from "@shared/world/ports";
import { isSoldAt, portGoodPrice, portGoodStock } from "@shared/world/goodMarkets";
import { GOODS, type GoodDef } from "@shared/gameConstants";

export interface PortGoodRow {
  portId: number;
  goodId: number;
  currentPrice: number;
  stock: number;
  /** The port doesn't sell this good (it still buys it). Omitted when it does. */
  notSold?: boolean;
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
  /** Write one good under its own id (hset goods <id>) and keep `good:next_id` >= the id. */
  putGood(good: GoodRow): Promise<void>;
  getPortGoods(portId: number): Promise<{ goodId: number; stock: number; currentPrice: number; notSold?: boolean }[]>;
  createPortGood(row: PortGoodRow): Promise<unknown>;
  updatePortGoodPrice(portId: number, goodId: number, price: number): Promise<void>;
  updatePortGoodStock(portId: number, goodId: number, stock: number): Promise<void>;
  /** Set or clear a row's `notSold` flag. */
  updatePortGoodNotSold(portId: number, goodId: number, notSold: boolean): Promise<void>;
}

/** Write every catalogue good whose id is missing from the store. Returns the ids it added. */
export async function seedGoods(store: Pick<PortStore, "getGoods" | "putGood">, catalogue: readonly GoodDef[] = GOODS): Promise<number[]> {
  const have = new Set((await store.getGoods()).map((g) => g.id));
  const added: number[] = [];
  for (const g of catalogue) {
    if (have.has(g.id)) continue;
    await store.putGood({ id: g.id, name: g.name, basePrice: g.basePrice, fluctuation: g.fluctuation });
    added.push(g.id);
  }
  if (added.length) console.log(`[goods] seeded ${added.length} missing goods (ids ${added.join(", ")})`);
  return added;
}

function newRow(port: GamePort, good: GoodRow, rng: () => number): PortGoodRow {
  const sold = isSoldAt(port, good.name);
  return {
    portId: port.id,
    goodId: good.id,
    currentPrice: portGoodPrice(port, good, rng),
    stock: portGoodStock(port, good.name, rng),
    ...(sold ? {} : { notSold: true }),
    updatedAt: new Date(),
  };
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

/** Give every port a row for every good (a fresh market for a port without goods, and the missing rows
 *  for goods added since); restock low goods that the port sells. */
export async function ensurePortGoods(store: PortStore, rng: () => number = Math.random): Promise<void> {
  const goods = await store.getGoods();
  for (const port of await store.getPorts()) {
    const portGoods = await store.getPortGoods(port.id);
    const have = new Set(portGoods.map((pg) => pg.goodId));
    for (const good of goods) if (!have.has(good.id)) await store.createPortGood(newRow(port, good, rng));
    for (const pg of portGoods) {
      if (pg.stock >= RESTOCK_BELOW || pg.notSold) continue;
      const good = goods.find((g) => g.id === pg.goodId);
      await store.updatePortGoodStock(port.id, pg.goodId, portGoodStock(port, good?.name ?? "", rng, true));
    }
  }
}

/** The periodic market move: new prices (model factor + fluctuation), `notSold` re-synced with the model,
 *  and restocks of goods the port sells. */
export async function updatePortMarkets(store: PortStore, rng: () => number = Math.random): Promise<void> {
  const goods = await store.getGoods();
  for (const port of await store.getPorts()) {
    const portGoods = await store.getPortGoods(port.id);
    if (portGoods.length === 0) continue; // ensurePortGoods creates them
    for (const pg of portGoods) {
      const good = goods.find((g) => g.id === pg.goodId);
      if (!good) continue;
      await store.updatePortGoodPrice(port.id, pg.goodId, portGoodPrice(port, good, rng));
      const notSold = !isSoldAt(port, good.name);
      if (notSold !== !!pg.notSold) await store.updatePortGoodNotSold(port.id, pg.goodId, notSold);
      if (!notSold && pg.stock < RESTOCK_BELOW) await store.updatePortGoodStock(port.id, pg.goodId, portGoodStock(port, good.name, rng, true));
    }
  }
}
