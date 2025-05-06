import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Vector3 } from '@/types';
import { MAP_WIDTH, MAP_HEIGHT } from '@shared/gameConstants';
import { useAudio } from '../../lib/stores/useAudio';

interface CannonBallProps {
  position: [number, number, number];
  direction: Vector3;
  ownerId: string;
  localPlayerId: string;
  allCannonBalls?: number;
  range: number;
}

export function CannonBall({ position, direction, ownerId, localPlayerId, allCannonBalls = 1, range }: CannonBallProps) {
  const ballRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Points>(null);
  const particlesRef = useRef<THREE.BufferAttribute | null>(null);
  const particleCount = 20;
  const particles = new Float32Array(particleCount * 3);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [isSinking, setIsSinking] = useState(false);
  const [sinkProgress, setSinkProgress] = useState(0);
  const [hasPlayedSound, setHasPlayedSound] = useState(false);
  const [time, setTime] = useState(0);

  const { cannonBangSound, isSfxMuted, sfxVolume } = useAudio();

  useEffect(() => {
    // Play sound only once on creation
    if (!hasPlayedSound && cannonBangSound && !isSfxMuted) {
      const scaledVolume = Math.min(1.0, sfxVolume * (1 + (allCannonBalls - 1) * 0.2));
      useAudio.getState().playCannonFire();
      setHasPlayedSound(true);
    }
  }, []);

  useFrame((_, delta) => {
    if (ballRef.current && trailRef.current) {
      if (isSinking) {
        // Sinking animation
        setSinkProgress(prev => prev + delta);
        if (sinkProgress < 1) {
          ballRef.current.position.y -= 2 * delta;
          ballRef.current.scale.setScalar(1 - sinkProgress);
        } else {
          // Remove the cannon ball after sinking
          console.log("cannonball removing itself")
          ballRef.current.visible = false;
          return;
        }
      } else {
        const moveSpeed = 5 * delta * 60;
        const moveVector = new THREE.Vector3(
          direction.x * moveSpeed,
          direction.y * moveSpeed,
          direction.z * moveSpeed
        );

        ballRef.current.position.add(moveVector);
        setDistanceTraveled(prev => prev + moveVector.length());

        // Check if we've reached the range limit
        if (distanceTraveled >= range) {
          console.log("Cannonball is at range limit")
          setIsSinking(true);
        }

        // Handle map wrapping
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
        for (let i = particleCount - 1; i > 0; i--) {
          particles[i * 3] = particles[(i - 1) * 3];
          particles[i * 3 + 1] = particles[(i - 1) * 3 + 1];
          particles[i * 3 + 2] = particles[(i - 1) * 3 + 2];
        }
        particles[0] = ballRef.current.position.x;
        particles[1] = ballRef.current.position.y;
        particles[2] = ballRef.current.position.z;
        particlesRef.current.set(particles);
        particlesRef.current.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      <mesh ref={ballRef} position={position} castShadow>
        <sphereGeometry args={[3, 16, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
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