import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

export function Ocean() {
  const oceanRef = useRef<THREE.Mesh>(null);
  
  // Load both textures for the water - sky for base color and asphalt for detail
  const textures = {
    base: useTexture("/textures/sky.png"),
    detail: useTexture("/textures/asphalt.png")
  };
  
  // Create 500 x 500 grid pattern to make movement more visible
  const gridTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Draw background
      ctx.fillStyle = '#1a6ea0';
      ctx.fillRect(0, 0, 512, 512);
      
      // Draw grid lines
      ctx.strokeStyle = '#3a8ebd';
      ctx.lineWidth = 2;
      
      // Draw horizontal grid lines
      for (let i = 0; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
      }
      
      // Draw vertical grid lines
      for (let i = 0; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.stroke();
      }
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(25, 25); // Repeat the texture multiple times
    
    return texture;
  }, []);
  
  // Update texture settings
  textures.detail.wrapS = THREE.RepeatWrapping;
  textures.detail.wrapT = THREE.RepeatWrapping;
  textures.detail.repeat.set(50, 50); // Repeat many times across the ocean
  
  // Create a water material with the textures
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: "#1a6ea0", // Deeper blue color
    map: gridTexture, // Use our grid texture
    normalMap: textures.detail, // Use the asphalt texture as a normal map for details
    normalScale: new THREE.Vector2(0.1, 0.1),
    roughnessMap: textures.detail,
    roughness: 0.6,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
  });
  
  // Animate the ocean with vertex displacement and texture animation
  useFrame(({ clock }) => {
    if (oceanRef.current && oceanRef.current.geometry) {
      const time = clock.getElapsedTime();
      const geometry = oceanRef.current.geometry as THREE.PlaneGeometry;
      const position = geometry.attributes.position;
      
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        
        // More complex wave pattern with varied frequencies
        const waveA = Math.sin(x * 0.05 + time * 0.5) * Math.cos(y * 0.05 + time * 0.3) * 8;
        const waveB = Math.sin(x * 0.03 - time * 0.2) * Math.cos(y * 0.04 - time * 0.4) * 4;
        
        position.setZ(i, waveA + waveB);
      }
      
      position.needsUpdate = true;
      
      // Animate the texture to give a sense of movement
      gridTexture.offset.y = time * 0.05;
      gridTexture.offset.x = time * 0.02;
    }
  });
  
  // Create multiple overlapping ocean tiles to smooth the transitions at boundaries
  return (
    <group>
      {/* Center tile (main ocean) */}
      <mesh 
        ref={oceanRef} 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[2500, -10, 2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Create 8 additional ocean tiles around the main one to create seamless wrapping */}
      {/* Top tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[2500, -10, -2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Bottom tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[2500, -10, 7500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Left tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-2500, -10, 2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Right tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[7500, -10, 2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Top-Left tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-2500, -10, -2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Top-Right tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[7500, -10, -2500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Bottom-Left tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-2500, -10, 7500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      
      {/* Bottom-Right tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[7500, -10, 7500]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000, 100, 100]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
    </group>
  );
}
