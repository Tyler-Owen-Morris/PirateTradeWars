/**
 * Controls → wire input mapping (PROTOCOL §2, §4). Framework-free.
 *
 * W/Up    → th: 1  (full ahead; target velocity −maxSpeed)
 * S/Down  → th: −1 (reverse;    target velocity +maxSpeed·0.5)
 * A/Left  → ru: 1  (rotationY increases)
 * D/Right → ru: −1
 * Space/F → f: 1
 * Opposing keys cancel (W+S → th 0, A+D → ru 0).
 */
import type { ShipInput } from "@shared/physics";

/** Boolean control state, as produced by drei KeyboardControls and the touch joystick. */
export interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

export const NEUTRAL_CONTROLS: Readonly<ControlState> = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  fire: false,
});

/** OR together several control sources (keyboard + touch + HUD fire button). Missing sources are skipped. */
export function combineControls(...sources: Array<Partial<ControlState> | null | undefined>): ControlState {
  const out: ControlState = { forward: false, backward: false, left: false, right: false, fire: false };
  for (const s of sources) {
    if (!s) continue;
    out.forward ||= !!s.forward;
    out.backward ||= !!s.backward;
    out.left ||= !!s.left;
    out.right ||= !!s.right;
    out.fire ||= !!s.fire;
  }
  return out;
}

/** Map boolean controls to one tick of ShipInput. */
export function controlsToInput(c: Partial<ControlState>): ShipInput {
  const th = (c.forward ? 1 : 0) - (c.backward ? 1 : 0);
  const ru = (c.left ? 1 : 0) - (c.right ? 1 : 0);
  return { th: th as ShipInput["th"], ru: ru as ShipInput["ru"], f: c.fire ? 1 : 0 };
}
