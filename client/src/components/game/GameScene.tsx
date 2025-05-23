import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky, Stars } from "@react-three/drei";
import { useKeyboardControls } from "@react-three/drei";
import { useSocket } from "@/lib/stores/useSocket";
import { useGameState } from "@/lib/stores/useGameState";
import { useAudio } from "@/lib/stores/useAudio";
import { Ocean } from "./Ocean";
import { Player } from "./Player";
import { Ports } from "./Ports";
import { OtherShips } from "./OtherShips";
import * as THREE from "three";
import { CannonBall } from "./CannonBall";
import { Vector3 } from "@/types";
import { Fog } from "./Fog";

// Interface for control state
interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

// GameScene component
interface GameSceneProps {
  controlsRef: React.MutableRefObject<ControlState>;
}
// GameScene component
export function GameScene({ controlsRef }: GameSceneProps) {
  // Refs
  const playerRef = useRef<THREE.Group>(null);
  const lastInputTime = useRef<number>(0);
  const lastRotationUpdateTime = useRef<number>(0);
  const lastSentRotation = useRef<number>(0);
  const direction = useRef<Vector3>({ x: 0, y: 0, z: 1 });

  // Game state
  const { gameState, isNearPort } = useGameState();
  const socket = useSocket();

  // Camera
  const smoothedPlayerPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const { camera } = useThree();
  const cameraLerpFactor = 0.05;
  const positionLerpFactor = 0.1;

  // Keyboard controls - simplified
  const forward = useKeyboardControls((state) => state.forward);
  const backward = useKeyboardControls((state) => state.backward);
  const left = useKeyboardControls((state) => state.left);
  const right = useKeyboardControls((state) => state.right);
  const fire = useKeyboardControls((state) => state.fire);
  const [effectiveControlsState, setEffectiveControls] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    fire: false
  });

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

  // Handle camera following player with smooth interpolation
  useFrame((_, delta) => {
    if (playerRef.current && gameState.player) {
      // Ensure consistent physics step for better stability
      const physicsDelta = Math.min(delta, 0.1);

      // Get player position
      const playerPosition = playerRef.current.position;
      smoothedPlayerPosition.current.lerp(playerPosition, positionLerpFactor);
      // console.log("player ref current:", playerRef.current);
      //console.log("game state player:", gameState.player);

      // Calculate camera target position - pulled back further for a wider view
      const cameraOffset = new THREE.Vector3(0, 250, 400); // Increased height and distance
      const rotatedCameraOffset = cameraOffset.clone().applyQuaternion(playerRef.current.quaternion);;
      //cameraOffset.applyQuaternion(playerRef.current.quaternion);
      const targetCameraPosition = smoothedPlayerPosition.current.clone().add(rotatedCameraOffset);

      // Smoothly interpolate camera position (lerp) for smoother camera movement
      camera.position.lerp(targetCameraPosition, cameraLerpFactor);
      camera.lookAt(smoothedPlayerPosition.current);

      // Send input updates to server (throttled to 10 times per second)
      const now = Date.now();
      if (now - lastInputTime.current > 100) {
        lastInputTime.current = now;

        // Combine keyboard and touch controls
        const effectiveControls = {
          forward: forward || controlsRef.current.forward,
          backward: backward || controlsRef.current.backward,
          left: left || controlsRef.current.left,
          right: right || controlsRef.current.right,
          fire: fire || controlsRef.current.fire,
        };
        //console.log("effective controls:", effectiveControls)
        if (effectiveControls != effectiveControlsState) {
          setEffectiveControls(effectiveControls)
        }

        // Simplified controls - forward/backward directly control speed
        const maxSpeed = gameState.player?.maxSpeed || 3.5;
        //console.log("max speed:", maxSpeed)
        let speed = 0;
        if (effectiveControls.backward) speed = (maxSpeed / 2); // S key goes forward at max speed
        if (effectiveControls.forward) speed = -maxSpeed; // W key goes backward at half speed

        // Get the current visual rotation from the player model
        const currentRotation = playerRef.current.rotation.y;

        // Calculate the forward direction vector based on this rotation
        const dirVector = new THREE.Vector3(0, 0, 1);
        dirVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), currentRotation);
        dirVector.normalize();

        // Store the current direction for server updates
        direction.current = {
          x: dirVector.x,
          y: dirVector.y,
          z: dirVector.z
        };

        // Determine if we need to send a rotation update to the server
        // Only send when rotation changes significantly or periodically
        // This reduces network traffic while maintaining accuracy
        const rotationDiff = Math.abs(currentRotation - lastSentRotation.current);
        const shouldUpdateRotation = rotationDiff > 0.05 || (now - lastRotationUpdateTime.current > 250);

        // Debug when moving to help diagnose issues
        if (effectiveControls.forward || effectiveControls.backward || effectiveControls.left || effectiveControls.right) {
          //console.log("Server input - Speed:", speed, "Direction:", direction.current);
        }

        if (shouldUpdateRotation) {
          // Send complete input including rotation
          lastRotationUpdateTime.current = now;
          lastSentRotation.current = currentRotation;
          socket.sendInput(speed, direction.current, effectiveControls.fire, currentRotation);
        } else {
          // Send just speed and direction updates without rotation
          // This keeps the rotation on the server until we need to change it
          socket.sendInput(speed, direction.current, effectiveControls.fire);
        }

        // Update client-side game state for smooth local rendering
        if (gameState.player) {
          gameState.player.rotationY = currentRotation;
        }

        // Check if near port
        const nearestPort = useGameState.getState().getNearestPort();
        if (nearestPort) {
          const isNearPort = useGameState.getState().isPlayerNearPort();
          const player = gameState.player;

          if (isNearPort) {
            if (!gameState.isNearPort) {
              useGameState.getState().setNearPort(nearestPort.id);

              // Play sound effect when entering port range
              const { playSound } = useAudio.getState();
              if (typeof playSound === 'function') {
                playSound('bell', 0.4);
              }

              // Calculate distance for debug purposes
              if (player) {
                const distance = useGameState.getState().calculateDistance(
                  player.x, player.z, nearestPort.x, nearestPort.z
                );
                console.log(`Approaching ${nearestPort.name} port! Distance: ${Math.round(distance)} units`);
              }
            }
          } else if (gameState.isNearPort) {
            useGameState.getState().setNearPort(null);

            // Calculate distance for debug purposes
            if (player) {
              const distance = useGameState.getState().calculateDistance(
                player.x, player.z, nearestPort.x, nearestPort.z
              );
              console.log(`Leaving ${nearestPort.name} port area. Distance: ${Math.round(distance)} units`);
            }
          }
        }
      }
    }
  });

  return (
    <>
      {isVisualTest && (
        <>
          {/* Sky and lighting */}
          <ambientLight intensity={0.3} />
          <directionalLight position={[50, 100, 50]} intensity={1} castShadow />

          {/* Sky setup with better parameters */}
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

          {/* Stars with adjusted parameters */}
          <Stars
            radius={1000}
            depth={50}
            count={5000}
            factor={4}
            saturation={0}
            fade={true}
          />

          {/* Fog with adjusted distances */}
          <Fog color="#b3d9ff" near={500} far={1800} />

          {/* Ocean */}
          <Ocean />

          {/* Ports */}
          <Ports />

          {/* Other player ships */}
          <OtherShips players={gameState.otherPlayers} />

          {/* Cannon balls */}
          {gameState.cannonBalls.map((ball) => (
            <CannonBall
              key={ball.id}
              position={[ball.x, ball.y, ball.z]}
              direction={ball.direction}
            />
          ))}
        </>
      )}

      {/* Player ship - always render */}
      {gameState.player && (
        <Player
          player={gameState.player}
          ref={playerRef}
          controls={{
            forward: (effectiveControlsState.forward || false),
            backward: (effectiveControlsState.backward || false),
            left: (effectiveControlsState.left || false),
            right: (effectiveControlsState.right || false),
            fire: (effectiveControlsState.fire || false)
          }}
        />
      )}
    </>
  );
}
