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
  accelerate: boolean;
  decelerate: boolean;
}

interface PlayerProps {
  player: PlayerState;
  controls: PlayerControls;
}

// Maps from shared constants
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 5000;

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
    const { forward, backward, left, right, accelerate, decelerate } = controls;
    
    // Handle rotation
    if (left) {
      rotationRef.current += 1.2 * delta;
      groupRef.rotation.y = rotationRef.current;
    }
    
    if (right) {
      rotationRef.current -= 1.2 * delta;
      groupRef.rotation.y = rotationRef.current;
    }
    
    // Handle speed
    const maxSpeed = getMaxSpeed();
    const acceleration = 2 * delta; // Acceleration rate
    const deceleration = 1 * delta; // Deceleration rate
    
    if (forward) {
      if (accelerate) {
        speedRef.current = Math.min(maxSpeed * 1.5, speedRef.current + acceleration * 1.5);
      } else {
        speedRef.current = Math.min(maxSpeed, speedRef.current + acceleration);
      }
    } else if (backward) {
      speedRef.current = Math.max(-maxSpeed * 0.5, speedRef.current - acceleration);
    } else {
      // Gradually slow down if no input
      if (speedRef.current > 0) {
        speedRef.current = Math.max(0, speedRef.current - deceleration);
      } else if (speedRef.current < 0) {
        speedRef.current = Math.min(0, speedRef.current + deceleration);
      }
    }
    
    // Apply manual deceleration
    if (decelerate) {
      if (speedRef.current > 0) {
        speedRef.current = Math.max(0, speedRef.current - deceleration * 2);
      } else if (speedRef.current < 0) {
        speedRef.current = Math.min(0, speedRef.current + deceleration * 2);
      }
    }
    
    // Apply movement to group position
    if (speedRef.current !== 0) {
      // Calculate forward vector
      const directionVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        groupRef.rotation.y
      );
      
      // Move the ship
      groupRef.position.x += directionVector.x * speedRef.current * delta * 60; // 60 FPS normalization
      groupRef.position.z += directionVector.z * speedRef.current * delta * 60;
      
      // Handle map wrapping
      groupRef.position.x = (groupRef.position.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      groupRef.position.z = (groupRef.position.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
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
