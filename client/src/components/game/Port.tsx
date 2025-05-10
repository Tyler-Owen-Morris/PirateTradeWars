import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import { Port as PortType } from '@/types';
import * as THREE from 'three';
import { useGameState } from '@/lib/stores/useGameState';
import { PORT_INTERACTION_RADIUS } from '../../lib/constants';
import { Island } from './Island';

interface PortProps {
  port: PortType;
}

export function Port({ port }: PortProps) {
  const portRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Group>(null);
  const isNearPort = useRef(false);
  const { gameState } = useGameState();

  // Animate the port beacon
  useFrame(({ clock }) => {
    if (portRef.current) {
      const time = clock.getElapsedTime();

      // Rotate the beacon
      if (beaconRef.current) {
        beaconRef.current.rotation.y = time * 1.5;
      }

      // Check if player is near this port
      if (gameState.player) {
        const distance = useGameState.getState().calculateDistance(
          gameState.player.x,
          gameState.player.z,
          port.x,
          port.z
        );

        const nearPort = distance <= PORT_INTERACTION_RADIUS;

        // Only update if state changed
        if (nearPort !== isNearPort.current) {
          isNearPort.current = nearPort;

          // If entering port radius, update game state
          if (nearPort) {
            useGameState.getState().setNearPort(port.id);
            console.log(`Player entering port: ${port.name} (ID: ${port.id})`);
          } else if (useGameState.getState().gameState.nearestPort?.id === port.id) {
            // If leaving this port, clear the nearest port if it was this one
            useGameState.getState().setNearPort(null);
            console.log(`Player leaving port: ${port.name} (ID: ${port.id})`);
          }
        }
      }
    }
  });

  // Generate a consistent seed for this port's island
  const islandSeed = port.id * 100 + port.x + port.z;

  //console.log(`Rendering port ${port.name} with island at position [${port.x}, -15, ${port.z}]`);

  return (
    <group>
      {/* Island underneath the port */}
      <Island
        position={[port.x, -15, port.z]}
        size={350}
        seed={islandSeed}
        name={port.name}
      />

      {/* Simple port marker */}
      <group ref={portRef} position={[port.x, port.y || 25, port.z]}>
        {/* Port base */}
        {/* <mesh castShadow receiveShadow position={[0, 0, 0]}>
          <cylinderGeometry args={[40, 40, 10, 32]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh> */}

        {/* Port pillar */}
        {/* <mesh castShadow receiveShadow position={[0, 30, 0]}>
          <cylinderGeometry args={[5, 5, 50, 16]} />
          <meshStandardMaterial color="#A0522D" />
        </mesh> */}

        {/* Beacon on top (rotating) */}
        {/* <group ref={beaconRef} position={[0, 55, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[10, 16, 16]} />
            <meshStandardMaterial
              color="#FFD700"
              emissive="#FFD700"
              emissiveIntensity={1}
              toneMapped={false}
            />
          </mesh>
          <pointLight
            distance={500}
            intensity={2}
            color="#FFD700"
            castShadow
          />
        </group> */}

        {/* Port name display */}
        <Billboard position={[0, 200, 0]} follow={true}>
          <Text
            fontSize={20}
            color="#FFD700"
            anchorX="center"
            anchorY="middle"
            outlineWidth={2}
            outlineColor="#000000"
            renderOrder={1000}
          >
            {port.name}
          </Text>
          <Text
            position={[0, -15, 0]}
            fontSize={10}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            outlineWidth={1}
            outlineColor="#000000"
            renderOrder={101}
          >
            Press T to Trade
          </Text>
        </Billboard>

        {/* Trading radius indicator */}
        <mesh
          position={[0, -5, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[PORT_INTERACTION_RADIUS - 10, PORT_INTERACTION_RADIUS, 64]} />
          <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
