import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

interface IslandProps {
  position: [number, number, number];
  size?: number;
  seed?: number;
  lowTide?: boolean;
}

export function Island({ position, size = 300, seed = 1, lowTide = false }: IslandProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
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
  
  // Use a simple seeded random number generator for island characteristics
  const seededRandom = () => {
    // Simple seeded random function
    let currentSeed = seed;
    return () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };
  };
  
  const rand = seededRandom();
  const randFloat = (min: number, max: number) => min + rand() * (max - min);
  const randInt = (min: number, max: number) => Math.floor(randFloat(min, max + 1));
  const randFloatSpread = (range: number) => range * (rand() * 2 - 1);
  
  // Generate randomized island characteristics
  const irregularity = randFloat(0.7, 1.3); // How irregular the island shape is
  const elevation = randFloat(30, 50); // Island height
  
  // Calculate the vertices for a somewhat irregular island
  const islandGeometry = new THREE.ConeGeometry(
    size * irregularity, 
    elevation, 
    8 + Math.floor(randFloat(4, 8)), // Random number of sides for variation
    4, // Radial segments
    false, // Open ended
    randFloat(0, Math.PI * 0.5) // Random rotation
  );
  
  // Add some noise to the vertices for a more natural look
  const positionAttribute = islandGeometry.getAttribute('position');
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    
    // Don't modify the bottom vertices (keep the base flat)
    if (y > 0.1) { 
      // Add some noise to x and z, more at the top
      const noiseAmount = (y / elevation) * 30; // More noise higher up
      positionAttribute.setX(i, x + randFloatSpread(noiseAmount));
      positionAttribute.setZ(i, z + randFloatSpread(noiseAmount));
    }
  }
  
  // Need to update the geometry after modifying
  islandGeometry.computeVertexNormals();
  
  // Flat sandy beach around the island
  const beachGeometry = new THREE.CylinderGeometry(
    size * 1.5, // Beach extends beyond the island
    size * 1.5,
    5, // Small height
    16, // More segments for smoother circle
    1
  );
  
  // Add some palm trees or vegetation
  const palmTrees = [];
  const numTrees = randInt(3, 8);
  for (let i = 0; i < numTrees; i++) {
    // Position trees around the island
    const angle = randFloat(0, Math.PI * 2);
    const distance = randFloat(size * 0.4, size * 0.7);
    const treeX = Math.cos(angle) * distance;
    const treeZ = Math.sin(angle) * distance;
    const height = randFloat(40, 60);
    
    palmTrees.push(
      <group key={i} position={[treeX, elevation/2, treeZ]}>
        {/* Tree trunk */}
        <mesh castShadow>
          <cylinderGeometry args={[2, 3, height, 6]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh>
        
        {/* Palm leaves */}
        <group position={[0, height/2, 0]} rotation={[0, randFloat(0, Math.PI * 2), 0]}>
          {[0, 1, 2, 3, 4, 5].map(j => (
            <mesh key={j} castShadow position={[0, 0, 0]} rotation={[
              randFloat(-0.3, 0.3),
              j * Math.PI / 3, 
              randFloat(-0.2, 0.5)
            ]}>
              <boxGeometry args={[5, 1, 25]} />
              <meshStandardMaterial color="#228B22" />
            </mesh>
          ))}
        </group>
      </group>
    );
  }
  
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
      
      {/* Beach area */}
      <mesh position={[0, -12, 0]} receiveShadow>
        <primitive object={beachGeometry} />
        <meshStandardMaterial
          map={sandTexture}
          color="#F0E68C"
          roughness={1}
          metalness={0}
        />
      </mesh>
      
      {/* Add palm trees */}
      {palmTrees}
    </group>
  );
}