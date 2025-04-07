import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';

interface IslandProps {
  position: [number, number, number];
  size?: number;
  seed?: number;
  lowTide?: boolean;
}

export function Island({ position, size = 300, seed = 1, lowTide = false }: IslandProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  console.log(`Island component rendering at position [${position[0]}, ${position[1]}, ${position[2]}]`);

  // Load textures
  const sandTexture = useTexture('/textures/sand.jpg');
  const grassTexture = useTexture('/textures/grass.png');
  
  // Configure textures
  sandTexture.wrapS = sandTexture.wrapT = THREE.RepeatWrapping;
  sandTexture.repeat.set(5, 5);
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(8, 8);
  
  // Animate the island gently
  useFrame(({ clock }) => {
    if (meshRef.current && lowTide) {
      const time = clock.getElapsedTime();
      meshRef.current.position.y = Math.sin(time * 0.2) * 3 - 5; // Gentle wave motion
    }
  });
  
  // Calculate all geometries and palm trees using useMemo
  const { islandGeometry, beachGeometry, palmTrees } = useMemo(() => {
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
    const randFloatSpread = (range: number) => range * (random() * 2 - 1);
    
    // Generate island parameters
    const irregularity = randFloat(0.7, 1.3);
    const elevation = randFloat(30, 50);
    
    // Create island geometry
    const islandGeometry = new THREE.ConeGeometry(
      size * irregularity,
      elevation,
      8 + Math.floor(randFloat(4, 8)),
      4,
      false,
      randFloat(0, Math.PI * 0.5)
    );
    
    // Add noise to the geometry
    const posAttr = islandGeometry.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      
      // Only modify vertices above the base
      if (y > 0.1) {
        const noise = (y / elevation) * 30;
        posAttr.setX(i, x + randFloatSpread(noise));
        posAttr.setZ(i, z + randFloatSpread(noise));
      }
    }
    
    // Update normals
    islandGeometry.computeVertexNormals();
    
    // Create beach geometry
    const beachGeometry = new THREE.CylinderGeometry(
      size * 1.5,
      size * 1.5,
      5,
      16,
      1
    );
    
    // Generate palm trees
    const trees = [];
    const treeCount = randInt(3, 8);
    
    for (let i = 0; i < treeCount; i++) {
      const angle = randFloat(0, Math.PI * 2);
      const dist = randFloat(size * 0.4, size * 0.7);
      const treeX = Math.cos(angle) * dist;
      const treeZ = Math.sin(angle) * dist;
      const height = randFloat(40, 60);
      
      const leaves = [];
      for (let j = 0; j < 6; j++) {
        leaves.push(
          <mesh 
            key={j} 
            castShadow 
            position={[0, 0, 0]} 
            rotation={[
              randFloat(-0.3, 0.3),
              j * Math.PI / 3,
              randFloat(-0.2, 0.5)
            ]}
          >
            <boxGeometry args={[5, 1, 25]} />
            <meshStandardMaterial color="#228B22" />
          </mesh>
        );
      }
      
      trees.push(
        <group key={i} position={[treeX, elevation/2, treeZ]}>
          <mesh castShadow>
            <cylinderGeometry args={[2, 3, height, 6]} />
            <meshStandardMaterial color="#8B4513" />
          </mesh>
          <group position={[0, height/2, 0]} rotation={[0, randFloat(0, Math.PI * 2), 0]}>
            {leaves}
          </group>
        </group>
      );
    }
    
    return { 
      islandGeometry, 
      beachGeometry, 
      palmTrees: trees 
    };
  }, [size, seed]);
  
  return (
    <group position={position}>
      {/* Main island */}
      <mesh 
        ref={meshRef}
        position={[0, lowTide ? -5 : 0, 0]} 
        castShadow 
        receiveShadow
      >
        <primitive object={islandGeometry} />
        <meshStandardMaterial
          map={grassTexture}
          color="#4C9A2A"
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      
      {/* Beach */}
      <mesh position={[0, -12, 0]} receiveShadow>
        <primitive object={beachGeometry} />
        <meshStandardMaterial
          map={sandTexture}
          color="#F0E68C"
          roughness={1}
          metalness={0}
        />
      </mesh>
      
      {/* Palm trees */}
      {palmTrees}
    </group>
  );
}