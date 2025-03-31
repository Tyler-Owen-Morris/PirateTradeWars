import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Vector3 } from '@/types';

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
  
  useFrame(() => {
    if (ballRef.current && trailRef.current) {
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
