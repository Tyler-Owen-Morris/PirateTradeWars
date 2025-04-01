import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard, useTexture } from '@react-three/drei';
import { Port as PortType } from '@/types';
import * as THREE from 'three';
import { useGameState } from '@/lib/stores/useGameState';
import { PORT_INTERACTION_RADIUS } from '../../lib/constants';
import { Island } from './Island';
import { PortCity } from './PortCity';

interface PortProps {
  port: PortType;
}

export function Port({ port }: PortProps) {
  const portRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const isNearPort = useRef(false);
  const { gameState } = useGameState();
  
  // Animate the port
  useFrame(({ clock }) => {
    if (portRef.current) {
      const time = clock.getElapsedTime();
      
      // Animate the trading radius ring
      if (ringRef.current) {
        // Pulse scale
        const scale = 0.9 + Math.sin(time * 2) * 0.1;
        ringRef.current.scale.set(scale, scale, scale);
        
        // Rotate slowly
        ringRef.current.rotation.z += 0.002;
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
            console.log(`Setting near port: ${port.name} (ID: ${port.id})`);
          } else if (useGameState.getState().gameState.nearestPort?.id === port.id) {
            // If leaving this port, clear the nearest port if it was this one
            useGameState.getState().setNearPort(null);
          }
        }
      }
    }
  });
  
  // Generate a consistent seed for this port's island and city
  const seed = port.id * 100 + port.x + port.z;
  
  console.log(`Rendering port ${port.name} with city at position [${port.x}, 0, ${port.z}]`);
  
  return (
    <group>
      {/* Island underneath the port */}
      <Island 
        position={[port.x, -15, port.z]} 
        size={350} 
        seed={seed} 
      />
      
      {/* Port city on the island */}
      <PortCity
        position={[port.x, 10, port.z]}
        size={180}
        seed={seed}
        cityName={port.name}
      />
      
      {/* Port elements */}
      <group ref={portRef} position={[port.x, port.y || 20, port.z]}>
        {/* Port name display - larger and more visible */}
        <Billboard position={[0, 120, 0]} follow={true}>
          <Text
            fontSize={22}
            color="#FFD700" // Gold color for better visibility
            anchorX="center"
            anchorY="middle"
            font="/fonts/inter.json"
            outlineWidth={2}
            outlineColor="#000000"
          >
            {port.name}
          </Text>
          <Text
            position={[0, -15, 0]}
            fontSize={12}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            font="/fonts/inter.json"
            outlineWidth={1}
            outlineColor="#000000"
          >
            Press T to Trade
          </Text>
        </Billboard>
        
        {/* Trading radius indicator - always visible */}
        <mesh 
          ref={ringRef}
          position={[0, -5, 0]} 
          rotation={[-Math.PI / 2, 0, 0]} 
        >
          <ringGeometry args={[PORT_INTERACTION_RADIUS - 10, PORT_INTERACTION_RADIUS, 64]} />
          <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Secondary rings for visual effect */}
        <mesh 
          position={[0, -3, 0]} 
          rotation={[-Math.PI / 2, 0, 0]} 
        >
          <ringGeometry args={[PORT_INTERACTION_RADIUS/2, PORT_INTERACTION_RADIUS/2 + 5, 64]} />
          <meshBasicMaterial color="#FFD700" transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Near port indicator - only visible when close */}
        <mesh 
          position={[0, 0, 0]} 
          rotation={[-Math.PI / 2, 0, 0]} 
          visible={isNearPort.current}
        >
          <ringGeometry args={[PORT_INTERACTION_RADIUS/4, PORT_INTERACTION_RADIUS/4 + 10, 64]} />
          <meshBasicMaterial color="#FF4500" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
