/**
 * Test helper (New Horizons phase 1): writes a PRE-EXPANSION world into a local Redis, as the live server
 * has it today: the 27 old ports under the old portsVersion, the 8 original goods (ids 1-8), and an 8-row
 * market per port, plus a saved player whose hold has old goods. Boot the server on it afterwards to check
 * that the ports re-seed, goods 9-13 are added by id, and every port gets 13 rows.
 *
 *   REDIS_CONN_STRING=redis://localhost:6379/7 tsx scripts/market/seed-old-world.ts <old ports.json> <old portsVersion> [goods]
 *
 * New Horizons phase 2: the optional [goods] count (default 8) seeds the first N catalogue goods, e.g. 13 for the
 * phase 1 world (43 ports, goods 1-13), so the boot should add goods 14-16 and give every port 16 rows.
 *
 * Refuses non-local Redis URLs. Flushes the selected DB first.
 */
import fs from "node:fs";
import Redis from "ioredis";

const url = process.env.REDIS_CONN_STRING ?? "";
if (!/^redis:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\d+$/.test(url)) {
  console.error("seed-old-world: needs a local REDIS_CONN_STRING with an explicit DB index, e.g. redis://localhost:6379/7");
  process.exit(2);
}
const [portsFile, version, goodsArg] = process.argv.slice(2);
if (!portsFile || !version) {
  console.error("usage: seed-old-world.ts <old ports.json> <old portsVersion>");
  process.exit(2);
}
const oldPorts = JSON.parse(fs.readFileSync(portsFile, "utf8").replace(/^﻿/, "")) as { id: string }[];
const OLD_GOODS = [
  { id: 1, name: "Fish", basePrice: 10, fluctuation: 20 },
  { id: 2, name: "Wood", basePrice: 15, fluctuation: 10 },
  { id: 3, name: "Sugar", basePrice: 30, fluctuation: 25 },
  { id: 4, name: "Cotton", basePrice: 40, fluctuation: 20 },
  { id: 5, name: "Rum", basePrice: 50, fluctuation: 30 },
  { id: 6, name: "Tobacco", basePrice: 60, fluctuation: 35 },
  { id: 7, name: "Spices", basePrice: 80, fluctuation: 40 },
  { id: 8, name: "Silk", basePrice: 100, fluctuation: 50 },
  { id: 9, name: "Silver", basePrice: 140, fluctuation: 25 },
  { id: 10, name: "Gold", basePrice: 180, fluctuation: 25 },
  { id: 11, name: "Cacao", basePrice: 55, fluctuation: 30 },
  { id: 12, name: "Hides", basePrice: 25, fluctuation: 20 },
  { id: 13, name: "Wine", basePrice: 45, fluctuation: 25 },
].slice(0, Number(goodsArg ?? 8));

async function main() {
const r = new Redis(url);
await r.flushdb();
const tx = r.multi();
oldPorts.forEach((p, i) => tx.hset("ports", String(i + 1), JSON.stringify({ ...p, id: i + 1, key: p.id, y: 0 })));
tx.set("port:next_id", String(oldPorts.length));
tx.set("portsVersion", version);
for (const g of OLD_GOODS) tx.hset("goods", String(g.id), JSON.stringify(g));
tx.set("good:next_id", String(OLD_GOODS.length));
let rowId = 0;
oldPorts.forEach((_, i) => {
  const rows = OLD_GOODS.map((g) => ({ id: ++rowId, portId: i + 1, goodId: g.id, currentPrice: 999, stock: 77, updatedAt: new Date() }));
  tx.set(`port:${i + 1}:goods`, JSON.stringify(rows));
});
tx.set("port_good:next_id", String(rowId));
await tx.exec();
console.log(`seed-old-world: ${oldPorts.length} ports @ ${version}, ${OLD_GOODS.length} goods, ${rowId} market rows (price 999, stock 77)`);
await r.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });
