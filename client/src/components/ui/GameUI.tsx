import { useState, useEffect } from 'react';
import { useKeyboardControls } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';
import { useAudio } from '@/lib/stores/useAudio';
import HUD from './HUD';
import Leaderboard from './Leaderboard';
import { Button } from './button';
import { Volume2, VolumeX, HelpCircle } from 'lucide-react';
import { HelpTooltip } from './HelpTooltip';

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
      
      if (e.key === 't' || e.key === 'T') {
        // Open trade menu if near port
        if (gameState.nearestPort && useGameState.getState().isPlayerNearPort()) {
          useGameState.setState({ isTrading: true });
        }
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
  }, [gameState.nearestPort]);
  
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
      
      {/* Help tooltip button - always visible */}
      <HelpTooltip />
      
      {/* Controls help */}
      {showControls && (
        <div className="absolute left-1/2 bottom-4 transform -translate-x-1/2 z-50 bg-black/80 text-white p-4 rounded-md border border-amber-500 shadow-lg">
          <h3 className="text-center font-bold mb-2 text-amber-400">Game Controls</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div className="font-mono bg-black/60 px-2 rounded">W / ↑</div><div>Move Forward</div>
            <div className="font-mono bg-black/60 px-2 rounded">S / ↓</div><div>Move Backward</div>
            <div className="font-mono bg-black/60 px-2 rounded">A / ←</div><div>Turn Left</div>
            <div className="font-mono bg-black/60 px-2 rounded">D / →</div><div>Turn Right</div>
            <div className="font-mono bg-black/60 px-2 rounded">Space</div><div>Fire Cannons</div>
            <div className="font-mono bg-black/60 px-2 rounded">Shift</div><div>Accelerate</div>
            <div className="font-mono bg-black/60 px-2 rounded">Ctrl</div><div>Decelerate</div>
            <div className="font-mono bg-black/60 px-2 rounded">T</div><div>Trade at Port</div>
            <div className="font-mono bg-black/60 px-2 rounded">Tab</div><div>View Leaderboard</div>
            <div className="font-mono bg-black/60 px-2 rounded">H</div><div>Toggle Controls</div>
          </div>
        </div>
      )}
      
      {/* Port notification */}
      {gameState.nearestPort && useGameState.getState().isPlayerNearPort() && !isSunk && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-50 bg-black/80 text-white p-3 rounded-md border border-amber-500">
          <p className="text-center">
            <span className="font-bold text-amber-400">{gameState.nearestPort.name}</span> - Press <span className="font-mono bg-black px-2 rounded">T</span> to trade
          </p>
        </div>
      )}
    </>
  );
}
