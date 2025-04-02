import { forwardRef, useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';
import { Howl } from 'howler';

interface ShipProps {
  position: [number, number, number];
  rotation: number;
  type: string;
  name: string;
  hp: number;
  maxHp: number;
  sunk: boolean;
  isPlayer?: boolean;
}

export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(
  { position, rotation, type, name, hp, maxHp, sunk, isPlayer = false }, 
  ref
) {
  const healthBarRef = useRef<THREE.Mesh>(null);
  const shipRef = useRef<THREE.Group>(null);
  
  // For sinking effect bubbles
  const [isSinking, setIsSinking] = useState(false);
  
  // Sound effects
  const [sinkSound] = useState(() => new Howl({
    src: ['/sounds/hit.mp3'], // Use the hit sound for sinking
    volume: 0.5,
    loop: false
  }));
  
  // Create bubbles/ripples for sinking animation
  const bubbles = useMemo(() => {
    if (!sunk) return [];
    
    // Create 20 bubbles with random positions around the ship
    const dims = getShipDimensions();
    return Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * dims.width * 1.5,
      y: Math.random() * 5, // Random height above water
      z: (Math.random() - 0.5) * dims.length * 1.5,
      size: Math.random() * 2 + 1, // Random size between 1-3
      speed: Math.random() * 0.05 + 0.05, // Random upward speed
      delay: Math.random() * 5000, // Stagger the bubble appearance
      opacity: 1
    }));
  }, [sunk]);
  
  // Create water ripples/splash when ship hits water
  const ripples = useMemo(() => {
    if (!sunk) return [];
    
    // Create 10 ripples with random positions around the ship
    const dims = getShipDimensions();
    return Array.from({ length: 10 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * dims.width * 2,
      y: 0, // At water level
      z: (Math.random() - 0.5) * dims.length * 2,
      size: Math.random() * 10 + 5, // Random size between 5-15
      growSpeed: Math.random() * 0.2 + 0.1, // How fast the ripple expands
      delay: Math.random() * 2000, // Stagger the ripple appearance (less than bubbles)
      opacity: 1,
      maxSize: Math.random() * 20 + 15 // Maximum size before fading
    }));
  }, [sunk]);
  
  // Get base color from ship type
  const getShipColor = () => {
    switch (type) {
      case 'sloop':
        return '#8B4513'; // Brown
      case 'brigantine':
        return '#A0522D'; // Sienna
      case 'galleon':
        return '#CD853F'; // Peru
      case 'man-o-war':
        return '#D2691E'; // Chocolate
      default:
        return '#8B4513'; // Default brown
    }
  };
  
  // Get ship dimensions based on type
  const getShipDimensions = () => {
    switch (type) {
      case 'sloop':
        return { length: 40, width: 15, height: 20, mastHeight: 50 };
      case 'brigantine':
        return { length: 60, width: 20, height: 25, mastHeight: 60 };
      case 'galleon':
        return { length: 80, width: 30, height: 30, mastHeight: 70 };
      case 'man-o-war':
        return { length: 100, width: 40, height: 35, mastHeight: 80 };
      default:
        return { length: 40, width: 15, height: 20, mastHeight: 50 };
    }
  };
  
  // Get number of masts based on ship type
  const getNumMasts = () => {
    switch (type) {
      case 'sloop': return 1;
      case 'brigantine': return 2;
      case 'galleon': return 3;
      case 'man-o-war': return 4;
      default: return 1;
    }
  };
  
  // For tracking bubble and ripple positions
  const bubblesRef = useRef<Array<THREE.Mesh | null>>([]);
  const ripplesRef = useRef<Array<THREE.Mesh | null>>([]);
  
  // Play sinking sound when ship starts sinking
  useEffect(() => {
    if (sunk && !isSinking) {
      // Play the sinking sound
      sinkSound.play();
    }
  }, [sunk, isSinking, sinkSound]);
  
  // Update the health bar and animation elements
  useFrame((state) => {
    if (healthBarRef.current) {
      const healthPercent = Math.max(0, hp / maxHp);
      healthBarRef.current.scale.x = healthPercent;
      
      // Health bar color based on health percentage
      if (healthPercent > 0.6) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#4CAF50'); // Green
      } else if (healthPercent > 0.3) {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#FF9800'); // Orange
      } else {
        (healthBarRef.current.material as THREE.MeshBasicMaterial).color.set('#F44336'); // Red
      }
    }
    
    // If ship is sunk, make it sink gradually with enhanced animation
    if (sunk && shipRef.current) {
      // Set sinking flag when we start sinking
      if (!isSinking) {
        setIsSinking(true);
      }
      
      // Sink the ship gradually below the water
      shipRef.current.position.y = Math.max(-50, shipRef.current.position.y - 0.2);
      
      // Tilt the ship to the side as it sinks (more dramatic tilt)
      shipRef.current.rotation.z = Math.min(Math.PI / 3, shipRef.current.rotation.z + 0.006);
      
      // Add a slight forward tilt too
      shipRef.current.rotation.x = Math.min(Math.PI / 6, shipRef.current.rotation.x + 0.002);
      
      // Slowly rotate the ship as it sinks (for a more natural water motion effect)
      shipRef.current.rotation.y += 0.001;
      
      // Animate bubbles rising
      bubbles.forEach((bubble, index) => {
        const bubbleMesh = bubblesRef.current[index];
        if (bubbleMesh) {
          // Only start bubble animation after a delay to stagger them
          if (state.clock.elapsedTime * 1000 > bubble.delay) {
            bubbleMesh.position.y += bubble.speed;
            
            // Fade out as they rise
            if (bubbleMesh.material instanceof THREE.MeshBasicMaterial) {
              bubbleMesh.material.opacity = Math.max(0, 1 - bubbleMesh.position.y / 15);
            }
            
            // Add some gentle side-to-side movement
            bubbleMesh.position.x += Math.sin(state.clock.elapsedTime * 2 + index) * 0.02;
            bubbleMesh.position.z += Math.cos(state.clock.elapsedTime * 2 + index) * 0.02;
            
            // Reset bubbles that have risen too high
            if (bubbleMesh.position.y > 15) {
              bubbleMesh.position.y = 0;
              if (bubbleMesh.material instanceof THREE.MeshBasicMaterial) {
                bubbleMesh.material.opacity = 1;
              }
            }
          }
        }
      });
      
      // Animate water ripples
      ripples.forEach((ripple, index) => {
        const rippleMesh = ripplesRef.current[index];
        if (rippleMesh) {
          // Only start ripple animation after a delay to stagger them
          if (state.clock.elapsedTime * 1000 > ripple.delay) {
            // Expand the ripple
            if (rippleMesh.scale.x < ripple.maxSize) {
              rippleMesh.scale.x += ripple.growSpeed;
              rippleMesh.scale.z += ripple.growSpeed;
              
              // Fade out as it expands
              if (rippleMesh.material instanceof THREE.MeshBasicMaterial) {
                rippleMesh.material.opacity = Math.max(0, 1 - (rippleMesh.scale.x / ripple.maxSize));
              }
            } else {
              // Reset ripple when it reaches max size
              rippleMesh.scale.set(1, 1, 1);
              if (rippleMesh.material instanceof THREE.MeshBasicMaterial) {
                rippleMesh.material.opacity = 1;
              }
            }
          }
        }
      });
    }
  });
  
  const dims = getShipDimensions();
  const numMasts = getNumMasts();
  
  return (
    <group ref={ref} position={position} rotation={[0, rotation, 0]}>
      {/* Sinking effect bubbles */}
      {sunk && bubbles.map((bubble, index) => (
        <mesh
          key={`bubble-${bubble.id}`}
          position={[bubble.x, bubble.y, bubble.z]}
          ref={(el) => {
            if (bubblesRef.current.length <= index) {
              bubblesRef.current.push(el);
            } else {
              bubblesRef.current[index] = el;
            }
          }}
        >
          <sphereGeometry args={[bubble.size, 6, 6]} />
          <meshBasicMaterial 
            color="#ADD8E6" 
            transparent 
            opacity={0.6}
          />
        </mesh>
      ))}
      
      {/* Water ripples/rings on the surface */}
      {sunk && ripples.map((ripple, index) => (
        <mesh
          key={`ripple-${ripple.id}`}
          position={[ripple.x, ripple.y, ripple.z]}
          rotation={[-Math.PI / 2, 0, 0]} // Rotate to lay flat on water
          ref={(el) => {
            if (ripplesRef.current.length <= index) {
              ripplesRef.current.push(el);
            } else {
              ripplesRef.current[index] = el;
            }
          }}
        >
          <ringGeometry args={[ripple.size * 0.8, ripple.size, 16]} />
          <meshBasicMaterial 
            color="#FFFFFF" 
            transparent 
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      
      <group ref={shipRef} position={[0, 0, 0]}>
        {/* Ship hull */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[dims.width, dims.height, dims.length]} />
          <meshStandardMaterial color={getShipColor()} />
        </mesh>
        
        {/* Ship deck */}
        <mesh position={[0, dims.height / 2 + 1, 0]} castShadow>
          <boxGeometry args={[dims.width, 2, dims.length]} />
          <meshStandardMaterial color="#D2B48C" />
        </mesh>
        
        {/* Ship masts */}
        {Array.from({ length: numMasts }).map((_, index) => {
          const spacing = dims.length / (numMasts + 1);
          const zPos = -dims.length / 2 + spacing * (index + 1);
          
          return (
            <group key={index} position={[0, 0, zPos]}>
              {/* Mast */}
              <mesh position={[0, dims.height / 2 + dims.mastHeight / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 2, dims.mastHeight]} />
                <meshStandardMaterial color="#8B4513" />
              </mesh>
              
              {/* Sail */}
              <mesh position={[0, dims.height / 2 + dims.mastHeight / 3, 0]} castShadow>
                <planeGeometry args={[dims.width + 10, dims.mastHeight * 0.7]} />
                <meshStandardMaterial 
                  color="#F5F5F5" 
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            </group>
          );
        })}
        
        {/* Ship bow (front point) */}
        <mesh position={[0, dims.height / 4, -dims.length / 2 - dims.length / 8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[dims.width / 2, dims.length / 4, 32]} />
          <meshStandardMaterial color={getShipColor()} />
        </mesh>
        
        {/* Cannon ports - represent the number of cannons on each side */}
        {Array.from({ length: getNumMasts() }).map((_, index) => {
          const spacing = dims.length / (getNumMasts() * 2);
          const zPos = -dims.length / 4 + spacing * (index * 2);
          
          return (
            <group key={`cannons-${index}`}>
              {/* Port side (left) cannon */}
              <mesh position={[-dims.width / 2 - 2, dims.height / 4, zPos]} rotation={[0, -Math.PI / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 3, 8]} />
                <meshStandardMaterial color="#2F4F4F" />
              </mesh>
              
              {/* Starboard side (right) cannon */}
              <mesh position={[dims.width / 2 + 2, dims.height / 4, zPos]} rotation={[0, Math.PI / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 3, 8]} />
                <meshStandardMaterial color="#2F4F4F" />
              </mesh>
            </group>
          );
        })}
      </group>
      
      {/* Ship name and health bar */}
      <Billboard
        position={[0, dims.height + 30, 0]}
        follow={true}
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        {/* Ship name */}
        <Text
          fontSize={12}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.5}
          outlineColor="#000000"
        >
          {name} {isPlayer ? "(You)" : ""}
        </Text>
        
        {/* Health bar background */}
        <mesh position={[0, -5, 0]}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial color="#333333" transparent opacity={0.7} />
        </mesh>
        
        {/* Health bar foreground */}
        <mesh position={[-20 + 20 * (hp / maxHp), -5, 0.1]} ref={healthBarRef}>
          <planeGeometry args={[40, 5]} />
          <meshBasicMaterial color="#4CAF50" />
        </mesh>
      </Billboard>
    </group>
  );
});
