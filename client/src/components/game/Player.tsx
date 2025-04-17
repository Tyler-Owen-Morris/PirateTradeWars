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
}

export const Player = forwardRef<THREE.Group, PlayerProps>(function Player(
  { player, controls },
  ref
) {
  // Core state references
  const speedRef = useRef(player.speed);
  const rotationRef = useRef(player.rotationY);

  // Ship movement physics parameters - completely rebuilt for smoother turning
  const TURN_SPEED = 0.05;              // Base turning speed (radians per frame)
  const FORWARD_ACCELERATION = 0.15;    // How quickly ship accelerates forward
  const BACKWARD_ACCELERATION = 0.1;    // How quickly ship accelerates backward
  const DECELERATION = 0.03;            // Natural slowdown when not accelerating
  const DRAG_COEFFICIENT = 0.97;        // Gradual speed reduction (momentum)

  // Get max speed based on ship type
  const getMaxSpeed = () => {
    //console.log("getmaxspeed:", player.maxSpeed)
    return player.maxSpeed;
    switch (player.shipType) {
      case 'sloop': return 5;
      case 'brigantine': return 6;
      case 'galleon': return 7;
      case 'man-o-war': return 8;
      default: return 5;
    }
  };

  // Handle player movement with physics steps for consistent timing
  useFrame((_, delta) => {
    if (!ref || !('current' in ref) || !ref.current) return;

    // Ensure consistent physics step for better stability
    const physicsDelta = Math.min(delta, 0.1);
    const normalizedDelta = physicsDelta * 60; // Normalize to 60fps for consistent physics

    const groupRef = ref.current;
    const { forward, backward, left, right, fire } = controls;

    // Debug movement (only log when needed)
    if (forward || backward || left || right) {
      //console.log("Movement inputs:", { forward, backward, left, right });
    }

    // --------- SIMPLE, DIRECT TURNING SYSTEM ---------
    // Direct turning that feels responsive regardless of ship speed

    if (left) {
      // Turn left (increase rotation value)
      rotationRef.current += TURN_SPEED * normalizedDelta;
    }

    if (right) {
      // Turn right (decrease rotation value)
      rotationRef.current -= TURN_SPEED * normalizedDelta;
    }

    // Apply rotation directly to the ship model
    groupRef.rotation.y = rotationRef.current;

    // --------- MOMENTUM-BASED FORWARD/BACKWARD MOVEMENT ---------

    const maxSpeed = getMaxSpeed();

    // Apply acceleration based on input
    if (backward) { // S key - Move forward
      // Accelerate forward up to max speed
      speedRef.current += FORWARD_ACCELERATION * normalizedDelta;
      if (speedRef.current > maxSpeed) {
        speedRef.current = maxSpeed;
      }
    } else if (forward) { // W key - Move backward (reverse)
      // Accelerate backward up to half max speed
      speedRef.current -= BACKWARD_ACCELERATION * normalizedDelta;
      if (speedRef.current < -maxSpeed * 0.5) {
        speedRef.current = -maxSpeed * 0.5;
      }
    } else {
      // No input - apply drag and natural deceleration

      // First apply percentage-based drag (gradual slowdown)
      speedRef.current *= DRAG_COEFFICIENT;

      // Then apply fixed deceleration in the appropriate direction
      if (Math.abs(speedRef.current) < DECELERATION * normalizedDelta) {
        // If very close to stopping, just stop
        speedRef.current = 0;
      } else if (speedRef.current > 0) {
        // Slowing down from forward movement
        speedRef.current -= DECELERATION * normalizedDelta;
      } else if (speedRef.current < 0) {
        // Slowing down from backward movement
        speedRef.current += DECELERATION * normalizedDelta;
      }
    }

    // Apply movement based on current speed and rotation
    if (speedRef.current !== 0) {
      // Get directional vector based on current rotation
      const directionVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rotationRef.current
      );

      // Calculate new position
      const movement = speedRef.current * normalizedDelta;
      const newX = groupRef.position.x + directionVector.x * movement;
      const newZ = groupRef.position.z + directionVector.z * movement;

      // Handle map wrapping (continue at opposite edge when reaching map boundary)
      let wrappedX = ((newX % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
      let wrappedZ = ((newZ % MAP_HEIGHT) + MAP_HEIGHT) % MAP_HEIGHT;

      // Update position
      groupRef.position.x = wrappedX;
      groupRef.position.z = wrappedZ;

      // Update player state to match visual position
      if (player && 'x' in player && 'z' in player) {
        player.x = wrappedX;
        player.z = wrappedZ;
      }
    }
  });

  // Sync with server state
  useEffect(() => {
    if (ref && 'current' in ref && ref.current) {
      ref.current.position.set(player.x, player.y, player.z);

      // Update rotation reference and directly set the rotation
      rotationRef.current = player.rotationY;
      ref.current.rotation.y = player.rotationY;

      speedRef.current = player.speed;
    }
  }, [player.x, player.y, player.z, player.rotationY, player.speed, ref]);

  return (
    <Ship
      ref={ref}
      position={[player.x, player.y, player.z]}
      rotation={player.rotationY}
      type={player.shipType}
      name={player.name}
      hp={player.hp}
      maxHp={player.maxHp}
      sunk={player.sunk}
      isPlayer={true}
    />
  );
});
