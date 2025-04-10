import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Vector3 } from '@/types';
import { MAP_WIDTH, MAP_HEIGHT } from '@/lib/constants';
import { useAudio } from '../../lib/stores/useAudio';
import { ShipProps } from './Ship';

interface CannonBallProps {
  position: [number, number, number];
  direction: Vector3;
  ownerId: string;
  localPlayerId: string;
  allCannonBalls?: number;
  ships: ShipProps[];
  onHit: (shipIndex: number, damage: number) => void;
}

export function CannonBall({ position, direction, ownerId, localPlayerId, allCannonBalls = 1, ships, onHit }: CannonBallProps) {
  const ballRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Points>(null);
  const particlesRef = useRef<THREE.BufferAttribute | null>(null);
  const particleCount = 20;
  const particles = new Float32Array(particleCount * 3);

  const { playCannonFire, cannonBangSound, hitSound, successSound, explosionSound, isSfxMuted, sfxVolume } = useAudio();

  useEffect(() => {

    if (cannonBangSound && !isSfxMuted) {
      const scaledVolume = Math.min(1.0, sfxVolume * (1 + (allCannonBalls - 1) * 0.2));
      //console.log("CANON GO BOOM~", scaledVolume)
      // cannonBangSound.volume(scaledVolume);
      // cannonBangSound.play();
      useAudio.getState().playCannonFire();
      //playCannonFire();
    } else {
      //console.warn("cannon bang failed to play!", isSfxMuted, cannonBangSound)
    }
  }, [cannonBangSound, isSfxMuted, sfxVolume, allCannonBalls]);

  const checkCollision = () => {
    if (!ballRef.current) return;

    const ballPosition = ballRef.current.position;
    const ballRadius = 3;

    if (ships != undefined && ships.length > 0) {
      ships.forEach((ship, index) => {
        if (ship.sunk) return;

        const shipDims = getShipDimensions(ship.type);
        const shipPos = new THREE.Vector3(...ship.position);

        const shipHalfWidth = shipDims.width / 2;
        const shipHalfLength = shipDims.length / 2;

        const dx = Math.abs(ballPosition.x - shipPos.x);
        const dz = Math.abs(ballPosition.z - shipPos.z);

        if (
          dx < shipHalfWidth + ballRadius &&
          dz < shipHalfLength + ballRadius &&
          ballPosition.y < shipDims.height + ballRadius
        ) {
          if (!isSfxMuted) {
            useAudio.getState().playPlayerHit();

            hitSound?.play(); // General hit sound for all collisions

            if (ownerId === localPlayerId && ship.playerId !== localPlayerId) {
              successSound?.volume(sfxVolume * 0.5);
              successSound?.play(); // Player hits another player
            } else if (ship.playerId === localPlayerId) {
              explosionSound?.volume(sfxVolume * 0.7);
              explosionSound?.play(); // Player gets hit
            }
          }
          onHit(index, 10);
        }
      });
    }

  };

  const getShipDimensions = (type: string) => {
    switch (type) {
      case 'sloop': return { length: 40, width: 15, height: 20 };
      case 'brigantine': return { length: 60, width: 20, height: 25 };
      case 'galleon': return { length: 80, width: 30, height: 30 };
      case 'man-o-war': return { length: 100, width: 40, height: 35 };
      default: return { length: 40, width: 15, height: 20 };
    }
  };

  useFrame((_, delta) => {
    if (ballRef.current && trailRef.current) {
      const moveSpeed = 15 * delta * 60;
      ballRef.current.position.x += direction.x * moveSpeed;
      ballRef.current.position.y += direction.y * moveSpeed;
      ballRef.current.position.z += direction.z * moveSpeed;

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

      checkCollision();
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