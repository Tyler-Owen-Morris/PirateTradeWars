import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Ship } from './Ship';
import { PlayerState } from '@/types';
import * as THREE from 'three';

interface OtherShipsProps {
  players: Record<string, PlayerState>;
}

export function OtherShips({ players }: OtherShipsProps) {
  const shipsRef = useRef<Record<string, THREE.Group>>({});
  
  // Smoothly interpolate other ships' positions
  useFrame((_, delta) => {
    Object.entries(players).forEach(([id, player]) => {
      const ship = shipsRef.current[id];
      
      if (ship) {
        // Calculate wrapped distance to target
        const targetX = player.x;
        const targetZ = player.z;
        
        // Get current position
        const currentX = ship.position.x;
        const currentZ = ship.position.z;
        
        // Calculate direct and wrapped distances for x
        const directDx = targetX - currentX;
        const wrappedDx = targetX > currentX 
          ? targetX - 5000 - currentX 
          : targetX + 5000 - currentX;
        
        // Use the shortest path
        const dx = Math.abs(directDx) < Math.abs(wrappedDx) ? directDx : wrappedDx;
        
        // Calculate direct and wrapped distances for z
        const directDz = targetZ - currentZ;
        const wrappedDz = targetZ > currentZ 
          ? targetZ - 5000 - currentZ 
          : targetZ + 5000 - currentZ;
        
        // Use the shortest path
        const dz = Math.abs(directDz) < Math.abs(wrappedDz) ? directDz : wrappedDz;
        
        // Interpolate position (lerp)
        ship.position.x += dx * 5 * delta; // Faster interpolation for network smoothness
        ship.position.z += dz * 5 * delta;
        
        // Wrap around map edges
        ship.position.x = (ship.position.x % 5000 + 5000) % 5000;
        ship.position.z = (ship.position.z % 5000 + 5000) % 5000;
        
        // Interpolate rotation (smoother turning)
        const currentAngle = ship.rotation.y;
        let targetAngle = player.rotationY;
        
        // Ensure we take the shortest path around the circle
        if (targetAngle - currentAngle > Math.PI) targetAngle -= Math.PI * 2;
        if (currentAngle - targetAngle > Math.PI) targetAngle += Math.PI * 2;
        
        ship.rotation.y += (targetAngle - currentAngle) * 5 * delta;
      }
    });
  });
  
  return (
    <>
      {Object.entries(players).map(([id, player]) => (
        <Ship
          key={id}
          ref={(el) => {
            if (el) {
              shipsRef.current[id] = el;
            }
          }}
          position={[player.x, player.y, player.z]}
          rotation={player.rotationY}
          type={player.shipType}
          name={player.name}
          hp={player.hp}
          maxHp={player.maxHp}
          sunk={player.sunk}
        />
      ))}
    </>
  );
}
