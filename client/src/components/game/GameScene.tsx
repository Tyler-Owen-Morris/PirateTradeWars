/**
 * Main 3D scene. Netcode lives in `@/lib/net`:
 *  - Player.tsx drives prediction (`net.frame`) and draws the predicted own ship (useFrame, prio -1);
 *  - OtherShips.tsx / CannonBall.tsx read interpolated / simulated positions in useFrame;
 *  - this component only makes the camera follow the rendered own ship and runs the (throttled)
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
import type { ControlState } from "@/lib/net";
import { MAP_WIDTH, MAP_HEIGHT } from "@shared/gameConstants";

interface GameSceneProps {
  /** touch joystick / HUD fire button state (keyboard is read inside Player) */
  controlsRef: React.MutableRefObject<ControlState>;
}

const CAMERA_OFFSET = new THREE.Vector3(0, 250, 400);
const CAMERA_LERP = 0.05;
const POSITION_LERP = 0.1;
const PORT_CHECK_INTERVAL_MS = 100;

export function GameScene({ controlsRef }: GameSceneProps) {
  const playerRef = useRef<THREE.Group>(null);
  const lastPortCheck = useRef(0);
  const lastPlayerPos = useRef<THREE.Vector3 | null>(null);

  const player = useGameState((s) => s.gameState.player);
  const goldObjects = useGameState((s) => s.gameState.goldObjects);

  const smoothedPlayerPosition = useRef(new THREE.Vector3());
  const tmpOffset = useRef(new THREE.Vector3());
  const tmpTarget = useRef(new THREE.Vector3());
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

  // Camera follows the rendered (predicted) own ship. Runs after Player's useFrame (priority -1).
  useFrame(() => {
    const group = playerRef.current;
    if (!group) return;
    const playerPosition = group.position;

    // Map seam: when the ship wraps (x or z jumps by ~MAP size), shift the camera and its
    // smoothing state by the same amount so the camera doesn't fly across the map.
    const last = lastPlayerPos.current;
    if (!last) {
      lastPlayerPos.current = playerPosition.clone();
      smoothedPlayerPosition.current.copy(playerPosition);
    } else {
      const jx = playerPosition.x - last.x;
      const jz = playerPosition.z - last.z;
      const shiftX = Math.abs(jx) > MAP_WIDTH / 2 ? Math.sign(jx) * MAP_WIDTH : 0;
      const shiftZ = Math.abs(jz) > MAP_HEIGHT / 2 ? Math.sign(jz) * MAP_HEIGHT : 0;
      if (shiftX || shiftZ) {
        smoothedPlayerPosition.current.x += shiftX;
        smoothedPlayerPosition.current.z += shiftZ;
        camera.position.x += shiftX;
        camera.position.z += shiftZ;
      }
      last.copy(playerPosition);
    }

    smoothedPlayerPosition.current.lerp(playerPosition, POSITION_LERP);
    tmpOffset.current.copy(CAMERA_OFFSET).applyQuaternion(group.quaternion);
    tmpTarget.current.copy(smoothedPlayerPosition.current).add(tmpOffset.current);
    camera.position.lerp(tmpTarget.current, CAMERA_LERP);
    camera.lookAt(smoothedPlayerPosition.current);

    // Port proximity (throttled). Uses the ~5 Hz player mirror in useGameState.
    const now = performance.now();
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

          <Ocean />

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
              position={[gold.x, gold.y, gold.z]}
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

/** Enter/leave the nearest port's interaction radius (unchanged behaviour from before the netcode work). */
function checkPortProximity() {
  const store = useGameState.getState();
  const player = store.gameState.player;
  const nearestPort = store.getNearestPort();
  if (!player || !nearestPort) return;

  const isNear = store.isPlayerNearPort();
  if (isNear) {
    if (!store.gameState.isNearPort) {
      store.setNearPort(nearestPort.id);
      const { playSound } = useAudio.getState() as unknown as { playSound?: (name: string, vol: number) => void };
      if (typeof playSound === 'function') playSound('bell', 0.4);
      const distance = store.calculateDistance(player.x, player.z, nearestPort.x, nearestPort.z);
      console.log(`Approaching ${nearestPort.name} port! Distance: ${Math.round(distance)} units`);
    }
  } else if (store.gameState.isNearPort) {
    store.setNearPort(null);
    const distance = store.calculateDistance(player.x, player.z, nearestPort.x, nearestPort.z);
    console.log(`Leaving ${nearestPort.name} port area. Distance: ${Math.round(distance)} units`);
  }
}
