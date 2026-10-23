/**
 * Auto-sail latch (desktop keyboard only). Framework-free state machine; client-side input only, the
 * wire input stays `th: 1` (no protocol/server change).
 *
 * Feed it the KEYBOARD forward/backward state once per frame via `update(fwd, back, nowMs)`; it returns
 * whether auto-forward is active. OR the result into `forward` when combining controls.
 *
 *  - Engage: two fresh forward presses (key-down edges) within `DOUBLE_TAP_MS` of each other.
 *  - Cancel: a fresh forward press after the engaging one, or backward down (held or pressed).
 *  - The cancelling press never counts as the first tap of a new double-tap, so cancel-then-W-quickly
 *    does not re-engage; a new engage needs two further fresh presses.
 *  - The engaging press is still held when the latch turns on; its release is not a press, so there is
 *    no flip-flop while the key stays down.
 *  - `reset()` on death/respawn/game end/trade menu/text input focus.
 */
export const DOUBLE_TAP_MS = 300;

export class AutoSail {
  active = false;
  private prevForward = false;
  private lastPressAt = -Infinity;

  update(forwardDown: boolean, backwardDown: boolean, nowMs: number): boolean {
    const press = forwardDown && !this.prevForward;
    this.prevForward = forwardDown;

    if (backwardDown) {
      this.active = false;
      this.lastPressAt = -Infinity;
      return false;
    }
    if (!press) return this.active;

    if (this.active) {
      this.active = false;
      this.lastPressAt = -Infinity; // the cancel press is not a first tap
    } else if (nowMs - this.lastPressAt <= DOUBLE_TAP_MS) {
      this.active = true;
      this.lastPressAt = -Infinity;
    } else {
      this.lastPressAt = nowMs;
    }
    return this.active;
  }

  /** Cancel and forget key history (pass the key state so a held key isn't seen as a fresh press). */
  reset(forwardDown = false): void {
    this.active = false;
    this.lastPressAt = -Infinity;
    this.prevForward = forwardDown;
  }
}
