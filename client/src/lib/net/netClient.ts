/**
 * NetClient: the client's netcode hub (PROTOCOL §6, §7). Framework-free — React/Three code reads
 * from it inside `useFrame` and subscribes to its low-frequency events; it never imports React.
 *
 * Owns:
 *  - `conn`       Connection (WebSocket, backoff reconnect, pings)
 *  - `clock`      ServerClock (offset from snapshot `st`, RTT from pong)
 *  - `predictor`  own-ship prediction + reconciliation
 *  - `remote`     RemoteWorld (interpolation buffers + `ent`/`gone` metadata)
 *  - `balls`      BallSim (local cannonballs from `fire`, removed on `hit`/lifetime)
 *  - `gold`       latest gold rows (snapshot `g`, every 10th tick)
 *  - `me`         latest authoritative SelfState
 *
 *  - `land`       optional ClientLandTiles: its LandField is the predictor's land (coast collision
 *                 predicted like the server) and `frame` keeps the tiles around the ship loading
 *
 * Netcode messages (`s`, `ent`, `gone`, `fire`, `hit`, `sunk`, `splash`, `goldCollected`, `pong`) are handled
 * here; everything else (legacy `type` messages: connected, tradeSuccess, gameEnd, ...) is forwarded
 * to `onLegacyMessage` listeners. Times are local `now()` ms (performance.now by default).
 */
import { NEUTRAL_INPUT, type ShipKinematics } from "@shared/physics";
import {
  INTERP_DELAY_MS,
  type FireMessage,
  type GoldRow,
  type HitMessage,
  type InputMessage,
  type SelfState,
  type SnapshotMessage,
  type SunkMessage,
  type SplashMessage,
  type GoldCollectedMessage,
  type StandingState,
  parseStanding,
} from "@shared/protocol";
import type { ClientLandTiles } from "../world/landTiles";
import { ServerClock } from "./clock";
import { MAX_FRAME_DT_SEC, Predictor } from "./prediction";
import { RemoteWorld } from "./interpolation";
import { BallSim } from "./cannonballs";
import { Connection, type ConnectionOptions } from "./connection";
import { FireLatch, controlsToInput, type ControlState } from "./controls";

export interface NetEvents {
  /** Socket opened (fresh or after a reconnect). */
  open: () => void;
  /** Socket closed; `willReconnect` false after a deliberate disconnect. */
  close: (willReconnect: boolean) => void;
  error: (ev: unknown) => void;
  /** Any non-netcode message (legacy `type` messages). */
  legacy: (msg: any) => void;
  /** A snapshot updated `me` (fires at 20 Hz — throttle in the listener). */
  self: (me: SelfState) => void;
  /** First snapshot after (re)joining initialized the predictor. */
  spawned: (me: SelfState) => void;
  fire: (m: FireMessage, isMine: boolean) => void;
  hit: (m: HitMessage, isMe: boolean) => void;
  sunk: (m: SunkMessage, isMe: boolean) => void;
  /** NPC2: own faction standing changed (rep per faction, notoriety, bounty). */
  standing: (s: StandingState) => void;
  /** A cannonball hit land at (m.x, m.z) and was removed (render dust there). */
  splash: (m: SplashMessage) => void;
  goldCollected: (m: GoldCollectedMessage) => void;
  /** Gold rows changed (snapshot `g`). */
  gold: (rows: GoldRow[]) => void;
}

type Listeners = { [K in keyof NetEvents]: Set<NetEvents[K]> };

export interface NetClientOptions extends ConnectionOptions {
  /** Local clock in ms (default performance.now). Also used for ping `c`. */
  now?: () => number;
  /** Land tile cache for prediction (the app passes `clientLand`); none = open ocean + ice. */
  land?: ClientLandTiles | null;
}

export class NetClient {
  readonly clock = new ServerClock();
  readonly predictor: Predictor;
  readonly land: ClientLandTiles | null;
  readonly remote = new RemoteWorld();
  readonly balls = new BallSim();
  readonly conn: Connection;
  gold: GoldRow[] = [];
  me: SelfState | null = null;
  /** NPC2: own standing with the NPC factions (`standing` message); null until the server sends it. */
  standing: StandingState | null = null;
  myEid: number | null = null;
  /** snapshot `a`: -1 until the server applied our first input on this connection */
  lastAck = -1;
  lastTick = 0;
  hidden = false;
  /** Broadsides: keeps a quick Space/Q/E tap alive until a 20 Hz step has sent it (controls.ts). */
  private readonly fireLatch = new FireLatch();
  /** `now()` at the previous `frameNow` call (null = the next frame gets dt 0). */
  private lastFrameAt: number | null = null;
  readonly now: () => number;
  private readonly listeners: Listeners = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    legacy: new Set(),
    self: new Set(),
    spawned: new Set(),
    fire: new Set(),
    hit: new Set(),
    sunk: new Set(),
    standing: new Set(),
    splash: new Set(),
    goldCollected: new Set(),
    gold: new Set(),
  };
  private readonly sendInputFn = (m: InputMessage) => {
    this.conn.send(m);
  };

  constructor(options: NetClientOptions = {}) {
    const perf = (globalThis as any).performance;
    this.now = options.now ?? (perf && typeof perf.now === "function" ? () => perf.now() : () => Date.now());
    this.land = options.land ?? null;
    this.predictor = this.land ? new Predictor(this.land.field) : new Predictor();
    this.conn = new Connection(
      {
        onOpen: () => this.emit("open"),
        onClose: (r) => {
          // The server forgets our seq/inputs per connection and must re-bind us via `reconnect`;
          // stop predicting/sending until the next session's first snapshot.
          this.resetSession();
          this.emit("close", r);
        },
        onError: (e) => this.emit("error", e),
        onMessage: (m) => this.handleMessage(m),
      },
      { ...options, now: this.now },
    );
  }

  on<K extends keyof NetEvents>(event: K, fn: NetEvents[K]): () => void {
    (this.listeners[event] as Set<NetEvents[K]>).add(fn);
    return () => {
      (this.listeners[event] as Set<NetEvents[K]>).delete(fn);
    };
  }

  private emit<K extends keyof NetEvents>(event: K, ...args: Parameters<NetEvents[K]>): void {
    (this.listeners[event] as Set<(...a: any[]) => void>).forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[net] ${event} listener failed`, err);
      }
    });
  }

  // ------------------------------------------------------------------ transport

  connect(): void {
    this.conn.open();
  }

  disconnect(): void {
    this.conn.close();
  }

  send(msg: unknown): boolean {
    return this.conn.send(msg);
  }

  /**
   * Forget the current world (socket closed, `connected`, `reconnected`). The server resets seq
   * tracking on every connected/reconnected (N2 clarifications), so the input seq restarts at 0.
   */
  resetSession(): void {
    this.predictor.reset();
    this.remote.clear();
    this.balls.clear();
    this.gold = [];
    this.me = null;
    this.standing = null;
    this.myEid = null;
    this.lastAck = -1;
    this.lastTick = 0;
  }

  // ------------------------------------------------------------------ per-frame

  /**
   * Per-frame entry point used by the game (Player.tsx useFrame): measures the frame delta on this
   * client's own clock (`now()`, performance.now in the browser) and calls `frame`.
   *
   * Do NOT feed R3F's `delta` instead: R3F derives it from the shared THREE.Clock (`getDelta()` at
   * frame start), and any `clock.getElapsedTime()` / `getDelta()` call elsewhere in a frame moves
   * that clock's reference point, silently shortening the next delta. That starved prediction to
   * ~7.7 inputs/s at 9 fps in the N3 play-test (should be 20/s).
   */
  frameNow(controls: Partial<ControlState>): void {
    const now = this.now();
    const dtSec = this.lastFrameAt === null ? 0 : Math.max(0, now - this.lastFrameAt) / 1000;
    this.lastFrameAt = now;
    this.frame(dtSec, controls);
  }

  /**
   * Advance by an explicit frame delta (seconds) with the current combined controls. Runs fixed-step
   * prediction (sending one `input` per 20 Hz step) and expires balls. The delta is clamped to
   * MAX_FRAME_DT_SEC (5 ticks); time beyond that in one hitch is dropped on purpose — the server
   * extrapolates the gap with our last input (see MAX_STEPS_PER_FRAME in prediction.ts).
   */
  frame(dtSec: number, controls: Partial<ControlState>): void {
    const now = this.now();
    this.balls.expire(this.clock.serverNow(now));
    if (this.land && this.predictor.initialized) this.land.update(this.predictor.cur.x, this.predictor.cur.z);
    if (this.hidden || this.me?.sunk) this.fireLatch.reset();
    if (this.hidden) return;
    const raw = this.me?.sunk ? NEUTRAL_INPUT : controlsToInput(controls);
    const input = raw.f === this.fireLatch.peek(raw.f) ? raw : { ...raw, f: this.fireLatch.peek(raw.f) };
    const steps = this.predictor.advance(Math.min(dtSec, MAX_FRAME_DT_SEC), input, this.sendInputFn);
    if (this.predictor.initialized) this.fireLatch.commit(raw.f, steps > 0);
    else this.fireLatch.reset(); // no stale press fires on the first step after (re)joining
  }

  /**
   * Tab visibility. When hidden we send one neutral input (the server re-uses the last input when
   * its queue is empty, so this makes the ship coast to a stop) and stop sending.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.predictor.sendOnly(NEUTRAL_INPUT, this.sendInputFn);
    } else {
      this.predictor.acc = 0;
      this.lastFrameAt = null; // don't credit the hidden period to the first visible frame
    }
  }

  /** Own ship as it should be drawn this frame. */
  getOwnRenderState(out?: ShipKinematics): ShipKinematics {
    return this.predictor.getRenderState(out);
  }

  /** Server time (ms) at which remote entities are rendered this frame. */
  remoteRenderTime(): number {
    return this.clock.serverNow(this.now()) - INTERP_DELAY_MS;
  }

  // ------------------------------------------------------------------ inbound

  handleMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    const now = this.now();
    switch (msg.t) {
      case "s":
        this.onSnapshot(msg as SnapshotMessage, now);
        return;
      case "ent":
        if (msg.eid === this.myEid) return;
        this.remote.onEnt(msg, now);
        return;
      case "gone":
        this.remote.onGone(msg.eid);
        return;
      case "fire": {
        const m = msg as FireMessage;
        const mine = this.myEid !== null && m.eid === this.myEid;
        this.balls.onFire(m, this.clock.serverNow(now), mine);
        this.emit("fire", m, mine);
        return;
      }
      case "hit": {
        const m = msg as HitMessage;
        this.balls.onHit(m.ball, this.clock.serverNow(now));
        const isMe = m.target === "me" || (this.myEid !== null && m.target === this.myEid);
        if (isMe) {
          if (this.me) this.me = { ...this.me, hp: m.hp };
        } else if (typeof m.target === "number") {
          this.remote.setHp(m.target, m.hp);
        }
        this.emit("hit", m, isMe);
        return;
      }
      case "sunk": {
        const m = msg as SunkMessage;
        const isMe = m.eid === "me" || (this.myEid !== null && m.eid === this.myEid);
        if (isMe) {
          if (this.me) this.me = { ...this.me, sunk: true };
        } else if (typeof m.eid === "number") {
          this.remote.markSunk(m.eid);
        }
        this.emit("sunk", m, isMe);
        return;
      }
      case "splash": {
        const m = msg as SplashMessage;
        if (typeof m.ball === "number") this.balls.onHit(m.ball, this.clock.serverNow(now));
        this.emit("splash", m);
        return;
      }
      case "goldCollected": {
        const m = msg as GoldCollectedMessage;
        if (this.me) this.me = { ...this.me, gold: m.newTotalGold };
        this.emit("goldCollected", m);
        return;
      }
      case "standing": {
        // NPC2: low-rate; sent on (re)attach and when rep/notoriety/bounty change.
        const st = parseStanding(msg);
        if (st) {
          this.standing = st;
          this.emit("standing", st);
        }
        return;
      }
      case "pong":
        if (typeof msg.c === "number") this.clock.onPong(msg.c, now);
        return;
      default:
        this.emit("legacy", msg);
    }
  }

  private onSnapshot(m: SnapshotMessage, now: number): void {
    if (typeof m.k === "number" && m.k < this.lastTick && this.me) {
      // Older than what we have (shouldn't happen over one TCP stream, but a server restart resets k).
      if (this.lastTick - m.k < 100) return;
    }
    this.lastTick = m.k;
    this.clock.onServerTime(m.st, now);
    const first = !this.predictor.initialized;
    if (m.me) {
      this.me = m.me;
      if (typeof m.me.eid === "number" && m.me.eid !== this.myEid) {
        this.myEid = m.me.eid;
        this.remote.onGone(m.me.eid); // never render ourselves as a remote ship
      }
      this.lastAck = m.a;
      this.predictor.reconcile(m.me, m.a);
    }
    if (Array.isArray(m.e)) {
      const rows = this.myEid === null ? m.e : m.e.filter((r) => r[0] !== this.myEid);
      this.remote.onSnapshot(m.st, rows, now);
    }
    if (Array.isArray(m.g)) {
      this.gold = m.g;
      this.emit("gold", m.g);
    }
    if (m.me) {
      if (first) this.emit("spawned", m.me);
      this.emit("self", m.me);
    }
  }
}
