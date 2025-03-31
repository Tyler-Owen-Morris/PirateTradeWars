import { useState, useEffect } from 'react';
import { useKeyboardControls } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';
import { useAudio } from '@/lib/stores/useAudio';
import HUD from './HUD';
import Leaderboard from './Leaderboard';
import { Button } from './button';
import { Volume2, VolumeX } from 'lucide-react';

export default function GameUI() {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const { isSunk, gameState } = useGameState();
  const { isMuted, toggleMute } = useAudio();
  
  // Handle keyboard controls to show/hide UI elements
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowLeaderboard(true);
      }
      
      if (e.key === 'h' || e.key === 'H') {
        setShowControls(prev => !prev);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        setShowLeaderboard(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  return (
    <>
      {/* HUD with player stats */}
      <HUD />
      
      {/* Leaderboard (shown on Tab key) */}
      {showLeaderboard && <Leaderboard />}
      
      {/* Sound controls */}
      <div className="absolute top-4 right-4 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleMute}
          className="bg-black/50 border-0 text-white hover:bg-black/70"
        >
          {isMuted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>
      
      {/* Controls help */}
      {showControls && (
        <div className="absolute left-1/2 bottom-4 transform -translate-x-1/2 z-50 bg-black/70 text-white p-4 rounded-md">
          <h3 className="text-center font-bold mb-2">Game Controls</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>W / ↑</div><div>Move Forward</div>
            <div>S / ↓</div><div>Move Backward</div>
            <div>A / ←</div><div>Turn Left</div>
            <div>D / →</div><div>Turn Right</div>
            <div>Space</div><div>Fire Cannons</div>
            <div>Shift</div><div>Accelerate</div>
            <div>Ctrl</div><div>Decelerate</div>
            <div>Tab</div><div>View Leaderboard</div>
            <div>H</div><div>Toggle Controls</div>
          </div>
        </div>
      )}
      
      {/* Port notification */}
      {gameState.nearestPort && useGameState.getState().isPlayerNearPort() && !isSunk && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-50 bg-black/70 text-white p-2 rounded-md">
          <p className="text-center">
            <span className="font-bold">{gameState.nearestPort.name}</span> - Press E to trade
          </p>
        </div>
      )}
    </>
  );
}
