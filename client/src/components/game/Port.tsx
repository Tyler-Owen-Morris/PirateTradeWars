import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard, useTexture } from '@react-three/drei';
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
  const lightRef = useRef<THREE.PointLight>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const isNearPort = useRef(false);
  const { gameState } = useGameState();
  
  // Load wood texture for the port
  const woodTexture = useTexture("/textures/wood.jpg");
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(2, 2);
  
  // Animate the port
  useFrame(({ clock }) => {
    if (portRef.current) {
      const time = clock.getElapsedTime();
      
      // Rotate the beacon light
      if (beaconRef.current) {
        beaconRef.current.rotation.y += 0.03;
      }
      
      // Animate the beacon light
      if (lightRef.current) {
        // Pulse the light intensity
        const pulseIntensity = Math.sin(time * 2) * 0.5 + 1.5;
        lightRef.current.intensity = pulseIntensity;
        
        // Slowly change light color for a dynamic effect
        const hue = (time * 0.05) % 1;
        lightRef.current.color.setHSL(hue, 0.7, 0.5);
      }
      
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
  
  // Generate a consistent seed for this port's island
  const islandSeed = port.id * 100 + port.x + port.z;
  
  return (
    <group>
      {/* Island underneath the port */}
      <Island 
        position={[port.x, -15, port.z]} 
        size={350} 
        seed={islandSeed} 
      />
      
      {/* Port structures on the island */}
      <group ref={portRef} position={[port.x, port.y || 20, port.z]}>
        {/* Main port structure */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[100, 20, 100]} />
          <meshStandardMaterial map={woodTexture} color="#8B4513" />
        </mesh>
        
        {/* Docks extending from main port - now in multiple directions for better visibility */}
        <mesh position={[0, 0, 70]} castShadow receiveShadow>
          <boxGeometry args={[30, 5, 40]} />
          <meshStandardMaterial map={woodTexture} color="#A0522D" />
        </mesh>
        
        <mesh position={[0, 0, -70]} castShadow receiveShadow>
          <boxGeometry args={[30, 5, 40]} />
          <meshStandardMaterial map={woodTexture} color="#A0522D" />
        </mesh>
        
        <mesh position={[70, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[40, 5, 30]} />
          <meshStandardMaterial map={woodTexture} color="#A0522D" />
        </mesh>
        
        <mesh position={[-70, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[40, 5, 30]} />
          <meshStandardMaterial map={woodTexture} color="#A0522D" />
        </mesh>
        
        {/* Simple buildings */}
        <group position={[0, 15, 0]}>
          {/* Central building */}
          <mesh position={[0, 10, 0]} castShadow>
            <boxGeometry args={[40, 20, 40]} />
            <meshStandardMaterial map={woodTexture} color="#D2B48C" />
          </mesh>
          
          {/* Roof */}
          <mesh position={[0, 25, 0]} castShadow>
            <coneGeometry args={[30, 15, 4]} />
            <meshStandardMaterial color="#8B0000" />
          </mesh>
          
          {/* Smaller buildings */}
          <mesh position={[-30, 7.5, -20]} castShadow>
            <boxGeometry args={[20, 15, 20]} />
            <meshStandardMaterial map={woodTexture} color="#DEB887" />
          </mesh>
          
          <mesh position={[30, 7.5, -20]} castShadow>
            <boxGeometry args={[20, 15, 20]} />
            <meshStandardMaterial map={woodTexture} color="#D2B48C" />
          </mesh>
        </group>
        
        {/* Lighthouse/beacon tower */}
        <group position={[0, 15, -40]}>
          <mesh castShadow>
            <cylinderGeometry args={[8, 10, 40, 16]} />
            <meshStandardMaterial color="#EFEFEF" />
          </mesh>
          
          {/* Beacon light housing */}
          <mesh position={[0, 25, 0]} castShadow>
            <cylinderGeometry args={[7, 7, 10, 16]} />
            <meshStandardMaterial color="#333333" />
          </mesh>
          
          {/* Rotating beacon light */}
          <mesh ref={beaconRef} position={[0, 25, 0]}>
            <pointLight 
              ref={lightRef}
              distance={800}
              intensity={2}
              color="#FFD700"
              castShadow
            />
            <mesh position={[0, 0, 3]}>
              <boxGeometry args={[2, 2, 10]} />
              <meshStandardMaterial 
                color="#FFD700"
                emissive="#FFD700"
                emissiveIntensity={2}
                toneMapped={false}
              />
            </mesh>
          </mesh>
        </group>
        
        {/* Port name display - larger and more visible */}
        <Billboard position={[0, 100, 0]} follow={true}>
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
