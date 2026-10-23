/**
 * `?netdebug=1` own-ship netcode overlay (bug 2026-10-23, own ship jumping by km).
 *
 * Off unless the page URL has `netdebug=1` (e.g. https://piratetradewars.com/?netdebug=1). Then it
 * draws a small fixed text box (plain DOM, no React, pointer-events none) in the top-left corner,
 * refreshed 4x a second, and logs every own-ship correction above LOG_THRESHOLD units to the
 * console as `[netdebug] correction ...`.
 *
 * What it shows:
 *  - corr: reconciliation corrections > 1 unit (~100 m) in the last 10 s / total, the largest in the
 *    last 10 s and since load (units and km). With the 2026-10-23 fix this stays ~0 on open water;
 *    near coasts a few small ones are expected while land tiles are still loading.
 *  - snaps: hard snaps (correction > SNAP_ERROR_DISTANCE = 15 km).
 *  - snap/s: snapshots per second received (20 expected).
 *  - ack stalls: snapshots in the last 10 s whose `a` did not advance while inputs were pending,
 *    i.e. the server's queue for us ran dry (uplink jitter / TCP stall). Harmless since the fix (the
 *    server holds the ship), but a high count means a bad uplink.
 *  - pending: unacked inputs (≈ RTT + server queue depth, in 50 ms ticks); rtt: smoothed ping RTT.
 *  - socket closes: WebSocket drops since load (each reconnect re-spawns the ship at the server's
 *    position, which is a jump the correction counter does not see).
 *
 * Framework-free apart from `document`/`location`; installNetDebug is a no-op outside a browser.
 */
import type { NetClient } from "./netClient";
/** 1 world unit ≈ 100 m (shared/world/geo.ts; same as lib/nav.ts METERS_PER_UNIT). */
const METERS_PER_UNIT = 100;

/** Corrections above this (world units) are logged to the console. */
export const LOG_THRESHOLD = 5;
const WINDOW_MS = 10_000;

/** True if the URL query string enables the overlay. */
export function netDebugEnabled(search: string): boolean {
  return /(?:^|[?&])netdebug=1(?:&|$)/.test(search);
}

/** Rolling counters fed by the predictor hook and snapshots; pure (unit-tested). */
export class NetDebugStats {
  private corr: { t: number; d: number }[] = [];
  private snaps: number[] = [];
  private stalls: number[] = [];
  totalCorrections = 0;
  maxEver = 0;
  private lastAck = -1;

  onCorrection(t: number, dist: number): void {
    if (dist <= 1) return;
    this.corr.push({ t, d: dist });
    this.totalCorrections++;
    if (dist > this.maxEver) this.maxEver = dist;
  }

  onSnapshot(t: number, ack: number, pending: number): void {
    this.snaps.push(t);
    if (ack === this.lastAck && pending > 0) this.stalls.push(t);
    this.lastAck = ack;
  }

  private prune(now: number): void {
    const cut = now - WINDOW_MS;
    while (this.corr.length && this.corr[0].t < cut) this.corr.shift();
    while (this.snaps.length && this.snaps[0] < now - 1000) this.snaps.shift();
    while (this.stalls.length && this.stalls[0] < cut) this.stalls.shift();
  }

  summary(now: number): { recent: number; maxRecent: number; snapsPerSec: number; ackStalls: number } {
    this.prune(now);
    let maxRecent = 0;
    for (const c of this.corr) if (c.d > maxRecent) maxRecent = c.d;
    return { recent: this.corr.length, maxRecent, snapsPerSec: this.snaps.length, ackStalls: this.stalls.length };
  }
}

const km = (u: number) => `${((u * METERS_PER_UNIT) / 1000).toFixed(1)} km`;

/** Install the overlay if `?netdebug=1`; returns an uninstall function (no-op when disabled). */
export function installNetDebug(net: NetClient): () => void {
  const g = globalThis as any;
  if (!g.document || !g.location || !netDebugEnabled(String(g.location.search ?? ""))) return () => {};
  const stats = new NetDebugStats();
  const box = g.document.createElement("div");
  box.setAttribute("data-netdebug", "1");
  box.style.cssText =
    "position:fixed;top:4px;left:4px;z-index:99999;pointer-events:none;font:11px/1.35 monospace;" +
    "white-space:pre;color:#0f0;background:rgba(0,0,0,0.65);padding:4px 6px;border-radius:3px";
  (g.document.body ?? g.document.documentElement).appendChild(box);

  net.predictor.onCorrection = (dist, ack, pending) => {
    const t = net.now();
    stats.onCorrection(t, dist);
    if (dist > LOG_THRESHOLD) {
      console.warn(`[netdebug] correction ${dist.toFixed(1)} u (${km(dist)}) ack=${ack} pending=${pending} snaps=${net.predictor.snaps}`);
    }
  };
  const offSelf = net.on("self", () => stats.onSnapshot(net.now(), net.lastAck, net.predictor.pending.length));
  // A reconnect re-spawns the prediction from the server state (no correction is reported for it),
  // so count socket closes separately: a reconnect while sailing is a jump of its own.
  let closes = 0;
  const offClose = net.on("close", (willReconnect) => {
    closes++;
    console.warn(`[netdebug] socket closed (reconnect: ${willReconnect})`);
  });

  const timer = setInterval(() => {
    const s = stats.summary(net.now());
    box.textContent =
      `netdebug  corr>100m 10s: ${s.recent}  total: ${stats.totalCorrections}\n` +
      `max 10s: ${s.maxRecent.toFixed(1)} u (${km(s.maxRecent)})  ever: ${km(stats.maxEver)}  snaps: ${net.predictor.snaps}\n` +
      `snap/s: ${s.snapsPerSec}  ack stalls 10s: ${s.ackStalls}  pending: ${net.predictor.pending.length}  rtt: ${Math.round(net.clock.rtt)} ms  socket closes: ${closes}`;
  }, 250);

  return () => {
    clearInterval(timer);
    offSelf();
    offClose();
    net.predictor.onCorrection = null;
    box.remove();
  };
}
