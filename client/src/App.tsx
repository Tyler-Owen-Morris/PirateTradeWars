import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, Component, ReactNode } from "react";
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

// Error Boundary Component
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: "white", padding: "20px" }}>
          <h1>Something went wrong.</h1>
          <p>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Main App component
function App() {
  const { gameState, isRegistered, isPlaying, isSunk, isTrading } = useGameState();
  const [showCanvas, setShowCanvas] = useState(false);
  const socketState = useSocket.getState();
  const { initializeAudio, cleanupAudio, playBackgroundMusic } = useAudio();

  // Initialize audio and handle cleanup
  useEffect(() => {
    initializeAudio();
    return () => {
      cleanupAudio();
    };
  }, [initializeAudio, cleanupAudio]);

  // Start background music on first user interaction due to browser audio policies
  useEffect(() => {
    const handleFirstInteraction = () => {
      playBackgroundMusic();
      document.removeEventListener("click", handleFirstInteraction);
    };
    document.addEventListener("click", handleFirstInteraction);
    return () => {
      document.removeEventListener("click", handleFirstInteraction);
    };
  }, [playBackgroundMusic]);

  // Show the canvas once everything is loaded
  useEffect(() => {
    setShowCanvas(true);

    // Connect to socket when the app loads
    if (!socketState.connected) {
      socketState.connect();
    }

    // Debug logging
    console.log("App mounting, game state:", {
      isRegistered,
      isPlaying,
      isSunk,
      isTrading,
    });

    return () => {
      // Disconnect socket when unmounting
      socketState.disconnect();
    };
  }, []);

  return (
    <ErrorBoundary>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          position: "relative",
          overflow: "hidden",
        }}
      >
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
                    far: 5000,
                  }}
                  gl={{
                    antialias: true,
                    powerPreference: "default",
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
          </KeyboardControls>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;