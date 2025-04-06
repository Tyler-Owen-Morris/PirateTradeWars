import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import { KeyboardControls } from "@react-three/drei";
import { useAudio } from "./lib/stores/useAudio";
import { useSocket } from "./lib/stores/useSocket";
import { GameScene } from "./components/game/GameScene";
import NameRegistration from "./components/ui/NameRegistration";
import GameUI from "./components/ui/GameUI";
import ShipSelection from "./components/ui/ShipSelection";
import GameOver from "./components/ui/GameOver";
import { useGameState } from "./lib/stores/useGameState";
import TradeMenu from "./components/ui/TradeMenu";
import { Howl } from "howler";

// Define control keys for the game
const controls = [
  { name: "forward", keys: ["KeyW", "ArrowUp"] },
  { name: "backward", keys: ["KeyS", "ArrowDown"] },
  { name: "left", keys: ["KeyA", "ArrowLeft"] },
  { name: "right", keys: ["KeyD", "ArrowRight"] },
  { name: "fire", keys: ["Space", "KeyF"] },
  { name: "accelerate", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "decelerate", keys: ["ControlLeft", "ControlRight"] },
];

// Sound manager component to load audio
function SoundManager() {
  const { setBackgroundMusic, setHitSound, setSuccessSound } = useAudio();

  useEffect(() => {
    // Load background music
    const backgroundMusic = new Howl({
      src: ['/sounds/background.mp3'],
      loop: true,
      volume: 0.3,
      autoplay: false,
    });
    setBackgroundMusic(backgroundMusic as unknown as HTMLAudioElement);

    // Load hit sound
    const hitSound = new Howl({
      src: ['/sounds/hit.mp3'],
      volume: 0.5,
      autoplay: false,
    });
    setHitSound(hitSound as unknown as HTMLAudioElement);

    // Load success sound
    const successSound = new Howl({
      src: ['/sounds/success.mp3'],
      volume: 0.5,
      autoplay: false,
    });
    setSuccessSound(successSound as unknown as HTMLAudioElement);

    return () => {
      // Cleanup
      backgroundMusic.stop();
      backgroundMusic.unload();
      hitSound.unload();
      successSound.unload();
    };
  }, [setBackgroundMusic, setHitSound, setSuccessSound]);

  return null;
}

// Main App component
function App() {
  const { gameState, isRegistered, isPlaying, isSunk, isTrading } = useGameState();
  const [showCanvas, setShowCanvas] = useState(false);
  const socketState = useSocket.getState();

  // Show the canvas once everything is loaded
  useEffect(() => {
    setShowCanvas(true);
    
    // Connect to socket when the app loads
    if (!socketState.connected) {
      socketState.connect();
    }
    
    // Debug logging
    console.log("App mounting, game state:", { isRegistered, isPlaying, isSunk, isTrading });
    
    return () => {
      // Disconnect socket when unmounting
      socketState.disconnect();
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {showCanvas && (
        <KeyboardControls map={controls}>
          {!isPlaying && <ShipSelection />}

          {isPlaying && (
            <>
              <Canvas
                shadows
                camera={{
                  position: [0, 250, 400], // Start from a higher position to see the ship
                  fov: 60,
                  near: 0.1,
                  far: 5000
                }}
                gl={{
                  antialias: true,
                  powerPreference: "default"
                }}
                style={{ backgroundColor: "#1a334d" }} 
              >
                <Suspense fallback={null}>
                  <GameScene />
                </Suspense>
              </Canvas>
              
              <GameUI />
              
              {isTrading && <TradeMenu />}
              
              {isSunk && <GameOver score={gameState.player?.gold || 0} />}
            </>
          )}

          <SoundManager />
        </KeyboardControls>
      )}
    </div>
  );
}

export default App;
