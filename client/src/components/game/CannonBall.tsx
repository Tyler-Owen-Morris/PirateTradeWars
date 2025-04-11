import { useRef, useEffect, useState } from 'react';
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
  range: number;
}

export function CannonBall({ position, direction, ownerId, localPlayerId, allCannonBalls = 1, ships, onHit, range }: CannonBallProps) {
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

  const { cannonBangSound, hitSound, successSound, explosionSound, isSfxMuted, sfxVolume } = useAudio();

  useEffect(() => {
    // Play sound only once on creation
    if (!hasPlayedSound && cannonBangSound && !isSfxMuted) {
      const scaledVolume = Math.min(1.0, sfxVolume * (1 + (allCannonBalls - 1) * 0.2));
      useAudio.getState().playCannonFire();
      setHasPlayedSound(true);
    }
  }, []);

  const checkCollision = () => {
    if (!ballRef.current) return;

    const ballPosition = ballRef.current.position;
    const ballRadius = 5;

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
            hitSound?.play();

            if (ownerId === localPlayerId && ship.playerId !== localPlayerId) {
              successSound?.play();
            } else if (ship.playerId === localPlayerId) {
              explosionSound?.play();
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
        // if (ballRef.current.position.x < 0) {
        //   ballRef.current.position.x += MAP_WIDTH;
        // } else if (ballRef.current.position.x > MAP_WIDTH) {
        //   ballRef.current.position.x -= MAP_WIDTH;
        // }
        // if (ballRef.current.position.z < 0) {
        //   ballRef.current.position.z += MAP_HEIGHT;
        // } else if (ballRef.current.position.z > MAP_HEIGHT) {
        //   ballRef.current.position.z -= MAP_HEIGHT;
        // }

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

        checkCollision();
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