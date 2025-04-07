import { forwardRef, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';

interface ShipProps {
  position: [number, number, number];
  rotation: number;
  type: string;
  name: string;
  hp: number;
  maxHp: number;
  sunk: boolean;
  isPlayer?: boolean;
}

export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(
  { position, rotation, type, name, hp, maxHp, sunk, isPlayer = false }, 
  ref
) {
  const healthBarRef = useRef<THREE.Mesh>(null);
  const shipRef = useRef<THREE.Group>(null);
  
  // Get base color from ship type
  const getShipColor = () => {
    switch (type) {
      case 'sloop':
        return '#8B4513'; // Brown
      case 'brigantine':
        return '#A0522D'; // Sienna
      case 'galleon':
        return '#CD853F'; // Peru
      case 'man-o-war':
        return '#D2691E'; // Chocolate
      default:
        return '#8B4513'; // Default brown
    }
  };
  
  // Get ship dimensions based on type
  const getShipDimensions = () => {
    switch (type) {
      case 'sloop':
        return { length: 40, width: 15, height: 20, mastHeight: 50 };
      case 'brigantine':
        return { length: 60, width: 20, height: 25, mastHeight: 60 };
      case 'galleon':
        return { length: 80, width: 30, height: 30, mastHeight: 70 };
      case 'man-o-war':
        return { length: 100, width: 40, height: 35, mastHeight: 80 };
      default:
        return { length: 40, width: 15, height: 20, mastHeight: 50 };
    }
  };
  
  // Get number of masts based on ship type
  const getNumMasts = () => {
    switch (type) {
      case 'sloop': return 1;
      case 'brigantine': return 2;
      case 'galleon': return 3;
      case 'man-o-war': return 4;
      default: return 1;
    }
  };
  
  // Update the health bar
  useFrame(() => {
    if (healthBarRef.current) {
      const healthPercent = Math.max(0, hp / maxHp);
      healthBarRef.current.scale.x = healthPercent;
      
      // Health bar color based on health percentage
      if (healthPercent > 0.6) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#4CAF50'); // Green
      } else if (healthPercent > 0.3) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#FF9800'); // Orange
      } else {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#F44336'); // Red
      }
    }
    
    // If ship is sunk, make it sink gradually
    if (sunk && shipRef.current) {
      shipRef.current.position.y = Math.max(-40, shipRef.current.position.y - 0.2);
      shipRef.current.rotation.z = Math.min(Math.PI / 4, shipRef.current.rotation.z + 0.005);
    }
  });
  
  const dims = getShipDimensions();
  const numMasts = getNumMasts();
  
  return (
    <group ref={ref} position={position} rotation={[0, rotation, 0]}>
      <group ref={shipRef} position={[0, 0, 0]}>
        {/* Ship hull */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[dims.width, dims.height, dims.length]} />
          <meshStandardMaterial color={getShipColor()} />
        </mesh>
        
        {/* Ship deck */}
        <mesh position={[0, dims.height / 2 + 1, 0]} castShadow>
          <boxGeometry args={[dims.width, 2, dims.length]} />
          <meshStandardMaterial color="#D2B48C" />
        </mesh>
        
        {/* Ship masts */}
        {Array.from({ length: numMasts }).map((_, index) => {
          const spacing = dims.length / (numMasts + 1);
          const zPos = -dims.length / 2 + spacing * (index + 1);
          
          return (
            <group key={index} position={[0, 0, zPos]}>
              {/* Mast */}
              <mesh position={[0, dims.height / 2 + dims.mastHeight / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 2, dims.mastHeight]} />
                <meshStandardMaterial color="#8B4513" />
              </mesh>
              
              {/* Sail */}
              <mesh position={[0, dims.height / 2 + dims.mastHeight / 3, 0]} castShadow>
                <planeGeometry args={[dims.width + 10, dims.mastHeight * 0.7]} />
                <meshStandardMaterial 
                  color="#F5F5F5" 
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            </group>
          );
        })}
        
        {/* Ship bow (front point) */}
        <mesh position={[0, dims.height / 4, -dims.length / 2 - dims.length / 8]} castShadow>
          <coneGeometry args={[dims.width / 2, dims.length / 4, 32]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color={getShipColor()} />
        </mesh>
        
        {/* Cannon ports - represent the number of cannons on each side */}
        {Array.from({ length: getNumMasts() }).map((_, index) => {
          const spacing = dims.length / (getNumMasts() * 2);
          const zPos = -dims.length / 4 + spacing * (index * 2);
          
          return (
            <group key={`cannons-${index}`}>
              {/* Port side (left) cannon */}
              <mesh position={[-dims.width / 2 - 2, dims.height / 4, zPos]} rotation={[0, -Math.PI / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 3, 8]} />
                <meshStandardMaterial color="#2F4F4F" />
              </mesh>
              
              {/* Starboard side (right) cannon */}
              <mesh position={[dims.width / 2 + 2, dims.height / 4, zPos]} rotation={[0, Math.PI / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 3, 8]} />
                <meshStandardMaterial color="#2F4F4F" />
              </mesh>
            </group>
          );
        })}
      </group>
      
      {/* Ship name and health bar */}
      <Billboard
        position={[0, dims.height + 30, 0]}
        follow={true}
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        {/* Ship name */}
        <Text
          fontSize={12}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.5}
          outlineColor="#000000"
        >
          {name} {isPlayer ? "(You)" : ""}
        </Text>
        
        {/* Health bar background */}
        <mesh position={[0, -5, 0]}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial color="#333333" transparent opacity={0.7} />
        </mesh>
        
        {/* Health bar foreground */}
        <mesh position={[-20 + 20 * (hp / maxHp), -5, 0.1]} ref={healthBarRef}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial color="#4CAF50" />
        </mesh>
      </Billboard>
    </group>
  );
});
