import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import { Port as PortType } from '@/types';
import * as THREE from 'three';
import { useGameState } from '@/lib/stores/useGameState';

interface PortProps {
  port: PortType;
}

export function Port({ port }: PortProps) {
  const portRef = useRef<THREE.Group>(null);
  const isNearPort = useRef(false);
  const { gameState } = useGameState();
  
  // Animate the port slightly
  useFrame(({ clock }) => {
    if (portRef.current) {
      // Gentle floating motion
      portRef.current.position.y = Math.sin(clock.getElapsedTime() * 0.5) * 5 + 10;
      portRef.current.rotation.y += 0.001;
      
      // Check if player is near this port
      if (gameState.player) {
        const distance = useGameState.getState().calculateDistance(
          gameState.player.x, 
          gameState.player.z, 
          port.x, 
          port.z
        );
        
        const nearPort = distance <= port.safeRadius;
        
        // Only update if state changed
        if (nearPort !== isNearPort.current) {
          isNearPort.current = nearPort;
          
          // If entering port radius, update game state
          if (nearPort) {
            useGameState.getState().setNearPort(port.id);
          }
        }
      }
    }
  });
  
  return (
    <group ref={portRef} position={[port.x, port.y, port.z]}>
      {/* Main port structure */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[100, 20, 100]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      
      {/* Dock extending from main port */}
      <mesh position={[0, 0, 70]} castShadow receiveShadow>
        <boxGeometry args={[30, 5, 40]} />
        <meshStandardMaterial color="#A0522D" />
      </mesh>
      
      {/* Simple buildings */}
      <group position={[0, 15, 0]}>
        {/* Central building */}
        <mesh position={[0, 10, 0]} castShadow>
          <boxGeometry args={[40, 20, 40]} />
          <meshStandardMaterial color="#D2B48C" />
        </mesh>
        
        {/* Roof */}
        <mesh position={[0, 25, 0]} castShadow>
          <coneGeometry args={[30, 15, 4]} />
          <meshStandardMaterial color="#8B0000" />
        </mesh>
        
        {/* Smaller buildings */}
        <mesh position={[-30, 7.5, -20]} castShadow>
          <boxGeometry args={[20, 15, 20]} />
          <meshStandardMaterial color="#DEB887" />
        </mesh>
        
        <mesh position={[30, 7.5, -20]} castShadow>
          <boxGeometry args={[20, 15, 20]} />
          <meshStandardMaterial color="#D2B48C" />
        </mesh>
      </group>
      
      {/* Port name display */}
      <Billboard position={[0, 60, 0]} follow={true}>
        <Text
          fontSize={15}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          font="/fonts/inter.json"
          outlineWidth={0.5}
          outlineColor="#000000"
        >
          {port.name}
        </Text>
      </Billboard>
      
      {/* Safe radius indicator - only visible when close */}
      <mesh 
        position={[0, -5, 0]} 
        rotation={[-Math.PI / 2, 0, 0]} 
        visible={isNearPort.current}
      >
        <ringGeometry args={[port.safeRadius - 5, port.safeRadius, 64]} />
        <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}
