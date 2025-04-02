import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { MAP_WIDTH, MAP_HEIGHT } from "../../lib/constants";

// Highly simplified Ocean component to fix rendering issues
export function Ocean() {
  const oceanRef = useRef<THREE.Mesh>(null);
  
  // Create a simple material without using a texture for better performance and reliability
  const waterMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: "#1a6ea0", // Deeper blue color
      roughness: 0.6,
      metalness: 0.2,
    });
  }, []);
  
  // Simple animation that doesn't require vertex manipulation
  useFrame(({ clock }) => {
    if (oceanRef.current) {
      const time = clock.getElapsedTime();
      // Apply a gentle wave motion to the ocean
      oceanRef.current.position.y = -10 + Math.sin(time * 0.2) * 0.5;
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
