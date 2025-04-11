import { useEffect, useRef } from "react";
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

// GameScene component
export function GameScene() {
  // Refs
  const playerRef = useRef<THREE.Group>(null);
  const lastInputTime = useRef<number>(0);
  const lastRotationUpdateTime = useRef<number>(0);
  const lastSentRotation = useRef<number>(0);
  const lastPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const direction = useRef<Vector3>({ x: 0, y: 0, z: 1 });

  // Game state
  const { gameState, isNearPort } = useGameState();
  const socket = useSocket();

  // Camera
  const { camera } = useThree();

  // Keyboard controls - simplified
  const forward = useKeyboardControls((state) => state.forward);
  const backward = useKeyboardControls((state) => state.backward);
  const left = useKeyboardControls((state) => state.left);
  const right = useKeyboardControls((state) => state.right);
  const fire = useKeyboardControls((state) => state.fire);

  // Load initial game data
  useEffect(() => {
    useGameState.getState().loadPorts();
    useGameState.getState().loadGoods();
    useGameState.getState().loadLeaderboard();
  }, []);

  // Handle camera following player with smooth interpolation
  useFrame((_, delta) => {
    if (playerRef.current && gameState.player) {
      // Ensure consistent physics step for better stability
      const physicsDelta = Math.min(delta, 0.1);

      // Get player position
      const playerPosition = playerRef.current.position;

      // Calculate camera target position - pulled back further for a wider view
      const cameraOffset = new THREE.Vector3(0, 350, 600); // Increased height and distance
      cameraOffset.applyQuaternion(playerRef.current.quaternion);
      const targetCameraPosition = new THREE.Vector3().copy(playerPosition).add(cameraOffset);

      // Smoothly interpolate camera position (lerp) for smoother camera movement
      camera.position.lerp(targetCameraPosition, 0.1);
      camera.lookAt(playerPosition);

      // Send input updates to server (throttled to 10 times per second)
      const now = Date.now();
      if (now - lastInputTime.current > 100) {
        lastInputTime.current = now;

        // Simplified controls - forward/backward directly control speed
        let speed = 0;
        if (backward) speed = 5; // S key goes forward at max speed
        if (forward) speed = -2.5; // W key goes backward at half speed

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
        if (forward || backward || left || right) {
          //console.log("Server input - Speed:", speed, "Direction:", direction.current);
        }

        if (shouldUpdateRotation) {
          // Send complete input including rotation
          lastRotationUpdateTime.current = now;
          lastSentRotation.current = currentRotation;
          socket.sendInput(speed, direction.current, fire, currentRotation);
        } else {
          // Send just speed and direction updates without rotation
          // This keeps the rotation on the server until we need to change it
          socket.sendInput(speed, direction.current, fire);
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
      {/* Sky and lighting */}
      <ambientLight intensity={0.3} />
      <directionalLight position={[50, 100, 50]} intensity={1} castShadow />
      <Sky sunPosition={[100, 20, 100]} turbidity={0.3} rayleigh={0.5} />
      <Stars radius={500} depth={50} count={1000} factor={4} />

      {/* Ocean */}
      <Ocean />

      {/* Ports */}
      <Ports />

      {/* Player ship */}
      {gameState.player && (
        <Player
          player={gameState.player}
          ref={playerRef}
          controls={{
            forward,
            backward,
            left,
            right,
            fire
          }}
        />
      )}

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
  );
}
