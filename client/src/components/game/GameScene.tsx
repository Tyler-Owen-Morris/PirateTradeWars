/**
 * Main 3D scene. Netcode lives in `@/lib/net`:
 *  - Player.tsx drives prediction (`net.frame`) and draws the predicted own ship (useFrame, prio -1);
 *  - OtherShips.tsx / CannonBall.tsx read interpolated / simulated positions in useFrame;
 *  - everything is drawn in floating-origin render space around the own ship (lib/world/renderSpace.ts,
 *    WORLD_SPEC §7); the own ship is at the origin;
 *  - this component only makes the camera follow the rendered own ship (lib/cameraFollow.ts:
 *    frame-rate independent, bounded lag, snap on spawn / big jumps, seam-aware) and runs the (throttled)
 *    port-proximity check. Inputs are sent by the net layer, not from here.
 */
import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useGameState } from "@/lib/stores/useGameState";
import { useAudio } from "@/lib/stores/useAudio";
import { Ocean } from "./Ocean";
import { Player } from "./Player";
import { Ports } from "./Ports";
import { OtherShips } from "./OtherShips";
import * as THREE from "three";
import { CannonBalls } from "./CannonBall";
import { Fog } from "./Fog";
import { GoldObject } from "./GoldObject";
import { net, type ControlState } from "@/lib/net";
import { CameraFollow } from "@/lib/cameraFollow";
import { renderFocus, CAMERA_FAR } from "@/lib/world/renderSpace";
import { nearestDockPort } from "@shared/world/ports";
import { PORT_INTERACTION_RADIUS } from "@shared/gameConstants";
import type { Port } from "@/types";

interface GameSceneProps {
  /** touch joystick / HUD fire button state (keyboard is read inside Player) */
  controlsRef: React.MutableRefObject<ControlState>;
}

const PORT_CHECK_INTERVAL_MS = 100;

export function GameScene({ controlsRef }: GameSceneProps) {
  const playerRef = useRef<THREE.Group>(null);
  const lastPortCheck = useRef(0);
  const lastFrameAt = useRef<number | null>(null);
  const follow = useRef(new CameraFollow());
  const lookAt = useRef(new THREE.Vector3());

  const player = useGameState((s) => s.gameState.player);
  const goldObjects = useGameState((s) => s.gameState.goldObjects);

  const { camera } = useThree();

  // Load initial game data
  useEffect(() => {
    useGameState.getState().loadPorts();
    useGameState.getState().loadGoods();
    useGameState.getState().loadLeaderboard();
  }, []);

  const [isVisualTest, setIsVisualTest] = useState(true);

  // Check URL parameters for no-visual-test flag
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const noVisualTest = urlParams.get('no-visual-test') === 'true';
    setIsVisualTest(!noVisualTest);
  }, []);

  // Snap the camera onto the ship on every (re)spawn: first snapshot after join / reconnect.
  useEffect(() => net.on("spawned", () => follow.current.requestSnap()), []);

  // Camera follows the rendered (predicted) own ship. Runs after Player's useFrame (priority -1).
  // Frame-rate independent, bounded lag, snaps on spawn / > 500 u jumps (lib/cameraFollow.ts).
  useFrame(() => {
    const group = playerRef.current;
    if (!group) return;
    const now = performance.now();
    // Own wall-clock dt (R3F's delta comes from a shared clock other code can disturb).
    const dt = lastFrameAt.current === null ? 0 : (now - lastFrameAt.current) / 1000;
    lastFrameAt.current = now;

    // Floating origin: the ship is at (0,0) in render space; carry the smoothing state over the
    // origin move first (renderFocus.shift, set by Player.tsx this frame).
    const f = follow.current;
    f.shiftOrigin(renderFocus.shiftX, renderFocus.shiftZ);
    f.update(group.position.x, group.position.z, group.rotation.y, dt);
    camera.position.set(f.cam.x, f.cam.y, f.cam.z);
    lookAt.current.set(f.focus.x, f.focus.y, f.focus.z);
    camera.lookAt(lookAt.current);

    // Port proximity (throttled). Uses the ~5 Hz player mirror in useGameState.
    if (now - lastPortCheck.current < PORT_CHECK_INTERVAL_MS) return;
    lastPortCheck.current = now;
    checkPortProximity();
  });

  return (
    <>
      {isVisualTest && (
        <>
          {/* Sky and lighting */}
          <ambientLight intensity={0.3} />
          <directionalLight position={[50, 100, 50]} intensity={1} castShadow />

          <Sky
            distance={450000}
            sunPosition={[100, 20, 100]}
            turbidity={0.8}
            rayleigh={0.5}
            mieCoefficient={0.005}
            mieDirectionalG={0.8}
            inclination={0.49}
            azimuth={0.25}
          />

          <Fog color="#b3d9ff" near={600} far={1800} />

          {/* Camera-following plane; waves anchored to the world (see Ocean.tsx) */}
          <Ocean size={2 * (CAMERA_FAR + 500)} />

          <Ports />

          {/* Other player ships (interpolated, positions written in useFrame) */}
          <OtherShips />

          {/* Cannon balls (locally simulated from `fire` events) */}
          <CannonBalls />

          {/* Gold objects (snapshot `g` rows, every 10th tick) */}
          {goldObjects?.map((gold) => (
            <GoldObject
              key={gold.id}
              id={gold.id}
              x={gold.x}
              y={gold.y}
              z={gold.z}
              gold={gold.gold}
            />
          ))}
        </>
      )}

      {/* Player ship - always render */}
      {player && <Player player={player} ref={playerRef} controlsRef={controlsRef} />}
    </>
  );
}

/** Enter/leave the docking radius of the nearest port: metric distance from the ship to the port's
 *  DOCK ≤ PORT_INTERACTION_RADIUS (300), the same rule the server enforces (WORLD_SPEC §5). */
function checkPortProximity() {
  const store = useGameState.getState();
  const player = store.gameState.player;
  if (!player) return;
  const ports = store.gameState.ports.filter((p) => p.dock);
  const hit = nearestDockPort(player.x, player.z, ports as Array<Port & { dock: { x: number; z: number } }>);
  if (!hit) return;
  const { port, distance } = hit;

  if (distance <= PORT_INTERACTION_RADIUS) {
    if (!store.gameState.isNearPort || store.gameState.nearestPort?.id !== port.id) {
      store.setNearPort(port.id);
      const { playSound } = useAudio.getState() as unknown as { playSound?: (name: string, vol: number) => void };
      if (typeof playSound === 'function') playSound('bell', 0.4);
      console.log(`Approaching ${port.name} dock. Distance: ${Math.round(distance)} units`);
    }
  } else if (store.gameState.isNearPort) {
    store.setNearPort(null);
    console.log(`Leaving ${port.name} dock area. Distance: ${Math.round(distance)} units`);
  }
}
