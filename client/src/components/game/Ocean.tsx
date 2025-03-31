import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

export function Ocean() {
  const oceanRef = useRef<THREE.Mesh>(null);
  
  // Use the blue sky texture and tint it for water
  const texture = useTexture("/textures/sky.png");
  
  // Create a water material with the sky texture
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: "#1a6ea0", // Deeper blue color
    map: texture,
    metalness: 0.2,
    roughness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  
  // Animate the ocean with vertex displacement
  useFrame(({ clock }) => {
    if (oceanRef.current && oceanRef.current.geometry) {
      const time = clock.getElapsedTime();
      const geometry = oceanRef.current.geometry as THREE.PlaneGeometry;
      const position = geometry.attributes.position;
      
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        
        // Simple wave effect - small amplitude
        const waveHeight = Math.sin(x * 0.05 + time * 0.5) * 
                         Math.cos(y * 0.05 + time * 0.5) * 5;
        
        position.setZ(i, waveHeight);
      }
      
      position.needsUpdate = true;
    }
  });
  
  // Create a large ocean plane (5000x5000 as specified in the GDD)
  return (
    <mesh 
      ref={oceanRef} 
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[2500, -10, 2500]}
      receiveShadow
    >
      <planeGeometry args={[5000, 5000, 64, 64]} />
      <primitive object={waterMaterial} attach="material" />
    </mesh>
  );
}
