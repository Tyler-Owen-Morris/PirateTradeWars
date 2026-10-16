/**
 * Own-ship prediction + reconciliation (PROTOCOL §7). Framework-free.
 *
 * - `advance(dtSec, input)` runs the shared `stepShip` at exactly TICK_HZ using an accumulator.
 *   Every fixed step gets a new sequence number, is handed to `send` as an `input` message and is
 *   kept in `pending` until the server acknowledges it (snapshot `a`).
 * - `reconcile(me, ack)` resets the simulation to the authoritative `me` state and replays every
 *   pending input with seq > ack. The difference between the old and new prediction is folded into
 *   a visual error offset that decays over ~ERROR_DECAY_TAU_SEC, so corrections never pop — unless
 *   the error exceeds SNAP_ERROR_DISTANCE, in which case we snap.
 * - `getRenderState()` interpolates between the previous and current fixed step by the
 *   accumulator fraction (render alpha) and adds the error offset.
 *
 * Positions are world coordinates (x wraps at WORLD_C, z does not wrap); rotation radians; velocity
 * metric units per 1/60 s. The predictor steps with the same `LandQuery` semantics as the server
 * (client LandField from lib/world/landTiles.ts, set by NetClient), so coast slides predict exactly;
 * tiles still loading count as water and reconciliation corrects the difference.
 */
import {
  TICK_DT,
  NEUTRAL_INPUT,
  lerpAngle,
  lerpWrapped,
  normalizeAngle,
  shipPhysicsStats,
  stepShip,
  type ShipInput,
  type ShipKinematics,
  type ShipPhysicsStats,
} from "@shared/physics";
import { WORLD_C, clampZ, metricX, wrap, wrappedDelta } from "@shared/world/geo";
import { ALWAYS_WATER_TEST_FIELD, type LandQuery } from "@shared/world/land";
import { MAX_SEQ, SNAP_ERROR_DISTANCE, type InputMessage } from "@shared/protocol";

/** Visual error offset decays as exp(−t/τ). */
export const ERROR_DECAY_TAU_SEC = 0.12;
/**
 * Never run more than this many fixed steps in one frame; a longer hitch drops the excess time
 * instead of replaying it. Deliberate: while the client is stalled the server's input queue runs
 * dry and it re-uses our last input every tick (PROTOCOL §5), i.e. the server already simulated the
 * gap. Replaying a backlog afterwards would step the ship a second time for the same wall time
 * (overshoot + correction). Dropping it means the next snapshot reconciles us onto the server's
 * extrapolated position (a small decaying error offset, or a snap if > SNAP_ERROR_DISTANCE).
 */
export const MAX_STEPS_PER_FRAME = 5;
/** Largest frame delta (s) worth feeding to `advance`: exactly MAX_STEPS_PER_FRAME ticks. */
export const MAX_FRAME_DT_SEC = MAX_STEPS_PER_FRAME * TICK_DT;
/** Unacked inputs kept at most (3 s); older ones are dropped (server is clearly not acking). */
export const MAX_PENDING_INPUTS = 60;

export interface PendingInput {
  seq: number;
  input: ShipInput;
}

/** The authoritative fields of `me` the predictor needs. */
export interface AuthoritativeShip {
  x: number;
  z: number;
  r: number;
  v: number;
  shipType?: string;
  sunk?: boolean;
}

export class Predictor {
  /** Ship state after the latest fixed step. */
  cur: ShipKinematics = { x: 0, z: 0, rotationY: 0, velocity: 0 };
  /** Ship state after the fixed step before that (render interpolates prev → cur). */
  prev: ShipKinematics = { x: 0, z: 0, rotationY: 0, velocity: 0 };
  /** Seconds accumulated toward the next fixed step, in [0, TICK_DT). */
  acc = 0;
  /** Last sequence number used; restarts at 0 on reset() (the server resets seq tracking per (re)connect). */
  seq = 0;
  pending: PendingInput[] = [];
  /** Visual error offset (coordinate units / radians) added to the rendered state. */
  errX = 0;
  errZ = 0;
  errR = 0;
  stats: ShipPhysicsStats = shipPhysicsStats("sloop");
  shipType = "sloop";
  initialized = false;
  /** Count of hard snaps (diagnostics / tests). */
  snaps = 0;

  /**
   * @param land land/ice used for prediction; must sample like the server's field. Default: open
   *   ocean + polar ice (what the server runs when it has no tiles). NetClient passes the client
   *   LandField.
   */
  constructor(public land: LandQuery = ALWAYS_WATER_TEST_FIELD) {}

  setShipType(shipType: string): void {
    if (shipType && shipType !== this.shipType) {
      this.shipType = shipType;
      this.stats = shipPhysicsStats(shipType);
    }
  }

  private nextSeq(): number {
    this.seq = this.seq >= MAX_SEQ ? 1 : this.seq + 1;
    return this.seq;
  }

  /** Record + send one input without stepping locally (e.g. a neutral input when the tab hides). */
  sendOnly(input: ShipInput, send: (m: InputMessage) => void): void {
    if (!this.initialized) return;
    const s = this.nextSeq();
    this.pushPending(s, input);
    send({ t: "input", s, th: input.th, ru: input.ru, f: input.f });
  }

  private pushPending(seq: number, input: ShipInput): void {
    this.pending.push({ seq, input: { th: input.th, ru: input.ru, f: input.f } });
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
  }

  /**
   * Advance by `dtSec` of frame time with the current `input`. Runs 0..MAX_STEPS_PER_FRAME fixed
   * steps; each one is sent via `send`. Returns the number of steps run. No-op until the first
   * snapshot has initialized the state.
   */
  advance(dtSec: number, input: ShipInput, send: (m: InputMessage) => void): number {
    this.decayError(dtSec);
    if (!this.initialized) return 0;
    this.acc += Math.max(0, dtSec);
    let steps = 0;
    while (this.acc >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
      const s = this.nextSeq();
      this.pushPending(s, input);
      send({ t: "input", s, th: input.th, ru: input.ru, f: input.f });
      this.prev = this.cur;
      this.cur = stepShip(this.cur, input, this.stats, this.land);
      this.acc -= TICK_DT;
      steps++;
    }
    // Hitch longer than MAX_STEPS_PER_FRAME ticks: drop the backlog (see MAX_STEPS_PER_FRAME).
    if (this.acc >= TICK_DT) this.acc = this.acc % TICK_DT;
    return steps;
  }

  private decayError(dtSec: number): void {
    if (this.errX === 0 && this.errZ === 0 && this.errR === 0) return;
    const k = Math.exp(-Math.max(0, dtSec) / ERROR_DECAY_TAU_SEC);
    this.errX *= k;
    this.errZ *= k;
    this.errR *= k;
    if (Math.abs(this.errX) < 1e-3 && Math.abs(this.errZ) < 1e-3 && Math.abs(this.errR) < 1e-5) {
      this.errX = this.errZ = this.errR = 0;
    }
  }

  /**
   * Apply an authoritative snapshot: drop inputs with seq <= ack, reset to `me`, replay the rest.
   * Returns the correction distance (world units) between the old and the new prediction.
   */
  reconcile(me: AuthoritativeShip, ack: number): number {
    if (me.shipType) this.setShipType(me.shipType);
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= ack) i++;
    if (i > 0) this.pending.splice(0, i);

    let s: ShipKinematics = { x: me.x, z: me.z, rotationY: me.r, velocity: me.v };
    for (const p of this.pending) {
      s = stepShip(s, me.sunk ? NEUTRAL_INPUT : p.input, this.stats, this.land);
    }

    if (!this.initialized) {
      this.initialized = true;
      this.cur = s;
      this.prev = { ...s };
      this.acc = 0;
      this.errX = this.errZ = this.errR = 0;
      return 0;
    }

    // Correction d = new − old (x wrap-aware, coordinate units); its size is measured metrically.
    const dx = wrappedDelta(this.cur.x, s.x, WORLD_C);
    const dz = s.z - this.cur.z;
    const dr = normalizeAngle(s.rotationY - this.cur.rotationY);
    const dist = Math.hypot(dx * metricX((s.z + this.cur.z) / 2), dz);

    if (dist > SNAP_ERROR_DISTANCE) {
      this.cur = s;
      this.prev = { ...s };
      this.errX = this.errZ = this.errR = 0;
      this.snaps++;
      return dist;
    }

    // Shift prev by the same correction and absorb it into the error offset, so the rendered
    // position is continuous: lerp(prev+d, cur+d, a) + (err−d) == lerp(prev, cur, a) + err.
    this.prev = {
      x: wrap(this.prev.x + dx, WORLD_C),
      z: this.prev.z + dz,
      rotationY: normalizeAngle(this.prev.rotationY + dr),
      velocity: this.prev.velocity + (s.velocity - this.cur.velocity),
    };
    this.cur = s;
    this.errX -= dx;
    this.errZ -= dz;
    this.errR = normalizeAngle(this.errR - dr);
    // Keep the residual error itself bounded.
    if (Math.hypot(this.errX * metricX(s.z), this.errZ) > SNAP_ERROR_DISTANCE) {
      this.errX = this.errZ = 0;
      this.snaps++;
    }
    return dist;
  }

  /** Render alpha in [0,1): fraction of the way from prev to cur. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.acc / TICK_DT));
  }

  /** State to draw this frame: interpolated between the last two fixed steps plus the error offset. */
  getRenderState(out: ShipKinematics = { x: 0, z: 0, rotationY: 0, velocity: 0 }): ShipKinematics {
    const a = this.alpha;
    out.x = wrap(lerpWrapped(this.prev.x, this.cur.x, a, WORLD_C) + this.errX, WORLD_C);
    out.z = clampZ(this.prev.z + (this.cur.z - this.prev.z) * a + this.errZ);
    out.rotationY = normalizeAngle(lerpAngle(this.prev.rotationY, this.cur.rotationY, a) + this.errR);
    out.velocity = this.prev.velocity + (this.cur.velocity - this.prev.velocity) * a;
    return out;
  }

  /** Forget the simulated state and unacked inputs (new session); the next input is seq 1. */
  reset(): void {
    this.initialized = false;
    this.seq = 0;
    this.pending = [];
    this.acc = 0;
    this.errX = this.errZ = this.errR = 0;
  }
}
