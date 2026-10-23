/**
 * Netcode bot load / smoke test (card N4). See docs/netcode/LOAD_TEST.md.
 *
 *   npx tsx scripts/bots.ts --bots 20 --duration 30 --url ws://localhost:5055/game-ws [--assert] [--json out.json]
 *
 * Each bot connects, registers, then sends `input` at 20 Hz (wandering pattern) and `ping` every 2 s,
 * while recording what the server sends back. Written strictly against docs/netcode/PROTOCOL.md and
 * shared/protocol.ts. Uses `ws`, `shared/*`, node built-ins, the real client Predictor
 * (client/src/lib/net/prediction.ts) and the server's land loader (same tiles as the server).
 *
 * Own-ship check (bug 2026-10-23): every bot predicts its own ship exactly like the browser does
 * (fixed 20 Hz steps, reconcile to `me` + replay unacked inputs) with the same land field as the
 * server, and records the size of every reconciliation correction after warmup. With identical
 * physics and land the correction must be ~0; `--assert` fails a bot whose largest correction
 * exceeds MAX_OWN_CORRECTION units (1 unit ~ 100 m).
 * Exit codes: 0 ok, 1 assertion failure, 2 usage / could not reach server.
 */
import WebSocket from "ws";
import { writeFileSync } from "node:fs";
import { SHIP_TYPES } from "../shared/gameConstants";
import { MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../shared/protocol";
import type { ShipInput } from "../shared/physics";
import { Predictor } from "../client/src/lib/net/prediction";
import { loadLandSync } from "../server/game/landLoader";

/** Largest own-ship reconciliation correction (world units) a bot may see after warmup. */
const MAX_OWN_CORRECTION = 1;
/** Same land tiles as the server (dev: client/public/world/land), loaded once for all bots. */
const LAND = loadLandSync(undefined, () => {}).field;

// ---------------------------------------------------------------- options
interface Opts {
  bots: number;
  url: string;
  duration: number;
  assert: boolean;
  json?: string;
  warmup: number;
}
function usage(msg: string): never {
  console.error(`bots: ${msg}\nusage: tsx scripts/bots.ts [--bots N=20] [--url ws://localhost:5055/game-ws] [--duration SEC=30] [--warmup SEC=3] [--assert] [--json out.json]`);
  process.exit(2);
}
function parseArgs(argv: string[]): Opts {
  const o: Opts = { bots: 20, url: "ws://localhost:5055/game-ws", duration: 30, assert: false, warmup: 3 };
  const num = (name: string, v: string | undefined): number => {
    const n = Number(v);
    if (!v || !Number.isFinite(n) || n <= 0) usage(`--${name} needs a positive number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (): string | undefined => argv[++i];
    if (a === "--bots") o.bots = Math.floor(num("bots", val()));
    else if (a === "--url") o.url = val() ?? usage("--url needs a value");
    else if (a === "--duration") o.duration = num("duration", val());
    else if (a === "--warmup") o.warmup = num("warmup", val());
    else if (a === "--json") o.json = val() ?? usage("--json needs a path");
    else if (a === "--assert") o.assert = true;
    else if (a === "--cluster") console.warn("note: --cluster is ignored (server picks spawn positions)");
    else usage(`unknown option ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------- bot
const INPUT_HZ = 20;
const CONNECT_TIMEOUT_MS = 15000;

interface BotStats {
  name: string;
  playerId: string | null;
  eid: number | null;
  connected: boolean;
  closedEarly: boolean;
  snapshots: number;
  bytes: number;
  firstSnapAt: number;
  lastSnapAt: number;
  maxGapMs: number; // after warmup
  gapSumMs: number;
  gapCount: number;
  maxEntRows: number;
  entSeen: Set<number>; // eids ever seen in `e`
  known: Map<number, string>; // eid -> player id (from `ent`, minus `gone`)
  rtts: number[];
  firstAck: number | null;
  lastAck: number | null;
  events: Record<string, number>;
  errors: string[];
  violations: string[];
  /** Own-ship prediction: reconciles after warmup, corrections > 1 unit, largest correction. */
  reconciles: number;
  corrections: number;
  maxCorrection: number;
}

class Bot {
  s: BotStats;
  ws!: WebSocket;
  private inputTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private connectTimer?: NodeJS.Timeout;
  private rudder: -1 | 0 | 1 = 0;
  private rudderUntil = 0;
  private stopped = false;
  private warmupEndsAt = Infinity;
  private readonly pred = new Predictor(LAND);
  private throttle: 0 | 1 = 1;
  private throttleUntil = 0;
  private sunk = false;

  constructor(name: string, private opts: Opts, private onSocketError: (e: Error) => void) {
    this.s = {
      name, playerId: null, eid: null, connected: false, closedEarly: false, snapshots: 0, bytes: 0,
      firstSnapAt: 0, lastSnapAt: 0, maxGapMs: 0, gapSumMs: 0, gapCount: 0, maxEntRows: 0,
      entSeen: new Set(), known: new Map(), rtts: [], firstAck: null, lastAck: null,
      events: {}, errors: [], violations: [], reconciles: 0, corrections: 0, maxCorrection: 0,
    };
  }

  start(): void {
    this.ws = new WebSocket(this.opts.url);
    this.connectTimer = setTimeout(() => {
      if (!this.s.connected) this.s.errors.push(`no "connected" within ${CONNECT_TIMEOUT_MS} ms`);
    }, CONNECT_TIMEOUT_MS);
    this.ws.on("open", () => {
      this.ws.send(JSON.stringify({ type: "connect", name: this.s.name, shipType: SHIP_TYPES.SLOOP }));
    });
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
    this.ws.on("error", (e: Error) => { this.s.errors.push(`socket error: ${e.message || (e as Error & { code?: string }).code || e}`); this.onSocketError(e); });
    this.ws.on("close", () => {
      if (!this.stopped) this.s.closedEarly = true;
      this.clearTimers();
    });
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    try { this.ws.close(); } catch { /* ignore */ }
  }

  private clearTimers(): void {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
  }

  private onMessage(data: WebSocket.RawData): void {
    const raw = data.toString();
    const now = performance.now();
    let m: any;
    try { m = JSON.parse(raw); } catch { this.s.violations.push("non-JSON frame"); return; }
    if (!m || typeof m !== "object") { this.s.violations.push("non-object frame"); return; }
    const kind: string = m.t ?? m.type;
    this.s.events[kind] = (this.s.events[kind] ?? 0) + 1;
    switch (kind) {
      case "connected":
        this.s.connected = true;
        this.s.playerId = typeof m.playerId === "string" ? m.playerId : null;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.beginSending();
        break;
      case "s":
        this.s.bytes += Buffer.byteLength(raw);
        this.onSnapshot(m, now);
        break;
      case "ent":
        this.s.bytes += Buffer.byteLength(raw);
        if (typeof m.eid === "number" && typeof m.id === "string") this.s.known.set(m.eid, m.id);
        else this.s.violations.push("malformed ent");
        for (const k of ["gold", "cargo", "inventory", "cargoUsed", "cargoCapacity"]) {
          if (k in m) this.s.violations.push(`ent leaks private field ${k}`);
        }
        break;
      case "gone":
        this.s.bytes += Buffer.byteLength(raw);
        this.s.known.delete(m.eid);
        break;
      case "pong":
        if (typeof m.c === "number") this.s.rtts.push(Date.now() - m.c);
        break;
      case "error":
      case "nameError":
        { const msg = `server ${kind}: ${m.message}`; if (this.s.errors.length < 5 && !this.s.errors.includes(msg)) this.s.errors.push(msg); }
        break;
      default:
        this.s.bytes += Buffer.byteLength(raw);
    }
  }

  private onSnapshot(m: any, now: number): void {
    const s = this.s;
    s.snapshots++;
    if (s.firstSnapAt === 0) {
      s.firstSnapAt = now;
      this.warmupEndsAt = now + this.opts.warmup * 1000;
    } else if (now >= this.warmupEndsAt) {
      const gap = now - s.lastSnapAt;
      s.maxGapMs = Math.max(s.maxGapMs, gap);
      s.gapSumMs += gap;
      s.gapCount++;
    }
    s.lastSnapAt = now;
    if (typeof m.a === "number") {
      if (s.firstAck === null) s.firstAck = m.a;
      s.lastAck = m.a;
    }
    // `me` is the receiver's own private state: must be an object. Own eid helps symmetry checks.
    if (!m.me || typeof m.me !== "object" || Array.isArray(m.me)) s.violations.push("snapshot.me missing / not an object");
    else {
      if (typeof m.me.eid === "number") s.eid = m.me.eid;
      // Own-ship prediction check. Sinking legitimately stops the ship server-side: stop measuring.
      if (m.me.sunk) this.sunk = true;
      const d = this.pred.reconcile(m.me, typeof m.a === "number" ? m.a : -1);
      if (!this.sunk && now >= this.warmupEndsAt) {
        s.reconciles++;
        if (d > 1) s.corrections++;
        if (d > s.maxCorrection) s.maxCorrection = d;
      }
    }
    // `e` rows must be plain arrays of 7 numbers: [eid,x,z,r,v,hp,flags]. Objects would carry private fields.
    if (!Array.isArray(m.e)) { s.violations.push("snapshot.e not an array"); return; }
    s.maxEntRows = Math.max(s.maxEntRows, m.e.length);
    for (const row of m.e) {
      if (!Array.isArray(row) || row.length !== 7 || row.some((v: unknown) => typeof v !== "number")) {
        if (s.violations.length < 20) s.violations.push(`bad entity row ${JSON.stringify(row).slice(0, 80)}`);
        continue;
      }
      s.entSeen.add(row[0]);
    }
  }

  private beginSending(): void {
    // A 100 Hz "frame" loop driving the real Predictor, like the browser's useFrame: it runs fixed
    // 20 Hz steps from an accumulator (≤ 5 per frame), sending one input per step, starting after
    // the first snapshot initialized it.
    let last = performance.now();
    this.inputTimer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      this.pred.advance(Math.min(dt, 0.25), this.nextInput(now), (msg) => this.send(msg));
    }, 10);
    this.pingTimer = setInterval(() => this.send({ t: "ping", c: Date.now() }), PING_INTERVAL_MS);
    this.send({ t: "ping", c: Date.now() });
  }

  private nextInput(now: number): ShipInput {
    if (now >= this.rudderUntil) {
      const r = Math.random();
      this.rudder = r < 0.4 ? 0 : r < 0.7 ? 1 : -1;
      this.rudderUntil = now + 500 + Math.random() * 2500;
    }
    if (now >= this.throttleUntil) {
      this.throttle = Math.random() < 0.9 ? 1 : 0;
      this.throttleUntil = now + 300 + Math.random() * 2000;
    }
    return { th: this.throttle, ru: this.rudder, f: Math.random() < 0.01 ? 1 : 0 };
  }

  private send(obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------- reporting
interface BotReport {
  name: string;
  connected: boolean;
  snapsPerSec: number;
  kbPerSec: number;
  maxGapMs: number;
  avgGapMs: number;
  known: number;
  seen: number;
  maxRows: number;
  rttAvgMs: number | null;
  rttMaxMs: number | null;
  ackFirst: number | null;
  ackLast: number | null;
  ackAdvanced: boolean;
  events: Record<string, number>;
  errors: string[];
  violations: string[];
  ownReconciles: number;
  ownCorrections: number;
  ownMaxCorrection: number;
}

function report(b: Bot): BotReport {
  const s = b.s;
  const winSec = s.snapshots > 1 ? (s.lastSnapAt - s.firstSnapAt) / 1000 : 0;
  const rtt = s.rtts.length ? s.rtts : null;
  return {
    name: s.name,
    connected: s.connected,
    snapsPerSec: winSec ? +((s.snapshots - 1) / winSec).toFixed(2) : 0,
    kbPerSec: winSec ? +(s.bytes / 1024 / winSec).toFixed(2) : 0,
    maxGapMs: Math.round(s.maxGapMs),
    avgGapMs: s.gapCount ? Math.round(s.gapSumMs / s.gapCount) : 0,
    known: s.known.size,
    seen: s.entSeen.size,
    maxRows: s.maxEntRows,
    rttAvgMs: rtt ? Math.round(rtt.reduce((a, c) => a + c, 0) / rtt.length) : null,
    rttMaxMs: rtt ? Math.max(...rtt) : null,
    ackFirst: s.firstAck,
    ackLast: s.lastAck,
    ackAdvanced: s.firstAck !== null && s.lastAck !== null && s.lastAck > s.firstAck,
    events: s.events,
    errors: s.errors,
    violations: s.violations,
    ownReconciles: s.reconciles,
    ownCorrections: s.corrections,
    ownMaxCorrection: +s.maxCorrection.toFixed(3),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const runId = Math.random().toString(36).slice(2, 6);
  let sockErr: Error | null = null;
  const bots: Bot[] = [];
  for (let i = 0; i < opts.bots; i++) {
    const name = `bot${runId}_${i}`.slice(0, MAX_NAME_LENGTH);
    bots.push(new Bot(name, opts, (e) => { sockErr = sockErr ?? e; }));
  }
  console.log(`bots: ${opts.bots} -> ${opts.url}, ${opts.duration}s${opts.assert ? ", --assert" : ""}`);
  for (const b of bots) { b.start(); await sleep(25); }

  // If nothing can connect (server down) fail fast with a clear message.
  await sleep(2000);
  if (bots.every((b) => !b.s.connected) && (sockErr || bots.every((b) => b.s.closedEarly))) {
    const se = sockErr as (Error & { code?: string }) | null;
    const why = se ? (se.message || se.code || String(se)) : "connection closed";
    console.error(`bots: cannot reach server at ${opts.url}: ${why}\n` +
      "Is the server running? (npx tsx server/index.ts, needs REDIS_CONN_STRING; or use npm run test:bots)");
    bots.forEach((b) => b.stop());
    process.exit(2);
  }
  await sleep(Math.max(0, opts.duration * 1000 - 2000));

  // Visibility symmetry, measured before closing sockets (closing triggers `gone`).
  const byPid = new Map<string, Bot>();
  for (const b of bots) if (b.s.playerId) byPid.set(b.s.playerId, b);
  let pairs = 0, asym = 0;
  for (const a of bots) {
    if (!a.s.playerId) continue;
    for (const pid of a.s.known.values()) {
      const other = byPid.get(pid);
      if (!other || other === a) continue;
      pairs++;
      if (![...other.s.known.values()].includes(a.s.playerId)) asym++;
    }
  }
  bots.forEach((b) => b.stop());
  await sleep(200);

  const reports = bots.map(report);
  const connectedN = reports.filter((r) => r.connected).length;
  const avg = (f: (r: BotReport) => number) => reports.length ? reports.reduce((a, r) => a + f(r), 0) / reports.length : 0;
  const summary = {
    bots: opts.bots, connected: connectedN, durationSec: opts.duration,
    avgSnapsPerSec: +avg((r) => r.snapsPerSec).toFixed(2),
    avgKbPerSec: +avg((r) => r.kbPerSec).toFixed(2),
    worstGapMs: Math.max(0, ...reports.map((r) => r.maxGapMs)),
    avgKnown: +avg((r) => r.known).toFixed(2),
    maxKnown: Math.max(0, ...reports.map((r) => r.known)),
    visibilityPairs: pairs, asymmetricPairs: asym,
    asymmetryPct: pairs ? +((asym / pairs) * 100).toFixed(1) : 0,
    ownMaxCorrection: Math.max(0, ...reports.map((r) => r.ownMaxCorrection)),
    ownCorrections: reports.reduce((a, r) => a + r.ownCorrections, 0),
    ownReconciles: reports.reduce((a, r) => a + r.ownReconciles, 0),
  };

  console.log("\nname            conn snap/s  KB/s  maxGap avgGap known seen rows  rttAvg rttMax ack(first->last)  events");
  for (const r of reports) {
    const ev = Object.entries(r.events)
      .filter(([k]) => !["s", "ent", "gone", "pong", "welcome", "connected"].includes(k))
      .map(([k, v]) => `${k}:${v}`).join(",");
    console.log(
      `${r.name.padEnd(15)} ${(r.connected ? "y" : "N").padEnd(4)} ${String(r.snapsPerSec).padStart(6)} ${String(r.kbPerSec).padStart(5)} ` +
      `${String(r.maxGapMs).padStart(6)} ${String(r.avgGapMs).padStart(6)} ${String(r.known).padStart(5)} ${String(r.seen).padStart(4)} ${String(r.maxRows).padStart(4)} ` +
      `${String(r.rttAvgMs ?? "-").padStart(6)} ${String(r.rttMaxMs ?? "-").padStart(6)} ${`${r.ackFirst ?? "-"}->${r.ackLast ?? "-"}`.padEnd(17)} ${ev}`);
  }
  console.log("\nSUMMARY " + JSON.stringify(summary));

  // Assertions
  const failures: string[] = [];
  for (const r of reports) {
    if (!r.connected) failures.push(`${r.name}: never got "connected"`);
    else {
      if (r.snapsPerSec < 15) failures.push(`${r.name}: snapshot rate ${r.snapsPerSec}/s < 15`);
      if (r.maxGapMs > 1000) failures.push(`${r.name}: inter-snapshot gap ${r.maxGapMs} ms > 1000 after warmup`);
      if (!r.ackAdvanced) failures.push(`${r.name}: acked seq did not advance (${r.ackFirst} -> ${r.ackLast})`);
      if (r.ownMaxCorrection > MAX_OWN_CORRECTION) {
        failures.push(`${r.name}: own-ship correction ${r.ownMaxCorrection} units > ${MAX_OWN_CORRECTION} (${r.ownCorrections} of ${r.ownReconciles} snapshots)`);
      }
    }
    for (const e of r.errors) failures.push(`${r.name}: ${e}`);
    for (const v of r.violations.slice(0, 3)) failures.push(`${r.name}: protocol/privacy violation: ${v}`);
  }
  for (const b of bots) if (b.s.closedEarly) failures.push(`${b.s.name}: socket closed unexpectedly`);
  // Symmetric-ish visibility: allow transient mismatch (interest edge, join/leave in flight).
  if (pairs >= 10 && asym / pairs > 0.15) failures.push(`visibility asymmetry ${summary.asymmetryPct}% of ${pairs} pairs (tolerance 15%)`);

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify({ summary, bots: reports, failures }, null, 2));
    console.log(`wrote ${opts.json}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} assertion problem(s):`);
    for (const f of failures.slice(0, 40)) console.log("  - " + f);
  } else {
    console.log("\nall assertions pass");
  }
  process.exit(opts.assert && failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
