/**
 * Drift-free fixed-step loop (docs/netcode/PROTOCOL.md §5).
 *
 * Uses a `performance.now()` accumulator and a self-rescheduling `setTimeout` (not setInterval), so
 * timer jitter never accumulates into drift: every wake runs as many whole steps as the elapsed
 * time allows. At most `maxCatchUp` steps run per wake; if the process stalled longer than that,
 * the backlog is dropped (the simulation slows down instead of spiralling).
 *
 * `step` must be synchronous. Exceptions thrown by `step` are caught and logged so one bad tick
 * cannot kill the loop.
 */
export interface FixedStepLoopOptions {
  /** Step length in ms (default 50 = 20 Hz). */
  stepMs?: number;
  /** Max steps per wake before the backlog is dropped (default 5). */
  maxCatchUp?: number;
  /** Clock in ms (default performance.now). */
  now?: () => number;
  /** Error sink (default console.error). */
  onError?: (err: unknown) => void;
}

export class FixedStepLoop {
  private readonly stepMs: number;
  private readonly maxCatchUp: number;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private acc = 0;
  /** Number of times the backlog was dropped (diagnostics). */
  dropped = 0;
  /** Duration (ms) of the most recent step call (diagnostics). */
  lastStepMs = 0;

  constructor(private readonly step: () => void, opts: FixedStepLoopOptions = {}) {
    this.stepMs = opts.stepMs ?? 50;
    this.maxCatchUp = opts.maxCatchUp ?? 5;
    this.now = opts.now ?? (() => performance.now());
    this.onError = opts.onError ?? ((err) => console.error("[loop] step failed:", err));
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.last = this.now();
    this.acc = 0;
    this.timer = setTimeout(this.wake, this.stepMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Run due steps for the time elapsed since the previous wake (exposed for tests). */
  runDue(): number {
    const t = this.now();
    this.acc += t - this.last;
    this.last = t;
    let steps = 0;
    while (this.acc >= this.stepMs && steps < this.maxCatchUp) {
      const t0 = this.now();
      try {
        this.step();
      } catch (err) {
        this.onError(err);
      }
      this.lastStepMs = this.now() - t0;
      this.acc -= this.stepMs;
      steps++;
    }
    if (this.acc >= this.stepMs) {
      this.acc = 0;
      this.dropped++;
    }
    return steps;
  }

  private wake = (): void => {
    if (!this.timer) return;
    this.runDue();
    if (!this.timer) return; // stopped inside step
    const delay = Math.max(0, this.stepMs - this.acc);
    this.timer = setTimeout(this.wake, delay);
  };
}
