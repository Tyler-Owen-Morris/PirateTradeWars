import { forwardRef, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useAudio } from '@/lib/stores/useAudio';
import { SHIP_DIMENSIONS, SHIP_COLORS, SHIP_MAST_COUNTS, ShipType } from '@/lib/constants';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ShipProps {
  position: [number, number, number];
  rotation: number;
  type: ShipType;
  name: string;
  hp: number;
  maxHp: number;
  sunk: boolean;
  isPlayer?: boolean;
  playerId?: string;
  onRotationChange?: (rotation: number) => void;
}

export type { ShipProps };

export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(
  { position, rotation, type, name, hp, maxHp, sunk, isPlayer = false, playerId, onRotationChange },
  ref
) {
  const healthBarRef = useRef<THREE.Mesh>(null);
  const shipRef = useRef<THREE.Group>(null);
  const hasPlayedSunkSound = useRef(false);

  const { explosionSound, isSfxMuted, sfxVolume } = useAudio();

  const waveSeed = useRef(playerId ? parseInt(playerId, 36) % 1000 / 1000 : Math.random());
  const BOB_AMPLITUDE = 2;
  const BOB_FREQUENCY = 0.12;
  const ROLL_AMPLITUDE = THREE.MathUtils.degToRad(5);
  const ROLL_FREQUENCY = 0.1;
  const PITCH_AMPLITUDE = THREE.MathUtils.degToRad(3);
  const PITCH_FREQUENCY = 0.09;

  useEffect(() => {
    const loader = new GLTFLoader();
    const modelPath = `/ship_models/${type}.glb`;

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        const dims = SHIP_DIMENSIONS[type];
        const scaleFactor = dims.length / 1;
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        model.position.y = dims.height + 10;
        if (type === 'sloop') {
          model.position.y = dims.height - 5;
        }
        if (type === 'galleon') {
          model.rotation.y = Math.PI / 2 + Math.PI;
          let localScaleFactor = dims.length / 1.4;
          model.scale.set(localScaleFactor, localScaleFactor, localScaleFactor);
        }
        if (type === 'man-o-war') {
          model.rotation.y = Math.PI;
        }
        if (type === 'dreadnaught') {
          model.rotation.y = Math.PI / 2 + Math.PI;
          model.position.y = dims.height + 20;
          let localScaleFactor = dims.length / 1.6;
          model.scale.set(localScaleFactor, localScaleFactor, localScaleFactor);
        }
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        if (shipRef.current) {
          shipRef.current.add(model);
        }
      },
      (progress) => { },
      (error) => {
        console.error(`Error loading ${type} model:`, error);
      }
    );

    return () => {
      if (shipRef.current) {
        shipRef.current.clear();
      }
    };
  }, [type]);

  useEffect(() => {
    if (sunk && !hasPlayedSunkSound.current) {
      hasPlayedSunkSound.current = true;
      if (explosionSound && !isSfxMuted) {
        explosionSound.volume(isPlayer ? sfxVolume * 1.0 : sfxVolume * 0.5);
        explosionSound.play();
      }
    }
  }, [sunk, isPlayer, explosionSound, isSfxMuted, sfxVolume]);

  useFrame(({ clock }) => {
    if (shipRef.current) {
      const time = clock.getElapsedTime();
      const dims = SHIP_DIMENSIONS[type];

      if (!isPlayer) {
        shipRef.current.rotation.y = rotation;
      }

      if (!sunk) {
        const bobOffset = Math.sin(time * BOB_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI) * BOB_AMPLITUDE;
        shipRef.current.position.y = bobOffset;
        const rollAngle = Math.sin(time * ROLL_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI * 0.5) * ROLL_AMPLITUDE;
        shipRef.current.rotation.z = rollAngle;
        const pitchAngle = Math.cos(time * PITCH_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI * 0.7) * PITCH_AMPLITUDE;
        shipRef.current.rotation.x = pitchAngle;
      } else {
        shipRef.current.position.y = Math.max(-40, shipRef.current.position.y - 0.2);
        shipRef.current.rotation.z = Math.min(Math.PI / 4, shipRef.current.rotation.z + 0.005);
      }
    }

    if (healthBarRef.current) {
      const healthPercent = Math.max(0, hp / maxHp);
      healthBarRef.current.scale.x = healthPercent;
      if (healthPercent > 0.6) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#4CAF50');
      } else if (healthPercent > 0.3) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#FF9800');
      } else {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#F44336');
      }
    }
  });

  const dims = SHIP_DIMENSIONS[type];

  return (
    <group ref={ref} position={position} rotation={[0, 0, 0]}>
      <group ref={shipRef} position={[0, 0, 0]} />
      <Billboard position={[0, dims.height + 70, 0]} follow={true} lockX={false} lockY={false} lockZ={false} renderOrder={2}>
        <Text fontSize={12} color="#ffffff" anchorX="center" anchorY="bottom" outlineWidth={0.5} outlineColor="#000000" renderOrder={3}>
          {name} {isPlayer ? "(You)" : ""}
        </Text>
        <mesh position={[0, -5, 0]}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial color="#333333" transparent={false} opacity={0.9} />
        </mesh>
        <mesh position={[-20 + 20 * (hp / maxHp), -5, 0.1]} ref={healthBarRef} renderOrder={4}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial transparent={false} opacity={1} color="#4CAF50" />
        </mesh>
      </Billboard>
    </group>
  );
});