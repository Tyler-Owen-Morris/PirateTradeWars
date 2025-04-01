import { useRef, useEffect } from 'react';
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
  const isAnimatingRef = useRef(true);
  
  // Add a trail effect
  const trailRef = useRef<THREE.Points>(null);
  const particlesRef = useRef<THREE.BufferAttribute | null>(null);
  const particleCount = 20;
  
  // Create particles for trail effect - only once
  const particles = useRef(new Float32Array(particleCount * 3)).current;
  
  // Material refs for proper cleanup
  const ballMaterialRef = useRef<THREE.Material | null>(null);
  const trailMaterialRef = useRef<THREE.Material | null>(null);
  
  // Clean up resources when component unmounts
  useEffect(() => {
    // Initialize particles with starting position
    for (let i = 0; i < particleCount; i++) {
      particles[i * 3] = position[0];
      particles[i * 3 + 1] = position[1];
      particles[i * 3 + 2] = position[2];
    }
    
    // Return cleanup function
    return () => {
      isAnimatingRef.current = false;
      
      // Dispose of materials to prevent memory leaks
      if (ballMaterialRef.current) {
        ballMaterialRef.current.dispose();
      }
      
      if (trailMaterialRef.current) {
        trailMaterialRef.current.dispose();
      }
      
      // Clean up geometry if available
      if (ballRef.current && ballRef.current.geometry) {
        ballRef.current.geometry.dispose();
      }
      
      if (trailRef.current && trailRef.current.geometry) {
        trailRef.current.geometry.dispose();
      }
    };
  }, [particles, position]);
  
  // Movement and trail animation with error handling
  useFrame((_, delta) => {
    // Skip if component is unmounting
    if (!isAnimatingRef.current) return;
    
    try {
      if (ballRef.current && trailRef.current) {
        // Cap delta to prevent large jumps when frame rate drops
        const physicsDelta = Math.min(delta, 0.1);
        
        // Move the cannon ball based on direction
        const moveSpeed = 15 * physicsDelta * 60; // Same as CANNON_SPEED in constants
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
        
        // Get/initialize buffer attribute reference
        if (!particlesRef.current && trailRef.current.geometry.attributes.position) {
          particlesRef.current = trailRef.current.geometry.attributes.position as THREE.BufferAttribute;
        }
        
        // Make sure we have a valid buffer before updating
        if (particlesRef.current) {
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
          
          // Update geometry - safely
          particlesRef.current.set(particles);
          particlesRef.current.needsUpdate = true;
        }
      }
    } catch (error) {
      console.error("Error in cannonball animation:", error);
      // Stop animating on error to prevent error spam
      isAnimatingRef.current = false;
    }
  });
  
  // Use useEffect to access and store materials
  useEffect(() => {
    // Capture material from the mesh once it's created
    if (ballRef.current && ballRef.current.material) {
      ballMaterialRef.current = ballRef.current.material as THREE.Material;
    }
    
    // Capture material from the points once it's created
    if (trailRef.current && trailRef.current.material) {
      trailMaterialRef.current = trailRef.current.material as THREE.Material;
    }
  }, []);
  
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
