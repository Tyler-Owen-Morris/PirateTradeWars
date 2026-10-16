/**
 * Local cannonball simulation (PROTOCOL §6 `fire` / `hit`, §7, N2 clarifications). Framework-free.
 *
 * Balls are never streamed. A `fire` event carries each ball's spawn point and unit direction plus
 * speed (units per 1/60 s) and lifetime (ms). The server sends `fire` for tick k just before that
 * tick's snapshot, and the ball sits at its spawn point in tick k, so its spawn time ≈ the estimated
 * server time at receipt. Position = `ballPositionAt(spawn, elapsed)` (analytic metric straight line,
 * x wrapped — the same formula the server steps with). A `splash` (ball hit land) removes a ball
 * exactly like a `hit` does (`onHit`).
 *
 * Timelines (all in estimated SERVER ms):
 *  - own balls are drawn at `serverNow` (our ship is predicted, i.e. drawn ahead of the server);
 *  - other ships' balls are drawn at `serverNow − INTERP_DELAY_MS`, the same timeline as the remote
 *    ships, so a broadside leaves the shooter's rendered hull instead of 100 ms ahead of it.
 * A ball is hidden until its timeline reaches its spawn time. On `hit`, own balls vanish at once;
 * other balls keep flying until their delayed timeline reaches the hit moment, then vanish.
 * Expiry: when the ball's timeline passes spawn + life.
 */
import { ballPositionAt, BALL_LIFETIME_MS, BALL_SPEED } from "@shared/physics";
import { INTERP_DELAY_MS, type FireMessage } from "@shared/protocol";

export interface LocalBall {
  id: number;
  /** entity id of the shooter */
  ownerEid: number;
  /** fired by the local player (drawn on the undelayed timeline) */
  mine: boolean;
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  lifeMs: number;
  /** estimated server time (ms) of the ball's spawn */
  spawn: number;
}

export class BallSim {
  readonly balls = new Map<number, LocalBall>();
  /** Bumps when balls are added or removed. */
  version = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly remoteDelayMs: number = INTERP_DELAY_MS) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Time (server ms) on the ball's own render timeline. */
  private timeFor(b: LocalBall, serverNow: number): number {
    return b.mine ? serverNow : serverNow - this.remoteDelayMs;
  }

  /** Spawn the balls of a `fire` event; `serverNow` = estimated server time at receipt. */
  onFire(m: FireMessage, serverNow: number, mine: boolean): void {
    const speed = Number.isFinite(m.spd) && m.spd > 0 ? m.spd : BALL_SPEED;
    const lifeMs = Number.isFinite(m.life) && m.life > 0 ? m.life : BALL_LIFETIME_MS;
    let added = false;
    for (const [id, x, z, dx, dz] of m.balls) {
      if (this.balls.has(id)) continue;
      this.balls.set(id, { id, ownerEid: m.eid, mine, x, z, dx, dz, speed, lifeMs, spawn: serverNow });
      added = true;
    }
    if (added) this.bump();
  }

  /** A `hit` consumed ball `id` at `serverNow`. Own balls vanish now; others when their timeline gets there. */
  onHit(id: number, serverNow: number): void {
    const b = this.balls.get(id);
    if (!b) return;
    if (b.mine) {
      this.balls.delete(id);
      this.bump();
      return;
    }
    b.lifeMs = Math.min(b.lifeMs, Math.max(0, serverNow - b.spawn));
  }

  /** Position of ball `id` on its timeline, or null if it is gone or not spawned yet on that timeline. */
  position(id: number, serverNow: number): { x: number; z: number } | null {
    const b = this.balls.get(id);
    if (!b) return null;
    const elapsed = this.timeFor(b, serverNow) - b.spawn;
    if (elapsed < 0 || elapsed >= b.lifeMs) return null;
    return ballPositionAt(b, elapsed / 1000);
  }

  /** Remove balls whose timeline has passed spawn + life. */
  expire(serverNow: number): void {
    let removed = false;
    this.balls.forEach((b, id) => {
      if (this.timeFor(b, serverNow) - b.spawn >= b.lifeMs) {
        this.balls.delete(id);
        removed = true;
      }
    });
    if (removed) this.bump();
  }

  ids(): number[] {
    return Array.from(this.balls.keys());
  }

  clear(): void {
    if (this.balls.size === 0) return;
    this.balls.clear();
    this.bump();
  }
}
