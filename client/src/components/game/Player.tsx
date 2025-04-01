import { forwardRef, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Ship } from './Ship';
import { PlayerState } from '@/types';
import { MAP_HEIGHT, MAP_WIDTH } from '@/lib/constants';

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
  const speedRef = useRef(player.speed);
  const rotationRef = useRef(player.rotationY);
  
  // Get max speed based on ship type
  const getMaxSpeed = () => {
    switch (player.shipType) {
      case 'sloop': return 5;
      case 'brigantine': return 6;
      case 'galleon': return 7;
      case 'man-o-war': return 8;
      default: return 5;
    }
  };
  
  // Handle player movement
  useFrame((_, delta) => {
    if (!ref || !('current' in ref) || !ref.current) return;
    
    const groupRef = ref.current;
    const { forward, backward, left, right, fire } = controls;
    
    // Debug movement
    if (forward || backward || left || right) {
      console.log("Movement inputs:", { forward, backward, left, right });
    }
    
    // Handle rotation with improved smoothness
    // Store last rotation value for interpolation
    const lastRotation = rotationRef.current;
    
    // Apply rotation directly based on input
    if (left) {
      rotationRef.current += 1.2 * delta;
    }
    
    if (right) {
      rotationRef.current -= 1.2 * delta;
    }
    
    // Apply rotation to the 3D model with smoothing
    groupRef.rotation.y = rotationRef.current;
    
    // Handle speed - simplified controls
    const maxSpeed = getMaxSpeed();
    const acceleration = 2 * delta; // Acceleration rate
    const deceleration = 1 * delta; // Deceleration rate
    
    // Forward/backward controls speed directly
    if (backward) { // S or Down Arrow - Move forward 
      speedRef.current = Math.min(maxSpeed, speedRef.current + acceleration);
    } else if (forward) { // W or Up Arrow - Move backward (reverse)
      speedRef.current = Math.max(-maxSpeed * 0.5, speedRef.current - acceleration);
    } else {
      // Gradually slow down if no input
      if (speedRef.current > 0) {
        speedRef.current = Math.max(0, speedRef.current - deceleration * 0.5); // Slower deceleration
      } else if (speedRef.current < 0) {
        speedRef.current = Math.min(0, speedRef.current + deceleration * 0.5); // Slower deceleration
      }
    }
    
    // Apply movement to group position
    if (speedRef.current !== 0) {
      // Calculate forward vector (in the direction the ship is facing)
      const directionVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        groupRef.rotation.y
      );
      
      // Calculate new position
      const newX = groupRef.position.x + directionVector.x * speedRef.current * delta * 60;
      const newZ = groupRef.position.z + directionVector.z * speedRef.current * delta * 60;
      
      // Apply map wrapping for smoother transitions
      let wrappedX = newX;
      let wrappedZ = newZ;
      
      // Apply wrapping for X coordinate
      if (wrappedX < 0) {
        wrappedX += MAP_WIDTH;
      } else if (wrappedX > MAP_WIDTH) {
        wrappedX -= MAP_WIDTH;
      }
      
      // Apply wrapping for Z coordinate
      if (wrappedZ < 0) {
        wrappedZ += MAP_HEIGHT;
      } else if (wrappedZ > MAP_HEIGHT) {
        wrappedZ -= MAP_HEIGHT;
      }
      
      // Update position
      groupRef.position.x = wrappedX;
      groupRef.position.z = wrappedZ;
      
      // Update player's coordinates in the game state - this is critical!
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
      ref.current.rotation.y = player.rotationY;
      speedRef.current = player.speed;
      rotationRef.current = player.rotationY;
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
