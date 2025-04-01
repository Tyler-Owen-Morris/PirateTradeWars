import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

interface PortCityProps {
  position: [number, number, number];
  size?: number;
  seed?: number;
  cityName: string;
}

// Simplified version of PortCity to fix rendering issues
export function PortCity({ position, size = 200, seed = 1, cityName }: PortCityProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Load textures
  const woodTexture = useTexture('/textures/wood.jpg');
  const stoneTexture = useTexture('/textures/asphalt.png');
  
  // Configure textures
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(2, 2);
  stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
  stoneTexture.repeat.set(4, 4);
  
  // Gentle city animation (slight bob)
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const time = clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 0.2) * 1 + position[1];
    }
  });
  
  // Create a deterministic "random" function based on the seed
  const getRandom = (index: number) => {
    return ((seed * 9301 + index * 49297) % 233280) / 233280;
  };
  
  // Calculate city radius
  const cityRadius = size * 0.5;
  
  return (
    <group ref={groupRef} position={position}>
      {/* Main city plaza */}
      <mesh position={[0, 1, 0]} receiveShadow>
        <cylinderGeometry args={[cityRadius * 0.6, cityRadius * 0.6, 2, 24]} />
        <meshStandardMaterial map={stoneTexture} color="#a9a9a9" roughness={0.8} />
      </mesh>
      
      {/* City walls */}
      <mesh position={[0, 12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[cityRadius, cityRadius * 1.1, 24, 32, 1, true]} />
        <meshStandardMaterial map={stoneTexture} color="#808080" roughness={1.0} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Main central building (lighthouse) */}
      <mesh position={[0, 40, 0]} castShadow>
        <cylinderGeometry args={[15, 20, 60, 16]} />
        <meshStandardMaterial color="#EFEFEF" roughness={0.4} />
      </mesh>
      
      {/* Lighthouse top */}
      <mesh position={[0, 80, 0]} castShadow>
        <cylinderGeometry args={[10, 10, 20, 16]} />
        <meshStandardMaterial color="#333333" roughness={0.3} />
      </mesh>
      
      {/* Lighthouse light */}
      <mesh position={[0, 90, 0]}>
        <pointLight
          distance={800}
          intensity={2}
          color="#FFD700"
        />
        <sphereGeometry args={[7, 16, 16]} />
        <meshStandardMaterial
          color="#FFD700"
          emissive="#FFD700"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      
      {/* Four cardinal buildings */}
      {[0, 1, 2, 3].map(i => {
        const angle = (i / 4) * Math.PI * 2;
        const posX = Math.cos(angle) * (cityRadius * 0.5);
        const posZ = Math.sin(angle) * (cityRadius * 0.5);
        const buildingHeight = 20 + getRandom(i) * 20;
        
        return (
          <group key={`building-${i}`} position={[posX, 10, posZ]}>
            {/* Main building */}
            <mesh castShadow>
              <boxGeometry args={[20, buildingHeight, 20]} />
              <meshStandardMaterial 
                map={woodTexture} 
                color={i % 2 === 0 ? "#D2B48C" : "#8B4513"} 
                roughness={0.7} 
              />
            </mesh>
            
            {/* Roof */}
            <group position={[0, buildingHeight/2 + 5, 0]}>
              <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[14, 10, 4]} />
                <meshStandardMaterial color="#8B0000" roughness={0.6} />
              </mesh>
            </group>
          </group>
        );
      })}
      
      {/* Four docks extending from the city */}
      {[0, 1, 2, 3].map(i => {
        const angle = (i / 4) * Math.PI * 2;
        const dockLength = size * 0.6;
        const dockWidth = 20;
        
        return (
          <group key={`dock-${i}`} rotation={[0, angle, 0]}>
            {/* Main dock */}
            <mesh 
              position={[0, 0, cityRadius + dockLength / 2]} 
              castShadow 
              receiveShadow
            >
              <boxGeometry args={[dockWidth, 5, dockLength]} />
              <meshStandardMaterial map={woodTexture} color="#A0522D" />
            </mesh>
            
            {/* Dock building */}
            <mesh
              position={[0, 8, cityRadius + dockLength - 10]}
              castShadow
            >
              <boxGeometry args={[dockWidth - 4, 15, 20]} />
              <meshStandardMaterial map={woodTexture} color="#DEB887" />
            </mesh>
            
            {/* Dock building roof */}
            <group position={[0, 18, cityRadius + dockLength - 10]}>
              <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[dockWidth / 2, 8, 4]} />
                <meshStandardMaterial color="#8B0000" roughness={0.6} />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}