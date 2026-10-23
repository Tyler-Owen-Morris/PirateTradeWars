import { forwardRef, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useAudio } from '@/lib/stores/useAudio';
import { SHIP_DIMENSIONS, SHIP_COLORS, SHIP_MAST_COUNTS, ShipType } from '@/lib/constants';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { factionFlagColors, npcNameplate } from '@/lib/world/factions';

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
  /** Live hp source read every frame (remote ships: hp changes without React re-renders). */
  getHp?: () => number;
  /** NPC2: AI ship nameplate ("Spanish Navy") and faction (flag colour). */
  npcTitle?: string;
  faction?: string;
}

export type { ShipProps };

export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(
  { position, rotation, type, name, hp, maxHp, sunk, isPlayer = false, playerId, onRotationChange, getHp, npcTitle, faction },
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
        if (type === 'brigantine') {
          model.rotation.y = Math.PI; // the .glb is authored stern-first
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
      const time = clock.elapsedTime; // NOT getElapsedTime(): it calls getDelta() and steals time from R3F's frame delta
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
      const liveHp = getHp ? getHp() : hp;
      const healthPercent = Math.max(0, Math.min(1, liveHp / maxHp));
      healthBarRef.current.scale.x = healthPercent;
      healthBarRef.current.position.x = -20 + 20 * healthPercent; // keep the bar left-aligned
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
  const isNpc = npcTitle !== undefined || faction !== undefined; // NPC2
  const flag = isNpc ? factionFlagColors(faction) : null;

  return (
    <group ref={ref} position={position} rotation={[0, 0, 0]}>
      <group ref={shipRef} position={[0, 0, 0]} />
      {flag && !sunk && (
        // NPC2: nation flag above the mast (field + stripe). A sibling of shipRef (whose children are
        // cleared imperatively when the model reloads); turns with the ship via the outer group.
        <group position={[0, dims.height + dims.mastHeight + 10, 0]}>
          <mesh position={[0, -6, 0]}>
            <cylinderGeometry args={[0.6, 0.6, 16, 6]} />
            <meshBasicMaterial color="#3e2723" />
          </mesh>
          <mesh position={[7, 0, 0]}>
            <planeGeometry args={[14, 9]} />
            <meshBasicMaterial color={flag.field} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[7, 0, 0.05]}>
            <planeGeometry args={[14, 2.5]} />
            <meshBasicMaterial color={flag.accent} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      <Billboard position={[0, dims.height + 70, 0]} follow={true} lockX={false} lockY={false} lockZ={false} renderOrder={2}>
        <Text fontSize={12} color="#ffffff" anchorX="center" anchorY="bottom" outlineWidth={0.5} outlineColor="#000000" renderOrder={3}>
          {name} {isPlayer ? "(You)" : ""}
        </Text>
        {isNpc && (
          // NPC2: "Spanish Navy — Galleon", tinted with the flag colour (pirates: light grey).
          <Text position={[0, 14, 0]} fontSize={9} color={flag!.field === '#111111' ? '#e0e0e0' : flag!.field} anchorX="center" anchorY="bottom" outlineWidth={0.5} outlineColor="#000000" renderOrder={3}>
            {npcNameplate(npcTitle, type)}
          </Text>
        )}
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