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
  const visualRotationRef = useRef(player.rotationY); // Visual rotation for rendering
  
  // Add angular velocity to implement momentum-based turning
  const angularVelocityRef = useRef(0);
  
  // Tuning parameters for ship turning
  const MAX_ANGULAR_VELOCITY = 2.5; // Maximum turning rate
  const ANGULAR_ACCELERATION = 4.0; // How quickly turning builds up
  const ANGULAR_DAMPING = 3.0;     // How quickly turning slows down
  const COUNTER_STEER_MULTIPLIER = 2.0; // Extra force when turning the opposite way
  const VISUAL_SMOOTH_FACTOR = 0.15; // How quickly visual rotation follows actual rotation (0-1)
  
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
  
  // Handle player movement with physics steps for consistent timing
  useFrame((_, delta) => {
    if (!ref || !('current' in ref) || !ref.current) return;
    
    // Ensure consistent physics step for better stability
    // Cap max delta to prevent large jumps with frame drops
    const physicsDelta = Math.min(delta, 0.1);
    
    const groupRef = ref.current;
    const { forward, backward, left, right, fire } = controls;
    
    // Debug movement (only log when needed)
    if (forward || backward || left || right) {
      console.log("Movement inputs:", { forward, backward, left, right });
    }
    
    // Momentum-based rotation handling
    let angularAcceleration = 0;
    
    // Calculate angular acceleration based on input
    if (left) {
      // Turning left (positive angular velocity)
      if (angularVelocityRef.current < 0) {
        // Currently turning right, apply counter-steer for quicker response
        angularAcceleration = ANGULAR_ACCELERATION * COUNTER_STEER_MULTIPLIER;
      } else {
        angularAcceleration = ANGULAR_ACCELERATION;
      }
    } else if (right) {
      // Turning right (negative angular velocity)
      if (angularVelocityRef.current > 0) {
        // Currently turning left, apply counter-steer for quicker response
        angularAcceleration = -ANGULAR_ACCELERATION * COUNTER_STEER_MULTIPLIER;
      } else {
        angularAcceleration = -ANGULAR_ACCELERATION;
      }
    } else {
      // No input, apply damping
      if (angularVelocityRef.current > 0) {
        angularAcceleration = -ANGULAR_DAMPING;
      } else if (angularVelocityRef.current < 0) {
        angularAcceleration = ANGULAR_DAMPING;
      }
    }
    
    // Update angular velocity based on acceleration with consistent time step
    angularVelocityRef.current += angularAcceleration * physicsDelta;
    
    // Clamp angular velocity to maximum value
    if (angularVelocityRef.current > MAX_ANGULAR_VELOCITY) {
      angularVelocityRef.current = MAX_ANGULAR_VELOCITY;
    } else if (angularVelocityRef.current < -MAX_ANGULAR_VELOCITY) {
      angularVelocityRef.current = -MAX_ANGULAR_VELOCITY;
    }
    
    // Apply damping when not actively turning and below threshold
    if (!left && !right && Math.abs(angularVelocityRef.current) < 0.1) {
      angularVelocityRef.current = 0; // Stop completely below threshold
    }
    
    // Apply angular velocity to physics rotation
    rotationRef.current += angularVelocityRef.current * physicsDelta;
    
    // Smoothly interpolate visual rotation to follow physics rotation
    // This creates a smoother visual appearance while maintaining accurate physics
    const rotationDiff = rotationRef.current - visualRotationRef.current;
    visualRotationRef.current += rotationDiff * VISUAL_SMOOTH_FACTOR;
    
    // Apply smooth visual rotation to the 3D model
    groupRef.rotation.y = visualRotationRef.current;
    
    // Handle speed - simplified controls with frame-rate independence
    const maxSpeed = getMaxSpeed();
    const acceleration = 2 * physicsDelta; // Acceleration rate
    const deceleration = 1 * physicsDelta; // Deceleration rate
    
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
      // Calculate forward vector based on the VISUAL rotation (for consistent appearance)
      // This is important so the ship appears to move in the direction it's visually pointing
      const directionVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        visualRotationRef.current
      );
      
      // Calculate new position with consistent physics timestep
      const newX = groupRef.position.x + directionVector.x * speedRef.current * physicsDelta * 60;
      const newZ = groupRef.position.z + directionVector.z * speedRef.current * physicsDelta * 60;
      
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
      
      // Update both physics and visual rotation references when server data changes
      rotationRef.current = player.rotationY;
      visualRotationRef.current = player.rotationY;
      
      // Also directly set the rotation for immediate feedback when teleporting
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
