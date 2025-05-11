import * as THREE from 'three';
import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// List of available island models (update as you add more .glb files)
const islandModels = [
  'island_1.glb',
  'island_2.glb',
  'island_3.glb',
  'island_4.glb',
  'island_5.glb',
  'island_6.glb',
  'island_7.glb',
  // Add more as needed, e.g., 'island_4.glb'
];

// Simple string hash function for deterministic model selection
const stringHash = (str?: string): number => {
  if (!str) {
    return 0; // Fallback hash for undefined or empty string
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

interface IslandProps {
  position: [number, number, number];
  name?: string; // Made optional to handle undefined
  size?: number;
  seed?: number;
  lowTide?: boolean;
}

export function Island({ position, name, size = 300, seed = 1, lowTide = false }: IslandProps) {
  const meshRef = useRef<THREE.Group>(new THREE.Group());

  // Select model based on name hash
  const modelIndex = stringHash(name) % islandModels.length;
  const modelPath = `/island_models/${islandModels[modelIndex]}`;
  //const modelPath = `/island_models/island_6.glb`;

  // Load glTF model
  useEffect(() => {
    const loader = new GLTFLoader();

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;

        // Scale model based on size prop (assuming native model size ~300 units)
        const scaleFactor = size / 1;
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // Adjust Y-position to align base with water (tune as needed)
        model.position.y = 5; // Raise island slightly above water (y=0)
        if (modelPath === '/island_models/island_1.glb') {
          model.position.y += 10;
          const scaleFactor = size / 2.2;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (modelPath === '/island_models/island_3.glb') {
          model.position.y += 30;
          model.position.z += 0
          model.position.x -= 0
          const scaleFactor = size / 1.5;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (islandModels[modelIndex] === 'island_4.glb') {
          model.position.y = -52;
          model.position.z -= 20
          const scaleFactor = size / 1.5;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (islandModels[modelIndex] === 'island_5.glb') {
          model.position.y = -20;
          model.position.z -= 100
          model.position.x += 25
          const scaleFactor = size / 1.7;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (modelPath === '/island_models/island_6.glb') {
          model.position.y = -10;
          model.position.z += 0
          model.position.x -= 0
          const scaleFactor = size / 1.5;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (modelPath === '/island_models/island_7.glb') {
          model.position.y = -20;
          model.position.z += 0
          model.position.x -= 0
          const scaleFactor = size / 2.8;
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        // Enable shadows
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Add model to meshRef
        meshRef.current.add(model);
      },
      (progress) => {
        //console.log(`Loading ${modelPath}: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
      },
      (error) => {
        console.error(`Error loading ${modelPath}:`, error);
        // Fallback: Add a simple cone
        const fallback = new THREE.Mesh(
          new THREE.ConeGeometry(size, 30, 8),
          new THREE.MeshStandardMaterial({ color: '#4C9A2A' })
        );
        fallback.castShadow = true;
        fallback.receiveShadow = true;
        meshRef.current.add(fallback);
      }
    );

    // Cleanup on unmount
    return () => {
      if (meshRef.current) {
        meshRef.current.clear();
      }
    };
  }, [modelPath, size]);

  // Animate the island gently for lowTide
  useFrame(({ clock }) => {
    if (meshRef.current && lowTide) {
      const time = clock.getElapsedTime();
      meshRef.current.position.y = Math.sin(time * 0.2) * 3 - 5; // Gentle wave motion
    }
  });

  return (
    <group position={position}>
      <group ref={meshRef} position={[0, lowTide ? 5 : 80, 0]} />
    </group>
  );
}