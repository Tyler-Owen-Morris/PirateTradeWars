/**
 * Local player's ship. Movement is NOT simulated here: every frame (useFrame, priority -1 so it runs
 * before the camera and remote ships) we
 *   1. combine keyboard (drei KeyboardControls, read imperatively) + touch/HUD controls,
 *   2. call `net.frame(delta, controls)` — fixed 20 Hz prediction with the shared `stepShip`,
 *      sending one `input` per step (see lib/net/prediction.ts),
 *   3. write the predicted render state (interpolated + decaying error offset) to the Three group.
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
import { net, combineControls, type ControlState } from '@/lib/net';
import type { ShipKinematics } from '@shared/physics';

type ControlName = keyof ControlState;

interface PlayerProps {
  player: PlayerState;
  /** touch joystick / HUD fire button state, OR-ed with the keyboard */
  controlsRef?: React.MutableRefObject<ControlState>;
}

export const Player = forwardRef<THREE.Group, PlayerProps>(function Player({ player, controlsRef }, ref) {
  const [, getKeys] = useKeyboardControls<ControlName>();
  const renderState = useRef<ShipKinematics>({ x: player.x, z: player.z, rotationY: player.rotationY, velocity: 0 });
  // Stable initial position so React re-renders never re-apply a stale position to the group.
  const initialPosition = useMemo<[number, number, number]>(() => [player.x, 0, player.z], []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const controls = combineControls(getKeys() as Partial<ControlState>, controlsRef?.current);
    net.frame(delta, controls);

    if (!ref || !('current' in ref) || !ref.current) return;
    if (!net.predictor.initialized) return;
    const r = net.getOwnRenderState(renderState.current);
    ref.current.position.set(r.x, 0, r.z);
    ref.current.rotation.y = r.rotationY;
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
