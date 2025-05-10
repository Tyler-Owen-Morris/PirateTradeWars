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

        model.position.y = dims.height + 10;
        if (type === 'galleon') {
          model.rotation.y = Math.PI / 2 + Math.PI;
        }
        if (type === 'man-o-war') {
          model.rotation.y = Math.PI
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
        console.log(`Loading ${type} model: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
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

  useEffect(() => {
    if (sunk && !hasPlayedSunkSound.current) {
      hasPlayedSunkSound.current = true;
      if (explosionSound && !isSfxMuted) {
        explosionSound.volume(isPlayer ? sfxVolume * 1.0 : sfxVolume * 0.5);
        explosionSound.play();
      }
    }
  }, [sunk, isPlayer, explosionSound, isSfxMuted, sfxVolume]);

  useFrame(() => {
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

    if (sunk && shipRef.current) {
      shipRef.current.position.y = Math.max(-40, shipRef.current.position.y - 0.2);
      shipRef.current.rotation.z = Math.min(Math.PI / 4, shipRef.current.rotation.z + 0.005);
    }
  });
  // console.log("SHIP_DIMENSIONS", SHIP_DIMENSIONS, type);

  const dims = SHIP_DIMENSIONS[type];
  const numMasts = SHIP_MAST_COUNTS[type];

  // return (
  //   <group ref={ref} position={position} rotation={[0, rotation, 0]}>
  //     <group ref={shipRef} position={[0, 0, 0]}>
  //       <mesh castShadow receiveShadow>
  //         <boxGeometry args={[dims.width, dims.height, dims.length]} />
  //         <meshStandardMaterial color={SHIP_COLORS[type]} />
  //       </mesh>
  //       <mesh position={[0, dims.height / 2 + 1, 0]} castShadow>
  //         <boxGeometry args={[dims.width, 2, dims.length]} />
  //         <meshStandardMaterial color="#D2B48C" />
  //       </mesh>
  //       {Array.from({ length: numMasts }).map((_, index) => {
  //         const spacing = dims.length / (numMasts + 1);
  //         const zPos = -dims.length / 2 + spacing * (index + 1);

  //         // Compute dynamic mast and sail properties
  //         const getMastProperties = (index: number, totalMasts: number) => {
  //           // Parabolic height distribution: taller in the middle, shorter at ends
  //           const t = totalMasts > 1 ? index / (totalMasts - 1) : 0.5; // Normalize index to [0, 1]
  //           const heightFactor = 1 - 0.4 * Math.pow(2 * t - 1, 2); // Parabolic curve
  //           const mastHeight = dims.mastHeight * (0.7 + 0.3 * heightFactor); // Range: 0.7–1.0 of base height

  //           // Sail dimensions proportional to mast height
  //           const sailWidth = (dims.width + 10) * (0.8 + 0.2 * heightFactor); // Scale with mast
  //           const sailHeight = mastHeight * 0.7; // 70% of mast height
  //           const sailOpacity = 0.9 - 0.1 * (1 - heightFactor); // Slightly more transparent at ends

  //           return { mastHeight, sailWidth, sailHeight, sailOpacity };
  //         };

  //         const { mastHeight, sailWidth, sailHeight, sailOpacity } = getMastProperties(index, numMasts);

  //         return (
  //           <group key={index} position={[0, 0, zPos]}>
  //             <mesh position={[0, dims.height / 2 + mastHeight / 2, 0]} castShadow>
  //               <cylinderGeometry args={[2, 2, mastHeight]} />
  //               <meshStandardMaterial color="#8B4513" />
  //             </mesh>
  //             <mesh position={[0, dims.height / 2 + mastHeight - sailHeight / 2 - 0.1 * sailHeight, 0]} castShadow>
  //               <planeGeometry args={[sailWidth, sailHeight]} />
  //               <meshStandardMaterial
  //                 color="#F5F5F5"
  //                 side={THREE.DoubleSide}
  //                 transparent
  //                 opacity={sailOpacity}
  //               />
  //             </mesh>
  //           </group>
  //         );
  //       })}
  //       <mesh position={[0, dims.height / 4, -dims.length / 2 - dims.length / 8]} castShadow>
  //         <coneGeometry args={[dims.width / 2, dims.length / 4, 32]} />
  //         <meshStandardMaterial color={SHIP_COLORS[type]} />
  //       </mesh>
  //       {Array.from({ length: numMasts }).map((_, index) => {
  //         const spacing = dims.length / (numMasts * 2);
  //         const zPos = -dims.length / 4 + spacing * (index * 2);
  //         return (
  //           <group key={`cannons-${index}`}>
  //             <mesh position={[-dims.width / 2 - 2, dims.height / 4, zPos]} rotation={[0, -Math.PI / 2, 0]} castShadow>
  //               <cylinderGeometry args={[2, 3, 8]} />
  //               <meshStandardMaterial color="#2F4F4F" />
  //             </mesh>
  //             <mesh position={[dims.width / 2 + 2, dims.height / 4, zPos]} rotation={[0, Math.PI / 2, 0]} castShadow>
  //               <cylinderGeometry args={[2, 3, 8]} />
  //               <meshStandardMaterial color="#2F4F4F" />
  //             </mesh>
  //           </group>
  //         );
  //       })}
  //     </group>
  //     <Billboard position={[0, dims.height + 70, 0]} follow={true} lockX={false} lockY={false} lockZ={false} renderOrder={2}>
  //       <Text fontSize={12} color="#ffffff" anchorX="center" anchorY="bottom" outlineWidth={0.5} outlineColor="#000000" renderOrder={3}>
  //         {name} {isPlayer ? "(You)" : ""}
  //       </Text>
  //       <mesh position={[0, -5, 0]}>
  //         <planeGeometry args={[40, 5]} />
  //         <meshBasicMaterial color="#333333" transparent={false} opacity={0.9} />
  //       </mesh>
  //       <mesh position={[-20 + 20 * (hp / maxHp), -5, 0.1]} ref={healthBarRef} renderOrder={4}>
  //         <planeGeometry args={[40, 5]} />
  //         <meshBasicMaterial transparent={false} opacity={1} color="#4CAF50" />
  //       </mesh>
  //     </Billboard>
  //   </group>
  // );
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