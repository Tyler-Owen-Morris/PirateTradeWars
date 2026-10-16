/**
 * Server clock estimation (PROTOCOL §7). Framework-free.
 *
 * `offset` is estimated from snapshot arrival: sample = snapshot.st − localReceiveTime. That sample
 * includes the one-way latency, which is exactly what remote interpolation wants: `serverNow()` is
 * then "the st of the newest snapshot we would expect to have received by now", so rendering at
 * `serverNow() − INTERP_DELAY_MS` stays INTERP_DELAY_MS behind the arriving stream regardless of RTT.
 *
 * Smoothing: exponential moving average. Samples that arrive *earlier* than predicted (larger
 * offset — less queuing delay) pull faster than late ones, so jitter spikes don't drag the
 * estimate late. A jump larger than RESET_THRESHOLD_MS (tab sleep, reconnect, server restart)
 * resets the estimate to the sample.
 *
 * RTT comes from ping/pong: rtt = now − pong.c, smoothed the same way.
 * All times in milliseconds.
 */

/** EMA weight for a sample that arrived later than predicted (more latency than usual). */
export const OFFSET_ALPHA_LATE = 0.05;
/** EMA weight for a sample that arrived earlier than predicted. */
export const OFFSET_ALPHA_EARLY = 0.2;
/** A sample this far (ms) from the estimate resets the estimate instead of smoothing. */
export const RESET_THRESHOLD_MS = 1000;
/** EMA weight for RTT samples. */
export const RTT_ALPHA = 0.25;

export class ServerClock {
  /** serverTime ≈ localTime + offset (ms). */
  offset = 0;
  /** Smoothed round-trip time (ms); 0 until the first pong. */
  rtt = 0;
  private hasOffset = false;
  private hasRtt = false;

  /** Feed one snapshot's server time `st` received at local time `localNow`. */
  onServerTime(st: number, localNow: number): void {
    const sample = st - localNow;
    if (!this.hasOffset || Math.abs(sample - this.offset) > RESET_THRESHOLD_MS) {
      this.offset = sample;
      this.hasOffset = true;
      return;
    }
    const alpha = sample > this.offset ? OFFSET_ALPHA_EARLY : OFFSET_ALPHA_LATE;
    this.offset += (sample - this.offset) * alpha;
  }

  /** Feed a pong: `sentAt` is the echoed client time, `localNow` the receive time. */
  onPong(sentAt: number, localNow: number): void {
    const sample = Math.max(0, localNow - sentAt);
    if (!this.hasRtt) {
      this.rtt = sample;
      this.hasRtt = true;
    } else {
      this.rtt += (sample - this.rtt) * RTT_ALPHA;
    }
  }

  get synced(): boolean {
    return this.hasOffset;
  }

  /** Estimated current server time (ms). */
  serverNow(localNow: number): number {
    return localNow + this.offset;
  }

  reset(): void {
    this.offset = 0;
    this.rtt = 0;
    this.hasOffset = false;
    this.hasRtt = false;
  }
}
