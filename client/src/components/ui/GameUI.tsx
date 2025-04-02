import { useState, useEffect } from 'react';
import { useKeyboardControls } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';
import { useAudio } from '@/lib/stores/useAudio';
import { useSocket } from '@/lib/stores/useSocket';
import HUD from './HUD';
import Leaderboard from './Leaderboard';
import { Button } from './button';
import { Volume2, VolumeX, HelpCircle, Map, Skull } from 'lucide-react';
import { HelpTooltip } from './HelpTooltip';
import { Minimap } from './Minimap';
import { ToastContainer } from './TradingToast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';

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
        if (gameState.nearestPort && gameState.isNearPort) {
          useGameState.setState({ isTrading: true });
          
          // Feedback that trading is available
          console.log(`Trading at ${gameState.nearestPort.name}`);
          
          // Play success sound
          const { playSound } = useAudio.getState();
          if (typeof playSound === 'function' && !isMuted) {
            playSound('success', 0.5);
          }
        } else {
          // Provide feedback to the player about why trading isn't available
          const nearestPort = useGameState.getState().getNearestPort();
          if (nearestPort) {
            const player = gameState.player;
            if (player) {
              const distance = useGameState.getState().calculateDistance(
                player.x, player.z, nearestPort.x, nearestPort.z
              );
              const message = `Too far from ${nearestPort.name} (${Math.round(distance)} units away). Sail closer to trade!`;
              console.log(message);
            }
          } else {
            console.log("No ports nearby. Find a port to trade!");
          }
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
  }, [gameState.nearestPort, gameState.isNearPort, gameState.player, isMuted]);
  
  const [showMinimap, setShowMinimap] = useState(true);
  
  // Toggle minimap visibility
  const toggleMinimap = () => {
    setShowMinimap(!showMinimap);
  };
  
  return (
    <>
      {/* HUD with player stats */}
      <HUD />
      
      {/* Leaderboard (shown on Tab key) */}
      {showLeaderboard && <Leaderboard />}
      
      {/* Toast notifications for trading */}
      <ToastContainer />
      
      {/* Sound and minimap controls */}
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleMinimap}
          className="bg-black/50 border-0 text-white hover:bg-black/70"
          title="Toggle Navigation Map"
        >
          <Map />
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={toggleMute}
          className="bg-black/50 border-0 text-white hover:bg-black/70"
          title={isMuted ? "Unmute Sound" : "Mute Sound"}
        >
          {isMuted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>
      
      {/* Minimap component */}
      {showMinimap && gameState.player && <Minimap />}
      
      {/* Help tooltip button - always visible */}
      <HelpTooltip />
      
      {/* Scuttle Ship button - positioned above the port info */}
      {gameState.player && !isSunk && (
        <div className="absolute bottom-20 right-4 z-50 flex flex-col gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" className="flex items-center gap-2 shadow-lg bg-red-700 hover:bg-red-800 text-white font-bold border-2 border-red-900">
                <Skull size={16} />
                <span>Scuttle Ship</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-black/90 border-amber-500 text-white">
              <DialogHeader>
                <DialogTitle className="text-amber-400">Scuttle Your Ship?</DialogTitle>
                <DialogDescription className="text-gray-300">
                  This will end your current game and register your score on the leaderboard. Your ship and all cargo will be lost forever. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex gap-2 justify-end mt-4">
                <Button variant="outline" className="border-gray-500 text-gray-300 hover:bg-gray-800">
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  className="bg-red-700 hover:bg-red-800"
                  onClick={() => {
                    useSocket.getState().scuttleShip();
                    useAudio.getState().playExplosion();
                  }}
                >
                  Scuttle Ship
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
      
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
      {gameState.nearestPort && gameState.isNearPort && !isSunk && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-50 bg-black/80 text-white p-3 rounded-md border border-amber-500 shadow-lg animate-pulse">
          <p className="text-center">
            <span className="font-bold text-amber-400">{gameState.nearestPort.name}</span> - Press <span className="font-mono bg-black px-2 rounded">T</span> to trade
          </p>
        </div>
      )}
    </>
  );
}