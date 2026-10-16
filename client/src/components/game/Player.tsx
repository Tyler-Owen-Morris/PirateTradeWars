import { forwardRef, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Ship } from './Ship';
import { PlayerState } from '@/types';
import { MAP_HEIGHT, MAP_WIDTH } from '@shared/gameConstants';

interface PlayerControls {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

interface PlayerProps {
  player: PlayerState;
  controls: PlayerControls;
  onRotationChange?: (rotation: number) => void;
}

export const Player = forwardRef<THREE.Group, PlayerProps>(function Player(
  { player, controls, onRotationChange },
  ref
) {
  const speedRef = useRef(player.speed);
  const rotationRef = useRef(player.rotationY);
  const smoothedPlayerPosition = useRef(new THREE.Vector3(player.x, player.y, player.z));

  const TURN_SPEED = 0.05;
  const FORWARD_ACCELERATION = 0.15;
  const BACKWARD_ACCELERATION = 0.1;
  const DECELERATION = 0.03;
  const DRAG_COEFFICIENT = 0.97;
  const POSITION_LERP_FACTOR = 0.2;

  const getMaxSpeed = () => player.maxSpeed;

  useFrame((_, delta) => {
    if (!ref || !('current' in ref) || !ref.current) return;

    const physicsDelta = Math.min(delta, 0.1);
    const normalizedDelta = physicsDelta * 60;

    const groupRef = ref.current;
    const { forward, backward, left, right } = controls;

    const targetPosition = new THREE.Vector3(player.x, player.y, player.z);
    smoothedPlayerPosition.current.lerp(targetPosition, POSITION_LERP_FACTOR);

    if (left) {
      rotationRef.current += TURN_SPEED * normalizedDelta;
    }

    if (right) {
      rotationRef.current -= TURN_SPEED * normalizedDelta;
    }

    if (onRotationChange) {
      onRotationChange(rotationRef.current);
    }

    // Server reconciliation
    const angleDiff = THREE.MathUtils.euclideanModulo(player.rotationY - rotationRef.current + Math.PI, Math.PI * 2) - Math.PI;
    const RECONCILIATION_THRESHOLD = THREE.MathUtils.degToRad(5);
    const RECONCILIATION_SPEED = 0.1;
    if (Math.abs(angleDiff) > RECONCILIATION_THRESHOLD) {
      const targetRotation = rotationRef.current + angleDiff;
      rotationRef.current = THREE.MathUtils.lerp(rotationRef.current, targetRotation, RECONCILIATION_SPEED * normalizedDelta);
      rotationRef.current = THREE.MathUtils.euclideanModulo(rotationRef.current, Math.PI * 2);
    }

    groupRef.rotation.y = rotationRef.current;

    const maxSpeed = getMaxSpeed();

    if (backward) {
      speedRef.current += FORWARD_ACCELERATION * normalizedDelta;
      if (speedRef.current > maxSpeed) speedRef.current = maxSpeed;
    } else if (forward) {
      speedRef.current -= BACKWARD_ACCELERATION * normalizedDelta;
      if (speedRef.current < -maxSpeed * 0.5) speedRef.current = -maxSpeed * 0.5;
    } else {
      speedRef.current *= DRAG_COEFFICIENT;
      if (Math.abs(speedRef.current) < DECELERATION * normalizedDelta) {
        speedRef.current = 0;
      } else if (speedRef.current > 0) {
        speedRef.current -= DECELERATION * normalizedDelta;
      } else if (speedRef.current < 0) {
        speedRef.current += DECELERATION * normalizedDelta;
      }
    }

    if (speedRef.current !== 0) {
      const directionVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rotationRef.current
      );
      const movement = speedRef.current * normalizedDelta;
      smoothedPlayerPosition.current.x += directionVector.x * movement;
      smoothedPlayerPosition.current.z += directionVector.z * movement;

      smoothedPlayerPosition.current.x = ((smoothedPlayerPosition.current.x % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
      smoothedPlayerPosition.current.z = ((smoothedPlayerPosition.current.z % MAP_HEIGHT) + MAP_HEIGHT) % MAP_HEIGHT;

      if (player && 'x' in player && 'z' in player) {
        player.x = smoothedPlayerPosition.current.x;
        player.z = smoothedPlayerPosition.current.z;
      }
    }

    groupRef.position.copy(smoothedPlayerPosition.current);
  });

  useEffect(() => {
    if (ref && 'current' in ref && ref.current) {
      ref.current.position.set(player.x, player.y, player.z);
      speedRef.current = player.speed;
    }
  }, [player.x, player.y, player.z, player.speed, ref]);

  return (
    <Ship
      ref={ref}
      position={[player.x, player.y, player.z]}
      rotation={rotationRef.current}
      type={player.shipType}
      name={player.name}
      hp={player.hp}
      maxHp={player.maxHp}
      sunk={player.sunk}
      isPlayer={true}
    />
  );
});