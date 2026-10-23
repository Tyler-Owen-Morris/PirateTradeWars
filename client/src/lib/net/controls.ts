/**
 * Controls → wire input mapping (PROTOCOL §2, §4). Framework-free.
 *
 * W/Up    → th: 1  (full ahead; target velocity −maxSpeed)
 * S/Down  → th: −1 (reverse;    target velocity +maxSpeed·0.5)
 * A/Left  → ru: 1  (rotationY increases)
 * D/Right → ru: −1
 * Space/F → f: FIRE_ALL (1)        fire every loaded side (also the HUD / touch fire button)
 * Q       → f: FIRE_PORT (2)       left battery only
 * E       → f: FIRE_STARBOARD (4)  right battery only
 * Fire bits combine (Q+E = 6). Opposing keys cancel (W+S → th 0, A+D → ru 0).
 */
import { FIRE_ALL, FIRE_PORT, FIRE_STARBOARD, type ShipInput } from "@shared/physics";

/** Boolean control state, as produced by drei KeyboardControls and the touch joystick. */
export interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  /** Broadsides: fire the port (left) / starboard (right) battery. Optional so touch/HUD sources
   *  that only know `fire` need no change. */
  firePort?: boolean;
  fireStarboard?: boolean;
}

export const NEUTRAL_CONTROLS: Readonly<ControlState> = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  fire: false,
  firePort: false,
  fireStarboard: false,
});

/** OR together several control sources (keyboard + touch + HUD fire button). Missing sources are skipped. */
export function combineControls(...sources: Array<Partial<ControlState> | null | undefined>): ControlState {
  const out: ControlState = { forward: false, backward: false, left: false, right: false, fire: false, firePort: false, fireStarboard: false };
  for (const s of sources) {
    if (!s) continue;
    out.forward ||= !!s.forward;
    out.backward ||= !!s.backward;
    out.left ||= !!s.left;
    out.right ||= !!s.right;
    out.fire ||= !!s.fire;
    out.firePort ||= !!s.firePort;
    out.fireStarboard ||= !!s.fireStarboard;
  }
  return out;
}

/** Map boolean controls to one tick of ShipInput. */
export function controlsToInput(c: Partial<ControlState>): ShipInput {
  const th = (c.forward ? 1 : 0) - (c.backward ? 1 : 0);
  const ru = (c.left ? 1 : 0) - (c.right ? 1 : 0);
  const f = (c.fire ? FIRE_ALL : 0) | (c.firePort ? FIRE_PORT : 0) | (c.fireStarboard ? FIRE_STARBOARD : 0);
  return { th: th as ShipInput["th"], ru: ru as ShipInput["ru"], f };
}

/**
 * Holds fire bits from a press until a 20 Hz input step has sent them. Frames run faster than
 * steps (60 fps = 3 frames per step), so a quick tap of Space/Q/E that starts and ends between two
 * steps would otherwise never reach the server. `take(f, stepped)` is called once per frame with
 * this frame's fire bits: it returns the bits to send (this frame's OR any not yet sent), and clears
 * the latch once a step has carried them (`stepped` = the predictor ran ≥ 1 step this frame).
 */
export class FireLatch {
  private pending = 0;
  /** Bits to put on this frame's input. */
  peek(f: number): number {
    return this.pending | f;
  }
  /** After the frame: `stepped` = at least one input was sent carrying `peek(f)`. */
  commit(f: number, stepped: boolean): void {
    this.pending = stepped ? 0 : this.pending | f;
  }
  reset(): void {
    this.pending = 0;
  }
}
