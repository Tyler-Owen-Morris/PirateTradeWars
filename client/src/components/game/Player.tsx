/**
 * Local player's ship. Movement is NOT simulated here: every frame (useFrame, priority -1 so it runs
 * before the camera and remote ships) we
 *   1. combine keyboard (drei KeyboardControls, read imperatively; neutral while `isTextEntryActive()`,
 *      i.e. the chat input or another text field has focus) + touch/HUD controls,
 *   2. call `net.frameNow(controls)` (measures its own frame dt) — fixed 20 Hz prediction with the shared `stepShip`,
 *      sending one `input` per step (see lib/net/prediction.ts),
 *   3. set the floating-origin focus (lib/world/renderSpace.ts) to the predicted render state
 *      (interpolated + decaying error offset) and draw the ship at the origin with its heading.
 * Server snapshots reconcile the prediction inside the net layer; there is no snapping here and the
 * zustand player object is never mutated. Props only carry slow-changing display data.
 */
import { forwardRef, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { Ship } from './Ship';
import { PlayerState } from '@/types';
import { ShipType } from '@/lib/constants';
import { net, combineControls, NEUTRAL_CONTROLS, type ControlState } from '@/lib/net';
import { isTextEntryActive } from '@/lib/stores/useInputFocus';
import type { ShipKinematics } from '@shared/physics';
import { setRenderFocus } from '@/lib/world/renderSpace';

type ControlName = keyof ControlState;

interface PlayerProps {
  player: PlayerState;
  /** touch joystick / HUD fire button state, OR-ed with the keyboard */
  controlsRef?: React.MutableRefObject<ControlState>;
}

export const Player = forwardRef<THREE.Group, PlayerProps>(function Player({ player, controlsRef }, ref) {
  const [, getKeys] = useKeyboardControls<ControlName>();
  const renderState = useRef<ShipKinematics>({ x: player.x, z: player.z, rotationY: player.rotationY, velocity: 0 });
  // Floating origin: the own ship is always drawn at the render-space origin (lib/world/renderSpace.ts).
  const initialPosition = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const playerRef = useRef(player);
  playerRef.current = player;

  useFrame(() => {
    // While the player types (chat or any text field) the keyboard is neutral; touch/HUD still apply.
    const keys = isTextEntryActive() ? NEUTRAL_CONTROLS : (getKeys() as Partial<ControlState>);
    const controls = combineControls(keys, controlsRef?.current);
    // Own wall-clock delta, not R3F's `delta` (other code can shorten that via the shared clock).
    net.frameNow(controls);

    // The camera focus F = predicted own position (raw world coords). Set once per frame, before every
    // other useFrame (priority 0) converts world positions with toRender().
    if (net.predictor.initialized) {
      const r = net.getOwnRenderState(renderState.current);
      setRenderFocus(r.x, r.z);
    } else {
      setRenderFocus(playerRef.current.x, playerRef.current.z); // before the first snapshot
      renderState.current.rotationY = playerRef.current.rotationY;
    }

    if (!ref || !('current' in ref) || !ref.current) return;
    ref.current.position.set(0, 0, 0);
    ref.current.rotation.y = renderState.current.rotationY;
  }, -1);

  return (
    <Ship
      ref={ref}
      position={initialPosition}
      rotation={0}
      type={player.shipType as ShipType}
      name={player.name}
      hp={player.hp}
      maxHp={player.maxHp}
      sunk={player.sunk}
      isPlayer={true}
    />
  );
});
