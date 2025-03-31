import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Vector3 } from '@/types';
import { MAP_WIDTH, MAP_HEIGHT } from '@/lib/constants';

interface CannonBallProps {
  position: [number, number, number];
  direction: Vector3;
}

export function CannonBall({ position, direction }: CannonBallProps) {
  const ballRef = useRef<THREE.Mesh>(null);
  
  // Add a trail effect
  const trailRef = useRef<THREE.Points>(null);
  const particlesRef = useRef<THREE.BufferAttribute | null>(null);
  const particleCount = 20;
  
  // Create particles for trail effect
  const particles = new Float32Array(particleCount * 3);
  
  // Movement and trail animation
  useFrame((_, delta) => {
    if (ballRef.current && trailRef.current) {
      // Move the cannon ball based on direction
      const moveSpeed = 15 * delta * 60; // Same as CANNON_SPEED in constants
      ballRef.current.position.x += direction.x * moveSpeed;
      ballRef.current.position.y += direction.y * moveSpeed;
      ballRef.current.position.z += direction.z * moveSpeed;
      
      // Apply the same wrapping logic as player for smooth edge transitions
      if (ballRef.current.position.x < 0) {
        ballRef.current.position.x += MAP_WIDTH;
      } else if (ballRef.current.position.x > MAP_WIDTH) {
        ballRef.current.position.x -= MAP_WIDTH;
      }
      
      if (ballRef.current.position.z < 0) {
        ballRef.current.position.z += MAP_HEIGHT;
      } else if (ballRef.current.position.z > MAP_HEIGHT) {
        ballRef.current.position.z -= MAP_HEIGHT;
      }
      
      // Update trail particles
      if (!particlesRef.current) {
        const positions = trailRef.current.geometry.attributes.position;
        particlesRef.current = positions as THREE.BufferAttribute;
      }
      
      // Shift particles down the array
      for (let i = particleCount - 1; i > 0; i--) {
        particles[i * 3] = particles[(i - 1) * 3];
        particles[i * 3 + 1] = particles[(i - 1) * 3 + 1];
        particles[i * 3 + 2] = particles[(i - 1) * 3 + 2];
      }
      
      // Add current position to front of trail
      particles[0] = ballRef.current.position.x;
      particles[1] = ballRef.current.position.y;
      particles[2] = ballRef.current.position.z;
      
      // Update geometry
      particlesRef.current.set(particles);
      particlesRef.current.needsUpdate = true;
    }
  });
  
  return (
    <group>
      {/* The cannon ball */}
      <mesh 
        ref={ballRef} 
        position={position}
        castShadow
      >
        <sphereGeometry args={[3, 16, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      
      {/* Trail effect using points */}
      <points ref={trailRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={particleCount}
            array={particles}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial 
          size={2} 
          color="#ff8c00" 
          sizeAttenuation={true}
          transparent
          opacity={0.8}
        />
      </points>
    </group>
  );
}
