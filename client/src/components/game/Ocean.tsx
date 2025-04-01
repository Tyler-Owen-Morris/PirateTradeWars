import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { MAP_WIDTH, MAP_HEIGHT } from "../../lib/constants";

export function Ocean() {
  const { gl } = useThree();
  const oceanRef = useRef<THREE.Mesh>(null);
  const isAnimatingRef = useRef(true);
  const isDisposedRef = useRef(false);
  
  // Load textures for water and land
  const textures = useTexture({
    water: "/textures/sky.png",
    detail: "/textures/asphalt.png",
    sand: "/textures/sand.jpg",
    grass: "/textures/grass.png"
  });
  
  // Verify textures are loaded before proceeding
  if (!textures.water || !textures.detail || !textures.sand || !textures.grass) {
    console.warn("Some ocean textures failed to load");
  }
  
  // Create ocean texture with grid pattern with better error handling
  const gridTexture = useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        console.error("Could not get 2D context for ocean grid texture");
        // Fallback to a simple texture if canvas context fails
        const texture = new THREE.Texture();
        texture.needsUpdate = true;
        return texture;
      }
      
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
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(25, 25); // Repeat the texture multiple times
      
      return texture;
    } catch (error) {
      console.error("Error creating grid texture:", error);
      // Return a basic texture as fallback
      const texture = new THREE.Texture();
      texture.needsUpdate = true;
      return texture;
    }
  }, []);
  
  // Configure texture settings safely
  useEffect(() => {
    // Only configure if all textures are available
    if (textures.detail && textures.sand && textures.grass) {
      textures.detail.wrapS = THREE.RepeatWrapping;
      textures.detail.wrapT = THREE.RepeatWrapping;
      textures.detail.repeat.set(50, 50);
      
      textures.sand.wrapS = THREE.RepeatWrapping;
      textures.sand.wrapT = THREE.RepeatWrapping;
      textures.sand.repeat.set(10, 10);
      
      textures.grass.wrapS = THREE.RepeatWrapping;
      textures.grass.wrapT = THREE.RepeatWrapping;
      textures.grass.repeat.set(20, 20);
    }
    
    // Cleanup function for when component unmounts
    return () => {
      isAnimatingRef.current = false;
      isDisposedRef.current = true;
      
      // Dispose of grid texture when component unmounts
      if (gridTexture) {
        gridTexture.dispose();
      }
    };
  }, [textures, gridTexture]);
  
  // Create materials with proper error handling
  const materials = useMemo(() => {
    try {
      // Verify all textures are loaded before creating materials
      if (!textures.detail || !textures.sand || !textures.grass) {
        throw new Error("Missing required textures for ocean materials");
      }
      
      const waterMaterial = new THREE.MeshStandardMaterial({
        color: "#1a6ea0", // Deeper blue color
        map: gridTexture, // Use our grid texture
        normalMap: textures.detail,
        normalScale: new THREE.Vector2(0.1, 0.1),
        roughnessMap: textures.detail,
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9,
      });
      
      const sandMaterial = new THREE.MeshStandardMaterial({
        color: "#daa520", // Golden sand color
        map: textures.sand,
        roughness: 0.8,
        metalness: 0.1,
      });
      
      const grassMaterial = new THREE.MeshStandardMaterial({
        color: "#2e8b57", // Sea green for island vegetation
        map: textures.grass,
        roughness: 0.9,
        metalness: 0,
      });
      
      return { waterMaterial, sandMaterial, grassMaterial };
    } catch (error) {
      console.error("Error creating ocean materials:", error);
      // Create basic materials as fallback
      const waterMaterial = new THREE.MeshStandardMaterial({ color: "#1a6ea0" });
      const sandMaterial = new THREE.MeshStandardMaterial({ color: "#daa520" });
      const grassMaterial = new THREE.MeshStandardMaterial({ color: "#2e8b57" });
      
      return { waterMaterial, sandMaterial, grassMaterial };
    }
  }, [textures, gridTexture]);
  
  // Dispose of materials when component unmounts
  useEffect(() => {
    return () => {
      if (materials.waterMaterial) materials.waterMaterial.dispose();
      if (materials.sandMaterial) materials.sandMaterial.dispose();
      if (materials.grassMaterial) materials.grassMaterial.dispose();
    };
  }, [materials]);
  
  // Animate the ocean with error handling and performance optimization
  useFrame(({ clock }) => {
    // Skip animation if component is unmounting or disposed
    if (!isAnimatingRef.current || isDisposedRef.current) return;
    
    try {
      if (oceanRef.current && oceanRef.current.geometry) {
        const time = clock.getElapsedTime();
        const geometry = oceanRef.current.geometry as THREE.PlaneGeometry;
        const position = geometry.attributes.position;
        
        // Limit animation to reasonable frame rates to prevent performance issues
        if (time % 0.1 < 0.02) { // Only update every ~100ms
          // Apply wave animation to vertices
          for (let i = 0; i < position.count; i++) {
            const x = position.getX(i);
            const y = position.getY(i);
            
            // Wave animation
            const waveA = Math.sin(x * 0.05 + time * 0.5) * Math.cos(y * 0.05 + time * 0.3) * 8;
            const waveB = Math.sin(x * 0.03 - time * 0.2) * Math.cos(y * 0.04 - time * 0.4) * 4;
            
            position.setZ(i, waveA + waveB);
          }
          
          position.needsUpdate = true;
        }
        
        // Animate the texture with lower frequency - every frame is not needed
        gridTexture.offset.y = time * 0.05;
        gridTexture.offset.x = time * 0.02;
      }
    } catch (error) {
      console.error("Error in ocean animation:", error);
      // Stop animation if there's an error to prevent continuous errors
      isAnimatingRef.current = false;
      // Just stop the animation to prevent further errors
    }
  });
  
  // Create procedural islands at fixed locations
  // These will be visible landmarks for navigation
  const islands = useMemo(() => {
    const islandData = [
      // Main islands at each port location
      { position: [1000, -5, 1200], size: 200, name: "Tortuga Island" }, // Tortuga port
      { position: [4000, -5, 800], size: 180, name: "Nassau Island" },   // Nassau port
      { position: [800, -5, 4000], size: 240, name: "Port Royal Island" }, // Port Royal
      { position: [3500, -5, 4200], size: 220, name: "Havana Island" },  // Havana port
      
      // Additional landmark islands
      { position: [2500, -5, 2500], size: 300, name: "Treasure Island" }, // Center of map
      { position: [500, -5, 500], size: 150, name: "Smuggler's Cove" },
      { position: [4500, -5, 4500], size: 170, name: "Devil's Triangle" },
      { position: [1500, -5, 3500], size: 190, name: "Shipwreck Bay" },
      { position: [3500, -5, 1500], size: 160, name: "Black Sand Island" },
    ];
    
    return islandData;
  }, []);
  
  return (
    <group>
      {/* Main ocean tile */}
      <mesh 
        ref={oceanRef} 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[MAP_WIDTH/2, -10, MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Surrounding ocean tiles for seamless wrapping */}
      {/* Top tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[MAP_WIDTH/2, -10, -MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Bottom tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[MAP_WIDTH/2, -10, MAP_HEIGHT*1.5]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Left tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-MAP_WIDTH/2, -10, MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Right tile */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[MAP_WIDTH*1.5, -10, MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Corner tiles */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-MAP_WIDTH/2, -10, -MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[MAP_WIDTH*1.5, -10, -MAP_HEIGHT/2]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-MAP_WIDTH/2, -10, MAP_HEIGHT*1.5]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[MAP_WIDTH*1.5, -10, MAP_HEIGHT*1.5]}
        receiveShadow
      >
        <planeGeometry args={[MAP_WIDTH, MAP_HEIGHT, 100, 100]} />
        <primitive object={materials.waterMaterial} attach="material" />
      </mesh>
      
      {/* Create islands at specific locations */}
      {islands.map((island, index) => (
        <group key={index} position={[island.position[0], 0, island.position[2]]}>
          {/* Sandy beach ring */}
          <mesh position={[0, -5, 0]}>
            <cylinderGeometry args={[island.size, island.size + 20, 10, 32]} />
            <primitive object={materials.sandMaterial} attach="material" />
          </mesh>
          
          {/* Island terrain (elevated) */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[island.size - 20, island.size, 40, 32]} />
            <primitive object={materials.grassMaterial} attach="material" />
          </mesh>
          
          {/* Center terrain elevation (hill) */}
          <mesh position={[0, 20, 0]}>
            <coneGeometry args={[island.size/2, 40, 32]} />
            <primitive object={materials.grassMaterial} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
