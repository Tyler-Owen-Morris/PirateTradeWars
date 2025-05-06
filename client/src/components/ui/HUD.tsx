import { useEffect, useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { PlayerState, Port } from '@/types';
import { Progress } from './progress';
import { Compass, Anchor, ChevronsRight, Coins, Skull } from 'lucide-react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from './dialog';
import { useSocket } from '@/lib/stores/useSocket';

interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

interface HUDProps {
  controlsRef: React.MutableRefObject<ControlState>;
  onShowLeaderboard: () => void;
}

export default function HUD({ controlsRef, onShowLeaderboard }: HUDProps) {
  const { gameState } = useGameState();
  const { isSunk } = useGameState();
  const player = gameState.player;
  const [nearestPort, setNearestPort] = useState<Port | null>(null);
  const [distance, setDistance] = useState<number>(0);

  // Update nearest port info
  useEffect(() => {
    if (player) {
      const port = useGameState.getState().getNearestPort();
      if (port) {
        setNearestPort(port);
        const dist = useGameState.getState().calculateDistance(
          player.x, player.z, port.x, port.z
        );
        setDistance(Math.round(dist));
      }
    }
  }, [player?.x, player?.z, gameState.ports]);

  // Fire button handler
  const handleFire = () => {
    if (!controlsRef?.current) {
      console.warn("button not firing");
      return;
    }

    const currentState = controlsRef.current;
    controlsRef.current = {
      ...currentState,
      fire: true,
    };

    // Reset fire after a short delay
    setTimeout(() => {
      if (!controlsRef?.current) return;
      controlsRef.current = {
        ...currentState,
        fire: false,
      };
    }, 100);
  };

  // If player data isn't loaded yet, don't render
  if (!player) return null;

  return (
    <div className="absolute mb-20 sm:mb-20 md:mb-10 inset-0">

      {/* Ship stats panel */}
      <div onClick={onShowLeaderboard} className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-black/50 p-1.5 sm:p-3 rounded-md text-white w-[60vw] sm:w-auto max-w-[70vw] sm:max-w-[400px]">
        <div className="mb-0.5 sm:mb-2 font-bold text-xs sm:text-lg flex items-center">
          <span className="mr-1 sm:mr-2 truncate"><span data-testid="cypress-player-name">{player.name}</span>'s Ship</span>
          <span className="text-[0.5rem] sm:text-xs ml-auto opacity-70" data-testid="cypress-ship-type">{player.shipType}</span>
        </div>

        {/* HP Bar */}
        <div className="mb-0.5 sm:mb-2">
          <div className="flex justify-between text-[0.5rem] sm:text-xs mb-0.5 sm:mb-1">
            <span>Hull Integrity</span>
            <span>{player.hp} / {player.maxHp}</span>
          </div>
          <Progress
            value={(player.hp / player.maxHp) * 100}
            className="h-0.5 sm:h-2"
            indicatorClassName={getHealthColor(player.hp, player.maxHp)}
          />
        </div>

        {/* Cargo capacity */}
        <div className="mb-0.5 sm:mb-2">
          <div className="flex justify-between text-[0.5rem] sm:text-xs mb-0.5 sm:mb-1">
            <span>Cargo</span>
            <span>{player.cargoUsed} / {player.cargoCapacity}</span>
          </div>
          <Progress
            value={(player.cargoUsed / player.cargoCapacity) * 100}
            className="h-0.5 sm:h-2"
            indicatorClassName="bg-amber-500"
          />
        </div>

        {/* Gold */}
        <div className="flex items-center mt-0.5 sm:mt-3">
          <Coins className="h-2.5 w-2.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 text-yellow-400" />
          <span className="font-bold text-xs sm:text-base">{player.gold}</span>
          <span className="ml-1 text-[0.5rem] sm:text-xs">gold</span>
        </div>
      </div>

      {/* Speed indicator */}
      <div className="absolute top-16 right-2 sm:top-20 sm:right-4 bg-black/50 p-2 sm:p-3 rounded-md text-white">
        <div className="flex items-center justify-between mb-0.5 sm:mb-1">
          <ChevronsRight className={`h-4 w-4 sm:h-5 sm:w-5 ${Math.abs(player.speed) > 0 ? 'text-green-400' : 'text-gray-400'}`} />
          <span className="ml-1 sm:ml-2 font-bold text-sm sm:text-base">{Math.abs(player.speed).toFixed(1)}</span>
          <span className="ml-1 text-[0.6rem] sm:text-xs">knots</span>
        </div>
      </div>

      {/* Compass and navigation */}
      <div className="absolute bottom-2 right-2 sm:bottom-4 sm:right-4 flex flex-col gap-1 sm:gap-2">
        {/* Fire Button */}
        <button
          onClick={handleFire}
          className="bg-red-700 hover:bg-red-600 text-white font-bold py-1 px-2 sm:py-2 sm:px-4 rounded-md pointer-events-auto transition-colors text-xs sm:text-base"
          data-testid="cypress-fire-cannon-button"
        >
          Fire Cannons
        </button>

        <div className="bg-black/50 p-2 sm:p-3 rounded-md text-white">
          <div className="flex items-center">
            <Compass className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" />
            <div>
              {nearestPort ? (
                <div>
                  <div className="text-[0.6rem] sm:text-xs opacity-70">Nearest Port</div>
                  <div className="font-bold text-sm sm:text-base">{nearestPort.name}</div>
                  <div className="text-[0.6rem] sm:text-xs">
                    <span className="opacity-70">Distance:</span> {distance} units
                  </div>
                </div>
              ) : (
                <div className="text-sm sm:text-base">No ports in range</div>
              )}
            </div>
          </div>
        </div>

        {/* Scuttle Ship Button + modal */}
        {player && !isSunk && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                data-testid="cypress-scuttle-ship-request-button"
                variant="destructive"
                className="flex items-center gap-1 sm:gap-2 shadow-lg bg-red-700 hover:bg-red-800 text-white font-bold border-2 border-red-900 pointer-events-auto text-xs sm:text-base py-1 sm:py-2 px-2 sm:px-4 transition-all duration-200"
              >
                <Skull size={12} className="sm:h-4 sm:w-4" />
                <span>Retire</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="relative bg-gradient-to-br from-amber-900/80 to-amber-800/80 border-amber-500/50 text-white w-[90vw] sm:w-auto max-w-[90vw] sm:max-w-lg p-6 rounded-lg shadow-lg">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-600 to-amber-400 rounded-t-lg" />
              <DialogHeader>
                <div className="flex items-center mb-4">
                  <Skull className="h-6 w-6 mr-2 text-amber-300" />
                  <DialogTitle className="text-amber-400 text-lg sm:text-xl font-bold">
                    Retire from Piracy?
                  </DialogTitle>
                </div>
                <DialogDescription className="text-amber-100 text-sm sm:text-base italic">
                  Your crew demands 500 gold as their final payment. Your ship and cargo will be lost forever. <span className="text-red-400 font-bold">This action cannot be undone!</span>
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div className="flex justify-end">
                  <div className="text-right text-amber-200">
                    <div className="flex items-center justify-end mb-1">
                      <span className="mr-4">Current Gold:</span>
                      <span className="w-20 text-right">{gameState.player?.gold || 0}</span>
                    </div>
                    <div className="flex items-center justify-end mb-1">
                      <span className="mr-4">Crew Payment:</span>
                      <span className="w-20 text-right text-red-400">-500</span>
                    </div>
                    <div className="flex items-center justify-end border-t-2 border-amber-500 pt-1">
                      <span className="mr-4 font-bold">Final Score:</span>
                      <span className="w-20 text-right font-bold text-yellow-400 bg-amber-900/50 px-2 py-1 rounded">
                        {gameState.player?.gold ? gameState.player.gold - 500 : 0}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-red-400 text-sm text-center">
                  Are you sure you want to end your journey?
                </p>
              </div>
              <DialogFooter className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
                <DialogClose asChild>
                  <Button
                    data-testid="cypress-scuttle-ship-cancel-button"
                    variant="outline"
                    className="w-full sm:w-auto border-amber-500/50 text-amber-200 hover:bg-amber-900/50 text-sm font-semibold py-2 px-4 rounded-md transition-all duration-200"
                  >
                    <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  className="w-full sm:w-auto bg-red-700 hover:bg-red-800 text-white text-sm font-semibold py-2 px-4 rounded-md transition-all duration-200 disabled:bg-gray-600 disabled:cursor-not-allowed"
                  onClick={() => {
                    useSocket.getState().scuttleShip();
                  }}
                  //disabled={gameState.player?.gold && gameState.player.gold < 500}
                  data-testid="cypress-scuttle-ship-confirm-button"
                >
                  <Skull className="h-5 w-5 mr-2" />
                  Retire
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Cannon status */}
      <div className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 bg-black/50 p-2 sm:p-3 rounded-md text-white">
        <div className="flex items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <div>
            <div className="text-[0.6rem] sm:text-xs opacity-70">Cannons</div>
            <div className="flex items-center">
              <span className="font-bold text-sm sm:text-base">{player.canFire ? "Ready" : "Reloading"}</span>
              {!player.canFire && (
                <div className="ml-1 sm:ml-2 w-12 sm:w-16 h-1 sm:h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{
                      width: `${100 - ((Date.now() - player.lastFired) / player.reloadTime) * 100}%`,
                    }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to get health bar color based on percentage
function getHealthColor(current: number, max: number): string {
  const percentage = (current / max) * 100;

  if (percentage > 60) return "bg-green-500";
  if (percentage > 30) return "bg-amber-500";
  return "bg-red-500";
}