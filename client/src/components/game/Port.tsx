import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { Port as PortType } from '@/types';
import { PORT_INTERACTION_RADIUS } from '@shared/gameConstants';
import { toRender, inRenderRange } from '@/lib/world/renderSpace';
import { PortCity } from './PortCity';
import { cityDebug } from '@/lib/world/cityDebug';

/*
 * A real-world port (card W4): the town on the coast at the port's town x/z (PortCity: the procedural
 * city kit in lib/city, styled by nation with per-city landmarks) plus a name label, and the docking
 * ring + prompt at its `dock` point in the water. Real land comes from the terrain (card W3).
 *
 * The label and dock roots are placed in floating-origin render space every frame
 * (lib/world/renderSpace.ts) and hidden when out of range; PortCity places itself (shader transform).
 * The docking state itself (enter/leave the 300-unit radius around the dock) is computed in
 * GameScene.checkPortProximity, not here.
 */

interface PortProps {
  port: PortType;
}

export function Port({ port }: PortProps) {
  const townRef = useRef<THREE.Group>(null);
  const labelRef = useRef<THREE.Group>(null);
  const dockRef = useRef<THREE.Group>(null);
  const dock = port.dock ?? { x: port.x, z: port.z };

  useFrame(() => {
    const t = toRender(port.x, port.z);
    if (townRef.current) {
      townRef.current.position.set(t.x, 0, t.z);
      townRef.current.visible = inRenderRange(t);
    }
    const d = toRender(dock.x, dock.z);
    if (dockRef.current) {
      dockRef.current.position.set(d.x, 0, d.z);
      dockRef.current.visible = inRenderRange(d) && !cityDebug.active; // dev city camera: no dock prompt in shots
    }
  });

  return (
    <>
      <PortCity port={port} labelRef={labelRef} />

      {/* Name label over the town (y set by PortCity from the built skyline) */}
      <group ref={townRef} position={[0, -10000, 0]}>
        <group ref={labelRef} position={[0, 100, 0]}>
          <Billboard follow={true}>
            <Text fontSize={22} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={2} outlineColor="#000000" renderOrder={1000}>
              {port.name}
            </Text>
          </Billboard>
        </group>
      </group>

      {/* Dock: the interaction ring (radius PORT_INTERACTION_RADIUS) and prompt; the mooring is in PortCity */}
      <group ref={dockRef} position={[0, -10000, 0]}>
        <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[PORT_INTERACTION_RADIUS - 6, PORT_INTERACTION_RADIUS, 96]} />
          <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
