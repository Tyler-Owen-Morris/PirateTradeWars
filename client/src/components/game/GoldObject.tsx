import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';

interface GoldObjectProps {
    id: string;
    position: [number, number, number];
    gold: number;
}

export function GoldObject({ id, position, gold }: GoldObjectProps) {
    const coinRef = useRef<THREE.Mesh>(null);
    const haloRef = useRef<THREE.Mesh>(null);

    // Animate floating, edge rotation, and subtle halo pulse
    useFrame((state) => {
        if (coinRef.current) {
            coinRef.current.rotation.x += 0.01; // Rotate on X-axis (edge spinning)
            // Raise base position by 20 units and add floating animation
            coinRef.current.position.y = position[1] + 20 + Math.sin(state.clock.elapsedTime * 2) * 2;
        }
        if (haloRef.current) {
            // Match the coin's raised position
            haloRef.current.position.y = position[1] + 20 + Math.sin(state.clock.elapsedTime * 2) * 2;
            // Subtle pulse effect for halo
            const scale = 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.05;
            haloRef.current.scale.set(scale, scale, scale);
        }
    });

    return (
        <group>
            {/* Coin Mesh */}
            <mesh ref={coinRef} position={[position[0], position[1] + 20, position[2]]}>
                <cylinderGeometry args={[20, 20, 3, 62]} /> {/* Larger, thicker coin */}
                <meshStandardMaterial
                    color="#FFD700" // Gold color
                    metalness={0.9}
                    roughness={0.1}
                    emissive="#FFD700"
                    emissiveIntensity={0.2}
                />
            </mesh>

            {/* Glowing Halo */}
            <mesh ref={haloRef} position={[position[0], position[1] + 20, position[2]]}>
                <sphereGeometry args={[25, 30, 30]} /> {/* Larger sphere for halo */}
                <meshStandardMaterial
                    color="#FFFFE0" // Light yellow
                    emissive="#FFFFE0"
                    emissiveIntensity={0.7}
                    transparent
                    opacity={0.2}
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* Point Light for Glow */}
            <pointLight
                color="#FFD700"
                intensity={0.5}
                distance={20}
                position={[position[0], position[1] + 22, position[2]]}
            />

            {/* Shiny Text */}
            <Billboard position={[position[0], position[1] + 50, position[2]]}>
                <Text
                    fontSize={20}
                    //font="/fonts/Helvetica-Bold.ttf" // Adjust if custom font available
                    anchorX="center"
                    anchorY="bottom"
                >
                    {gold}
                    <meshStandardMaterial
                        color="#FFD700" // Changed to gold color
                        metalness={0.8}
                        roughness={0.2}
                        emissive="#FFD700"
                        emissiveIntensity={0.5} // Increased emissive intensity
                    />
                </Text>
            </Billboard>
        </group>
    );
}