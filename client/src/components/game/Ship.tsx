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
}

export type { ShipProps };

export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(
  { position, rotation, type, name, hp, maxHp, sunk, isPlayer = false, playerId },
  ref
) {
  const healthBarRef = useRef<THREE.Mesh>(null);
  const shipRef = useRef<THREE.Group>(null);
  const hasPlayedSunkSound = useRef(false);

  const { explosionSound, isSfxMuted, sfxVolume } = useAudio();

  // Wave animation
  const waveSeed = useRef(playerId ? parseInt(playerId, 36) % 1000 / 1000 : Math.random()); // Unique seed per ship
  const BOB_AMPLITUDE = 2; // Max vertical displacement (in units, e.g., meters)
  const BOB_FREQUENCY = 0.12; // Cycles per second for bobbing
  const ROLL_AMPLITUDE = THREE.MathUtils.degToRad(5); // Max roll angle (5 degrees)
  const ROLL_FREQUENCY = 0.1; // Cycles per second for rolling
  const PITCH_AMPLITUDE = THREE.MathUtils.degToRad(3); // Max pitch angle (3 degrees)
  const PITCH_FREQUENCY = 0.09; // Cycles per second for pitching

  // Load the glTF model
  useEffect(() => {
    const loader = new GLTFLoader();
    const modelPath = `/ship_models/${type}.glb`; // e.g., /ship_models/sloop.glb

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;

        // Scale model to match SHIP_DIMENSIONS
        const dims = SHIP_DIMENSIONS[type];
        const scaleFactor = dims.length / 1; // Adjust if model’s native length differs
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // Position model for each type that needs specific tweaks
        model.position.y = dims.height + 10;
        if (type === 'galleon') {
          model.rotation.y = Math.PI / 2 + Math.PI;
          let localScaleFactor = dims.length / 1.4;
          model.scale.set(localScaleFactor, localScaleFactor, localScaleFactor);
        }
        if (type === 'man-o-war') {
          model.rotation.y = Math.PI
        }
        if (type === 'dreadnaught') {
          model.rotation.y = Math.PI / 2 + Math.PI;
          model.position.y = dims.height + 20;
          let localScaleFactor = dims.length / 1.6;
          model.scale.set(localScaleFactor, localScaleFactor, localScaleFactor);
        }

        // Enable shadows
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Add model to shipRef
        if (shipRef.current) {
          shipRef.current.add(model);
        }
      },
      (progress) => {
        //console.log(`Loading ${type} model: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
      },
      (error) => {
        console.error(`Error loading ${type} model:`, error);
      }
    );

    // Cleanup on unmount
    return () => {
      if (shipRef.current) {
        shipRef.current.clear();
      }
    };
  }, [type]);

  // Play the sunk sound
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
      const time = clock.getElapsedTime(); // Time in seconds
      const dims = SHIP_DIMENSIONS[type];

      // Wave-like motion (only if not sunk)
      if (!sunk) {
        // Bobbing (Y-axis translation)
        const bobOffset = Math.sin(time * BOB_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI) * BOB_AMPLITUDE;
        shipRef.current.position.y = bobOffset;

        // Rolling (Z-axis rotation)
        const rollAngle = Math.sin(time * ROLL_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI * 0.5) * ROLL_AMPLITUDE;
        shipRef.current.rotation.z = rollAngle;

        // Pitching (X-axis rotation)
        const pitchAngle = Math.cos(time * PITCH_FREQUENCY * 2 * Math.PI + waveSeed.current * Math.PI * 0.7) * PITCH_AMPLITUDE;
        shipRef.current.rotation.x = pitchAngle;
      } else {
        // Sinking behavior (existing code)
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

    // if (sunk && shipRef.current) {
    //   shipRef.current.position.y = Math.max(-40, shipRef.current.position.y - 0.2);
    //   shipRef.current.rotation.z = Math.min(Math.PI / 4, shipRef.current.rotation.z + 0.005);
    // }
  });
  // console.log("SHIP_DIMENSIONS", SHIP_DIMENSIONS, type);

  const dims = SHIP_DIMENSIONS[type];
  const numMasts = SHIP_MAST_COUNTS[type];


  return (
    <group ref={ref} position={position} rotation={[0, rotation, 0]}>
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