import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky, Stars } from "@react-three/drei";
import { useKeyboardControls } from "@react-three/drei";
import { useSocket } from "@/lib/stores/useSocket";
import { useGameState } from "@/lib/stores/useGameState";
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
  const lastPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const direction = useRef<Vector3>({ x: 0, y: 0, z: 1 });
  
  // Game state
  const { gameState } = useGameState();
  const socket = useSocket();
  
  // Camera
  const { camera } = useThree();
  
  // Keyboard controls
  const forward = useKeyboardControls((state) => state.forward);
  const backward = useKeyboardControls((state) => state.backward);
  const left = useKeyboardControls((state) => state.left);
  const right = useKeyboardControls((state) => state.right);
  const fire = useKeyboardControls((state) => state.fire);
  const accelerate = useKeyboardControls((state) => state.accelerate);
  const decelerate = useKeyboardControls((state) => state.decelerate);
  
  // Load initial game data
  useEffect(() => {
    useGameState.getState().loadPorts();
    useGameState.getState().loadGoods();
    useGameState.getState().loadLeaderboard();
  }, []);
  
  // Handle camera following player
  useFrame(() => {
    if (playerRef.current && gameState.player) {
      // Get player position
      const playerPosition = playerRef.current.position;
      
      // Update camera position
      const cameraOffset = new THREE.Vector3(0, 250, 400);
      cameraOffset.applyQuaternion(playerRef.current.quaternion);
      
      camera.position.copy(playerPosition).add(cameraOffset);
      camera.lookAt(playerPosition);
      
      // Send input updates to server (throttled to 10 times per second)
      const now = Date.now();
      if (now - lastInputTime.current > 100) {
        lastInputTime.current = now;
        
        // Calculate speed based on inputs
        let speed = 0;
        if (forward) speed = accelerate ? gameState.player.speed * 1.5 : gameState.player.speed;
        if (backward) speed = -gameState.player.speed * 0.5;
        
        // Calculate rotation
        const rotationY = playerRef.current.rotation.y;
        
        // Get current direction vector
        const dirVector = new THREE.Vector3(0, 0, 1);
        dirVector.applyQuaternion(playerRef.current.quaternion);
        dirVector.normalize();
        
        direction.current = {
          x: dirVector.x,
          y: dirVector.y,
          z: dirVector.z
        };
        
        // Send input to server
        socket.sendInput(rotationY, speed, direction.current, fire);
        
        // Check if near port
        const nearestPort = useGameState.getState().getNearestPort();
        if (nearestPort) {
          const isNearPort = useGameState.getState().isPlayerNearPort();
          
          if (isNearPort) {
            useGameState.getState().setNearPort(nearestPort.id);
          } else {
            useGameState.getState().setNearPort(null);
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
            fire,
            accelerate,
            decelerate
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
