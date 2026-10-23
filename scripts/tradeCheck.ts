/**
 * Trade round trip for the bot test (2026-10-23; docs/netcode/PROTOCOL.md "Trading").
 *
 * One extra player joins, sends no input (so it stays at its port spawn), and against the nearest dock:
 *   1. sends TWO `trade` buys of 1 unit of the cheapest good at once (ref 1, 2) → both `tradeResult ok`,
 *      gold down by exactly 2 × price, 2 aboard with avgPaid = price (the per-player queue);
 *   2. sells 1 with a too-high `expectedPrice` → `price_changed`, nothing changes;
 *   3. `sellAll` → ok, hold empty, gold = start − 2 × buy + 2 × sell (the spread);
 *   4. `sellAll` again → refused `empty_hold`.
 * If the spawn is outside the dock radius (`too_far`) the check is reported as skipped, not failed.
 */
import WebSocket from "ws";
import { nearestDockPort, PORTS } from "../shared/world/ports";

export interface TradeCheckResult {
  ran: boolean;
  skipped?: string;
  failures: string[];
}

export async function tradeRoundTrip(wsUrl: string, name: string, timeoutMs = 15000): Promise<TradeCheckResult> {
  const httpBase = wsUrl.replace(/^ws/, "http").replace(/\/game-ws$/, "");
  const failures: string[] = [];
  const ws = new WebSocket(wsUrl);
  const inbox: any[] = [];
  let waiters: (() => void)[] = [];
  ws.on("message", (d) => { try { inbox.push(JSON.parse(d.toString())); } catch { /* ignore */ } waiters.forEach((w) => w()); waiters = []; });
  const next = (pred: (m: any) => boolean, ms = timeoutMs) => new Promise<any>((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
      if (Date.now() - t0 > ms) return reject(new Error("timeout"));
      waiters.push(check);
      setTimeout(check, 200);
    };
    check();
  });
  const send = (m: object) => ws.send(JSON.stringify(m));
  try {
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    send({ type: "connect", name, shipType: "sloop" });
    await next((m) => m.type === "connected");
    const snap = await next((m) => m.t === "s" && m.me);
    const { x, z } = snap.me;
    const startGold: number = snap.me.gold;
    const near = nearestDockPort(x, z, PORTS);
    if (!near) return { ran: false, skipped: "no ports", failures };
    const portId = near.port.id;
    const goods: any[] = await (await fetch(`${httpBase}/api/ports/${portId}/goods`)).json();
    const g = goods.filter((r) => r.buyPrice != null && r.stock >= 2).sort((a, b) => a.buyPrice - b.buyPrice)[0];
    if (!g) return { ran: false, skipped: "no good with stock", failures };
    if (typeof g.sellPrice !== "number" || g.sellPrice >= g.buyPrice) failures.push(`trade: no spread (buy ${g.buyPrice}, sell ${g.sellPrice})`);

    send({ type: "trade", portId, action: "buy", goodId: g.goodId, quantity: 1, ref: 1, expectedPrice: g.buyPrice });
    send({ type: "trade", portId, action: "buy", goodId: g.goodId, quantity: 1, ref: 2, expectedPrice: g.buyPrice });
    const r1 = await next((m) => m.type === "tradeResult" && m.ref === 1);
    if (!r1.ok && r1.code === "too_far") return { ran: false, skipped: `spawned ${Math.round(near.distance)} from the dock`, failures };
    const r2 = await next((m) => m.type === "tradeResult" && m.ref === 2);
    if (!r1.ok || !r2.ok) failures.push(`trade: concurrent buys refused (${r1.code}, ${r2.code})`);
    const row = (r2.inventory as any[]).find((i) => i.goodId === g.goodId);
    if (!row || row.quantity !== 2) failures.push(`trade: expected 2 aboard after two buys, got ${row?.quantity}`);
    if (row && row.avgPaid !== g.buyPrice) failures.push(`trade: avgPaid ${row.avgPaid} != ${g.buyPrice}`);
    if (r2.gold !== startGold - 2 * g.buyPrice) failures.push(`trade: gold ${r2.gold} after two buys, expected ${startGold - 2 * g.buyPrice}`);

    send({ type: "trade", portId, action: "sell", goodId: g.goodId, quantity: 1, ref: 3, expectedPrice: g.sellPrice + 50 });
    const r3 = await next((m) => m.type === "tradeResult" && m.ref === 3);
    if (r3.ok || r3.code !== "price_changed") failures.push(`trade: expectedPrice guard did not refuse (${r3.ok ? "ok" : r3.code})`);

    send({ type: "sellAll", portId, ref: 4, lines: [{ goodId: g.goodId, quantity: 2, expectedPrice: g.sellPrice }] });
    const r4 = await next((m) => m.type === "tradeResult" && m.ref === 4);
    if (!r4.ok) failures.push(`trade: sellAll refused (${r4.code}: ${r4.message})`);
    else {
      if (r4.inventory.length !== 0 || r4.cargoUsed !== 0) failures.push("trade: hold not empty after sellAll");
      const want = startGold - 2 * g.buyPrice + 2 * g.sellPrice;
      if (r4.gold !== want) failures.push(`trade: gold ${r4.gold} after sellAll, expected ${want}`);
    }
    send({ type: "sellAll", portId, ref: 5 });
    const r5 = await next((m) => m.type === "tradeResult" && m.ref === 5);
    if (r5.ok || r5.code !== "empty_hold") failures.push(`trade: second sellAll should be empty_hold, got ${r5.ok ? "ok" : r5.code}`);
    return { ran: true, failures };
  } catch (e) {
    failures.push(`trade: ${(e as Error).message}`);
    return { ran: true, failures };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}
