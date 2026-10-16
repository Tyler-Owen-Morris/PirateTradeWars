import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { Port as PortType } from '@/types';
import { PORT_INTERACTION_RADIUS } from '@shared/gameConstants';
import { toRender, inRenderRange } from '@/lib/world/renderSpace';
import { nationColor } from '@/lib/nav';

/*
 * A real-world port (card W4): a small town on the coast at the port's town x/z (buildings, a church
 * tower and a flag in the nation colour, plus a name label) and a pier with the docking ring at its
 * `dock` point in the water. Real land comes from the terrain (card W3); there is no island model.
 *
 * Both roots are placed in floating-origin render space every frame (lib/world/renderSpace.ts) and
 * hidden when out of range; children are local. The docking state itself (enter/leave the 300-unit
 * radius around the dock) is computed in GameScene.checkPortProximity, not here.
 */

interface PortProps {
  port: PortType;
}

/** Deterministic pseudo-random in [0, 1) from a seed and an index. */
function rand(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const WALL_COLORS = ['#e8dcc0', '#d9c7a3', '#f0e6d2', '#c9b28a', '#e3d3b4'];
const ROOF_COLORS = ['#8b3a2b', '#a0522d', '#7a4a32', '#6b3e26'];
/** Town base height above sea level (terrain sits around here at the coast). */
const TOWN_Y = 2;

export function Port({ port }: PortProps) {
  const townRef = useRef<THREE.Group>(null);
  const dockRef = useRef<THREE.Group>(null);
  const flagRef = useRef<THREE.Group>(null);
  const pierRef = useRef<THREE.Group>(null);
  const dock = port.dock ?? { x: port.x, z: port.z };
  const flagColor = port.nation === 'pirates' ? '#111111' : nationColor(port.nation);

  // A handful of houses around the town centre, deterministic per port.
  const houses = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; h: number; rot: number; wall: string; roof: string }[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(port.id, i) * 0.6;
      const r = 28 + rand(port.id, i + 50) * 45;
      out.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        w: 12 + rand(port.id, i + 100) * 10,
        d: 10 + rand(port.id, i + 150) * 8,
        h: 9 + rand(port.id, i + 200) * 8,
        rot: rand(port.id, i + 250) * Math.PI,
        wall: WALL_COLORS[Math.floor(rand(port.id, i + 300) * WALL_COLORS.length)],
        roof: ROOF_COLORS[Math.floor(rand(port.id, i + 350) * ROOF_COLORS.length)],
      });
    }
    return out;
  }, [port.id]);

  useFrame(({ clock }) => {
    const t = toRender(port.x, port.z);
    const tx = t.x;
    const tz = t.z;
    const townVisible = inRenderRange(t);
    if (townRef.current) {
      townRef.current.position.set(tx, TOWN_Y, tz);
      townRef.current.visible = townVisible;
    }
    const d = toRender(dock.x, dock.z);
    if (dockRef.current) {
      dockRef.current.position.set(d.x, 0, d.z);
      dockRef.current.visible = inRenderRange(d);
    }
    // Point the pier from the dock toward the town.
    if (pierRef.current) pierRef.current.rotation.y = Math.atan2(tx - d.x, tz - d.z);
    if (flagRef.current && townVisible) {
      flagRef.current.rotation.y = Math.sin(clock.elapsedTime * 1.3 + port.id) * 0.25;
    }
  });

  return (
    <>
      {/* Town, on land at the port's x/z */}
      <group ref={townRef} position={[0, -10000, 0]}>
        {/* Plaza */}
        <mesh position={[0, 0.5, 0]} receiveShadow>
          <cylinderGeometry args={[26, 28, 1, 20]} />
          <meshStandardMaterial color="#b8a888" roughness={0.9} />
        </mesh>
        {houses.map((h, i) => (
          <group key={i} position={[h.x, 0, h.z]} rotation={[0, h.rot, 0]}>
            <mesh position={[0, h.h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[h.w, h.h, h.d]} />
              <meshStandardMaterial color={h.wall} roughness={0.85} />
            </mesh>
            <mesh position={[0, h.h + 3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[Math.max(h.w, h.d) * 0.75, 7, 4]} />
              <meshStandardMaterial color={h.roof} roughness={0.8} />
            </mesh>
          </group>
        ))}
        {/* Church / fort tower */}
        <mesh position={[0, 18, 0]} castShadow>
          <boxGeometry args={[12, 36, 12]} />
          <meshStandardMaterial color="#d8d0c0" roughness={0.8} />
        </mesh>
        <mesh position={[0, 41, 0]} castShadow>
          <coneGeometry args={[9, 12, 4]} />
          <meshStandardMaterial color="#5a3a2a" />
        </mesh>
        {/* Flagpole + flag in the nation colour */}
        <mesh position={[0, 60, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 30, 6]} />
          <meshStandardMaterial color="#4a3726" />
        </mesh>
        <group ref={flagRef} position={[0, 70, 0]}>
          <mesh position={[8, 0, 0]}>
            <planeGeometry args={[16, 10]} />
            <meshStandardMaterial color={flagColor} side={THREE.DoubleSide} />
          </mesh>
        </group>
        {/* Name label */}
        <Billboard position={[0, 100, 0]} follow={true}>
          <Text fontSize={22} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={2} outlineColor="#000000" renderOrder={1000}>
            {port.name}
          </Text>
        </Billboard>
      </group>

      {/* Dock: pier, mooring posts and the interaction ring (radius PORT_INTERACTION_RADIUS) */}
      <group ref={dockRef} position={[0, -10000, 0]}>
        <group ref={pierRef}>
          <mesh position={[0, 2, 40]} castShadow receiveShadow>
            <boxGeometry args={[10, 1.5, 80]} />
            <meshStandardMaterial color="#7a5a3a" roughness={0.9} />
          </mesh>
          {[0, 20, 40, 60, 80].map((zz) => (
            <mesh key={zz} position={[5.5, 0, zz]}>
              <cylinderGeometry args={[0.8, 0.8, 6, 6]} />
              <meshStandardMaterial color="#4a3726" />
            </mesh>
          ))}
        </group>
        <Billboard position={[0, 40, 0]} follow={true}>
          <Text fontSize={10} color="#FFFFFF" anchorX="center" anchorY="middle" outlineWidth={1} outlineColor="#000000" renderOrder={101}>
            {`${port.name} dock - press T to trade`}
          </Text>
        </Billboard>
        <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[PORT_INTERACTION_RADIUS - 6, PORT_INTERACTION_RADIUS, 96]} />
          <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
