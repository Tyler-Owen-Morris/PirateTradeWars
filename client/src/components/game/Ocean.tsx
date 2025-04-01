import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { MAP_WIDTH, MAP_HEIGHT } from "../../lib/constants";

// Highly simplified Ocean component to fix rendering issues
export function Ocean() {
  const oceanRef = useRef<THREE.Mesh>(null);
  
  // Load textures for water (much simpler)
  const waterTexture = useTexture("/textures/sky.png");
  
  // Configure texture for better performance
  waterTexture.wrapS = THREE.RepeatWrapping;
  waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(20, 20);
  
  // Create a simple material with minimal processing
  const waterMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: "#1a6ea0", // Deeper blue color
      map: waterTexture,
      roughness: 0.6,
      metalness: 0.2,
    });
  }, [waterTexture]);
  
  // Simple animation that doesn't require vertex manipulation
  useFrame(({ clock }) => {
    if (oceanRef.current) {
      const time = clock.getElapsedTime();
      // Only animate texture coordinates for performance
      waterTexture.offset.y = time * 0.02;
      waterTexture.offset.x = time * 0.01;
    }
  });
  
  return (
    <group>
      {/* Single large ocean plane */}
      <mesh 
        ref={oceanRef} 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[MAP_WIDTH/2, -10, MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH * 3, MAP_HEIGHT * 3, 1, 1]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
    </group>
  );
}
