import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';

interface PortCityProps {
  position: [number, number, number];
  size?: number;
  seed?: number;
  cityName: string;
}

export function PortCity({ position, size = 200, seed = 1, cityName }: PortCityProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Load textures
  const woodTexture = useTexture('/textures/wood.jpg');
  const stoneTexture = useTexture('/textures/asphalt.png'); // Using asphalt as stone texture
  
  // Configure textures
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(2, 2);
  stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
  stoneTexture.repeat.set(4, 4);
  
  // Gentle city animation (slight bob)
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const time = clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 0.2) * 1 + position[1]; // Subtle floating effect
    }
  });
  
  // Generate all city elements using useMemo for better performance
  const cityElements = useMemo(() => {
    // Create a seeded random generator function
    const createRandom = () => {
      let currentSeed = seed;
      return () => {
        currentSeed = (currentSeed * 9301 + 49297) % 233280;
        return currentSeed / 233280;
      };
    };
    
    // Create random generators
    const random = createRandom();
    const randFloat = (min: number, max: number) => min + random() * (max - min);
    const randInt = (min: number, max: number) => Math.floor(randFloat(min, max + 1));
    const randColor = () => {
      const colors = ['#D2B48C', '#8B4513', '#A0522D', '#CD853F', '#DEB887'];
      return colors[Math.floor(random() * colors.length)];
    };
    
    // City parameters
    const buildingCount = randInt(8, 15);
    const cityRadius = size * 0.5;
    const dockLength = size * 0.8;
    const tallestBuilding = size * 0.4;
    
    // Main central plaza
    const plaza = (
      <mesh position={[0, 1, 0]} receiveShadow>
        <cylinderGeometry args={[cityRadius * 0.6, cityRadius * 0.6, 2, 24]} />
        <meshStandardMaterial map={stoneTexture} color="#a9a9a9" roughness={0.8} />
      </mesh>
    );
    
    // City walls
    const cityWall = (
      <mesh position={[0, 12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[cityRadius, cityRadius * 1.1, 24, 32, 1, true]} />
        <meshStandardMaterial map={stoneTexture} color="#808080" roughness={1.0} side={THREE.DoubleSide} />
      </mesh>
    );
    
    // Wall ramparts/crown
    const wallCrown = (
      <mesh position={[0, 24, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[cityRadius * 1.05, cityRadius * 1.05, 4, 32]} />
        <meshStandardMaterial map={stoneTexture} color="#696969" roughness={1.0} />
      </mesh>
    );
    
    // Generate buildings
    const buildings = [];
    for (let i = 0; i < buildingCount; i++) {
      // Position buildings in a circular pattern
      const angle = (i / buildingCount) * Math.PI * 2;
      const distance = randFloat(cityRadius * 0.2, cityRadius * 0.8);
      const posX = Math.cos(angle) * distance;
      const posZ = Math.sin(angle) * distance;
      
      // Building dimensions
      const buildingHeight = randFloat(tallestBuilding * 0.3, tallestBuilding);
      const buildingWidth = randFloat(15, 25);
      const buildingDepth = randFloat(15, 25);
      const stories = Math.floor(buildingHeight / 10);
      
      // Create building with stories
      const buildingStories = [];
      for (let j = 0; j < stories; j++) {
        const isGroundFloor = j === 0;
        const storyHeight = isGroundFloor ? 12 : 8;
        const storyWidth = buildingWidth - j * 2; // Buildings get slightly narrower as they go up
        const storyDepth = buildingDepth - j * 2;
        const storyY = j * storyHeight;
        
        buildingStories.push(
          <mesh 
            key={`building-${i}-story-${j}`} 
            position={[0, storyY + storyHeight / 2, 0]} 
            castShadow 
            receiveShadow
          >
            <boxGeometry args={[storyWidth, storyHeight, storyDepth]} />
            <meshStandardMaterial 
              map={woodTexture} 
              color={randColor()} 
              roughness={0.7} 
              metalness={0.1} 
            />
          </mesh>
        );
        
        // Add windows to non-ground floors
        if (!isGroundFloor) {
          const windowPositions: [number, number, number][] = [];
          const windowSize = 1.5;
          const windowCount = Math.floor(storyWidth / 5);
          
          // Front and back windows
          for (let w = 0; w < windowCount; w++) {
            const windowX = -storyWidth / 2 + 5 + w * 5;
            windowPositions.push([windowX, storyY + storyHeight / 2, storyDepth / 2 + 0.1]);
            windowPositions.push([windowX, storyY + storyHeight / 2, -storyDepth / 2 - 0.1]);
          }
          
          // Side windows
          const sideWindowCount = Math.floor(storyDepth / 5);
          for (let w = 0; w < sideWindowCount; w++) {
            const windowZ = -storyDepth / 2 + 5 + w * 5;
            windowPositions.push([storyWidth / 2 + 0.1, storyY + storyHeight / 2, windowZ]);
            windowPositions.push([-storyWidth / 2 - 0.1, storyY + storyHeight / 2, windowZ]);
          }
          
          windowPositions.forEach((pos, idx) => {
            buildingStories.push(
              <mesh key={`window-${i}-${j}-${idx}`} position={pos}>
                <boxGeometry args={[windowSize, windowSize, 0.5]} />
                <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} />
              </mesh>
            );
          });
        }
        
        // Add doors to ground floor
        if (isGroundFloor) {
          const doorWidth = 4;
          const doorHeight = 7;
          const doorPositions: [number, number, number][] = [
            [0, doorHeight / 2, storyDepth / 2 + 0.1], // Front door
            [0, doorHeight / 2, -storyDepth / 2 - 0.1], // Back door
          ];
          
          doorPositions.forEach((pos, idx) => {
            buildingStories.push(
              <mesh key={`door-${i}-${idx}`} position={pos}>
                <boxGeometry args={[doorWidth, doorHeight, 0.5]} />
                <meshStandardMaterial color="#8B4513" />
              </mesh>
            );
          });
        }
        
        // Add roof to top story
        if (j === stories - 1) {
          buildingStories.push(
            <group
              key={`roof-${i}`}
              position={[0, storyY + storyHeight + 4, 0]}
            >
              <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[storyWidth * 0.7, 8, 4]} />
                <meshStandardMaterial color="#8B0000" roughness={0.6} />
              </mesh>
            </group>
          );
        }
      }
      
      buildings.push(
        <group key={`building-${i}`} position={[posX, 2, posZ]}>
          {buildingStories}
        </group>
      );
    }
    
    // Create docks extending from the city
    const docks = [];
    const dockCount = 4;
    for (let i = 0; i < dockCount; i++) {
      const angle = (i / dockCount) * Math.PI * 2;
      const dockWidth = 20;
      
      // Main dock
      docks.push(
        <group key={`dock-${i}`} rotation={[0, angle, 0]}>
          <mesh 
            position={[0, 0, cityRadius + dockLength / 2]} 
            castShadow 
            receiveShadow
          >
            <boxGeometry args={[dockWidth, 5, dockLength]} />
            <meshStandardMaterial map={woodTexture} color="#A0522D" />
          </mesh>
          
          {/* Dock supports */}
          {Array.from({ length: 5 }).map((_, idx) => (
            <mesh 
              key={`dock-${i}-support-${idx}`} 
              position={[0, -5, cityRadius + idx * (dockLength / 4)]} 
            >
              <boxGeometry args={[dockWidth + 2, 10, 3]} />
              <meshStandardMaterial color="#8B4513" />
            </mesh>
          ))}
          
          {/* Small buildings at the end of each dock */}
          <mesh
            position={[0, 8, cityRadius + dockLength - 10]}
            castShadow
          >
            <boxGeometry args={[dockWidth - 4, 15, 20]} />
            <meshStandardMaterial map={woodTexture} color="#DEB887" />
          </mesh>
          
          {/* Dock warehouse roof */}
          <group
            position={[0, 18, cityRadius + dockLength - 10]}
          >
            <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
              <coneGeometry args={[dockWidth / 2, 8, 4]} />
              <meshStandardMaterial color="#8B0000" roughness={0.6} />
            </mesh>
          </group>
        </group>
      );
    }
    
    // Lighthouse at the center
    const lighthouse = (
      <group position={[0, 0, 0]}>
        <mesh position={[0, tallestBuilding / 2, 0]} castShadow>
          <cylinderGeometry args={[15, 20, tallestBuilding, 16]} />
          <meshStandardMaterial color="#EFEFEF" roughness={0.4} />
        </mesh>
        
        <mesh position={[0, tallestBuilding + 10, 0]} castShadow>
          <cylinderGeometry args={[10, 10, 20, 16]} />
          <meshStandardMaterial color="#333333" roughness={0.3} />
        </mesh>
        
        {/* Rotating light on top */}
        <mesh position={[0, tallestBuilding + 20, 0]}>
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
      </group>
    );
    
    // City flags
    const flags = [];
    const flagCount = 3;
    for (let i = 0; i < flagCount; i++) {
      const angle = (i / flagCount) * Math.PI * 2;
      const flagX = Math.cos(angle) * (cityRadius * 0.8);
      const flagZ = Math.sin(angle) * (cityRadius * 0.8);
      
      flags.push(
        <group key={`flag-${i}`} position={[flagX, 0, flagZ]}>
          <mesh position={[0, 40, 0]} castShadow>
            <cylinderGeometry args={[1, 1.5, 80, 8]} />
            <meshStandardMaterial color="#8B4513" />
          </mesh>
          
          <mesh 
            position={[10, 70, 0]} 
            castShadow
          >
            <boxGeometry args={[20, 10, 0.5]} />
            <meshStandardMaterial color="#8B0000" side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    }
    
    return {
      plaza,
      cityWall,
      wallCrown,
      buildings,
      docks,
      lighthouse,
      flags
    };
  }, [size, seed, stoneTexture, woodTexture]);
  
  return (
    <group ref={groupRef} position={position}>
      {/* Main city plaza */}
      {cityElements.plaza}
      
      {/* City wall */}
      {cityElements.cityWall}
      {cityElements.wallCrown}
      
      {/* Buildings */}
      {cityElements.buildings}
      
      {/* Docks */}
      {cityElements.docks}
      
      {/* Lighthouse */}
      {cityElements.lighthouse}
      
      {/* Flags */}
      {cityElements.flags}
    </group>
  );
}