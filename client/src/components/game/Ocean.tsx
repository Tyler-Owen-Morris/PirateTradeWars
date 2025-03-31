import { useTexture } from "@react-three/drei";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function Ocean() {
  const oceanRef = useRef<THREE.Mesh>(null);
  
  // Using the sea/water texture from textures folder
  const oceanTexture = useTexture("/textures/ocean.jpg");
  oceanTexture.wrapS = oceanTexture.wrapT = THREE.RepeatWrapping;
  oceanTexture.repeat.set(15, 15); // Repeat the texture across the plane
  
  // Animate the ocean texture
  useFrame(({ clock }) => {
    if (oceanRef.current) {
      // Make the ocean texture move slightly for a wave effect
      oceanTexture.offset.x = Math.sin(clock.getElapsedTime() * 0.05) * 0.01;
      oceanTexture.offset.y = Math.cos(clock.getElapsedTime() * 0.05) * 0.01;
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
      <planeGeometry args={[5000, 5000, 32, 32]} />
      <meshStandardMaterial 
        map={oceanTexture}
        color="#0077be"
        metalness={0.1}
        roughness={0.6}
      />
    </mesh>
  );
}
