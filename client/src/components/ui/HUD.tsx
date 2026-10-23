import { useEffect, useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { ChevronsRight, Coins, Skull, X } from 'lucide-react';
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
import { speedToKnots } from '@/lib/nav';
import { ReloadGauges } from './ReloadGauges';
import { HudPanel, PirateButton, PirateMeter, WaxSeal, hullTone, ptwDialogTorn } from './pirate';

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

interface GoldAnimation {
  id: number;
  value: number;
  key: string;
}

export default function HUD({ controlsRef, onShowLeaderboard }: HUDProps) {
  const { gameState } = useGameState();
  const { isSunk } = useGameState();
  const player = gameState.player;
  const [goldAnimations, setGoldAnimations] = useState<GoldAnimation[]>([]);
  const [prevGold, setPrevGold] = useState<number | null>(null);

  // Track gold changes and create animations
  useEffect(() => {
    if (player && player.gold !== prevGold && prevGold !== null) {
      const difference = player.gold - prevGold;
      const newAnimation: GoldAnimation = {
        id: Date.now(),
        value: difference,
        key: `gold-anim-${Date.now()}`,
      };
      setGoldAnimations((prev) => [...prev, newAnimation]);

      // Remove animation after 3 seconds
      setTimeout(() => {
        setGoldAnimations((prev) => prev.filter((anim) => anim.id !== newAnimation.id));
      }, 3000);
    }
    setPrevGold(player?.gold ?? null);
  }, [player?.gold, prevGold]);
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

  const hullPct = (player.hp / player.maxHp) * 100;
  const cargoPct = (player.cargoUsed / player.cargoCapacity) * 100;

  return (
    <div className="absolute mb-20 sm:mb-20 md:mb-10 inset-0">

      {/* Ship stats panel */}
      <HudPanel onClick={onShowLeaderboard} className="absolute top-2 left-2 sm:top-4 sm:left-4 px-2 py-1.5 sm:px-3.5 sm:py-3 w-[44vw] sm:w-[19rem] max-w-[70vw] sm:max-w-[400px] cursor-pointer">
        <div className="mb-1 sm:mb-2 flex items-baseline gap-1.5">
          <span className="ptw-font-display text-[0.95rem] sm:text-[1.35rem] leading-none truncate">
            <span data-testid="cypress-player-name">{player.name}</span>
            <span className="hidden sm:inline">&rsquo;s Ship</span>
          </span>
          <span className="ptw-hud-label text-[0.6rem] sm:text-xs ml-auto shrink-0" data-testid="cypress-ship-type">{player.shipType}</span>
        </div>

        {/* HP Bar */}
        <div className="mb-1 sm:mb-2">
          <div className="flex justify-between items-baseline text-[0.6rem] sm:text-xs mb-0.5 sm:mb-1">
            <span className="ptw-hud-label">Hull</span>
            <span className="ptw-num font-medium">{player.hp} / {player.maxHp}</span>
          </div>
          <PirateMeter value={hullPct} tone={hullTone(player.hp, player.maxHp)} label="Hull integrity" className="h-1 sm:h-2" />
        </div>

        {/* Cargo capacity */}
        <div className="mb-1 sm:mb-2">
          <div className="flex justify-between items-baseline text-[0.6rem] sm:text-xs mb-0.5 sm:mb-1">
            <span className="ptw-hud-label">Cargo</span>
            <span className="ptw-num font-medium">{player.cargoUsed} / {player.cargoCapacity}</span>
          </div>
          <PirateMeter value={cargoPct} tone="cargo" label="Cargo used" className="h-1 sm:h-2" />
        </div>

        {/* Gold with animations */}
        <div className="relative flex items-center mt-1 sm:mt-3 pt-1 sm:pt-2 border-t border-ptw-brass/30">
          <Coins className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 text-ptw-gold" aria-hidden="true" />
          <span className="ptw-num font-bold text-sm sm:text-lg text-ptw-gold leading-none">{player.gold}</span>
          <span className="ml-1 ptw-hud-label text-[0.6rem] sm:text-xs">gold</span>
          {goldAnimations.map((anim) => (
            <span
              key={anim.key}
              className={`absolute left-20 ptw-num text-xs sm:text-sm font-bold animate-gold ${anim.value >= 0 ? 'text-ptw-good' : 'text-ptw-bad'
                }`}
              style={{
                animation: 'goldAnimation 3s ease-out forwards',
              }}
            >
              {anim.value >= 0 ? '+' : ''}{anim.value}
            </span>
          ))}
        </div>
      </HudPanel>

      {/* Speed indicator */}
      <HudPanel className="absolute top-[9.5rem] right-2 sm:top-[11.5rem] sm:right-4 lg:top-20 px-2 py-1 sm:px-3 sm:py-2">
        <div className="flex items-baseline">
          <ChevronsRight className={`self-center h-4 w-4 sm:h-5 sm:w-5 ${Math.abs(player.speed) > 0 ? 'text-ptw-good' : 'text-ptw-cream/50'}`} aria-hidden="true" />
          <span className="ml-1 sm:ml-1.5 ptw-num font-bold text-sm sm:text-lg leading-none">{speedToKnots(player.speed).toFixed(1)}</span>
          <span className="ml-1 ptw-hud-label text-[0.6rem] sm:text-xs">knots</span>
        </div>
      </HudPanel>

      {/* Actions */}
      <div className="absolute bottom-2 right-2 sm:bottom-4 sm:right-4 flex flex-col gap-1.5 sm:gap-2">
        {/* Fire Button */}
        <PirateButton
          variant="iron"
          onClick={handleFire}
          className="pointer-events-auto min-h-[2rem] sm:min-h-[2.75rem] px-3 sm:px-5 text-sm sm:text-lg"
          data-testid="cypress-fire-cannon-button"
        >
          Fire Cannons
        </PirateButton>

        {/* Target port / compass now live in CompassHUD (top centre) */}

        {/* Scuttle Ship Button + modal */}
        {player && !isSunk && (
          <Dialog>
            <DialogTrigger asChild>
              <PirateButton
                data-testid="cypress-scuttle-ship-request-button"
                variant="wax"
                className="pointer-events-auto min-h-[2rem] sm:min-h-[2.5rem] px-3 sm:px-5 text-sm sm:text-base"
              >
                <Skull aria-hidden="true" />
                <span>Retire</span>
              </PirateButton>
            </DialogTrigger>
            <DialogContent className={`${ptwDialogTorn} w-[92vw] sm:w-auto max-w-[92vw] sm:max-w-lg px-6 pt-8 pb-7`}>
              <WaxSeal emblem="skull" className="h-16 w-16 mx-auto -mb-1" />
              <DialogHeader>
                <DialogTitle className="ptw-title font-normal text-[1.9rem] sm:text-4xl">
                  Retire from Piracy?
                </DialogTitle>
                <DialogDescription className="text-ptw-ink text-base sm:text-lg italic text-center">
                  Your crew demands 500 gold as their final payment. Your ship and cargo will be lost forever. <span className="not-italic font-bold text-ptw-bad-ink">This action cannot be undone!</span>
                </DialogDescription>
              </DialogHeader>
              <div className="mt-1 space-y-3">
                <dl className="ptw-ledger ptw-num mx-auto w-full max-w-[18rem] text-base">
                  <div className="ptw-ledger__row flex justify-between py-1">
                    <dt className="ptw-font-label">Current Gold</dt>
                    <dd>{gameState.player?.gold || 0}</dd>
                  </div>
                  <div className="ptw-ledger__row flex justify-between py-1">
                    <dt className="ptw-font-label">Crew Payment</dt>
                    <dd className="text-ptw-bad-ink">-500</dd>
                  </div>
                  <div className="flex justify-between py-1.5 border-t-2 border-ptw-ink mt-px">
                    <dt className="ptw-font-label font-bold">Final Score</dt>
                    <dd className="font-bold text-lg">
                      {gameState.player?.gold ? gameState.player.gold - 500 : 0}
                    </dd>
                  </div>
                </dl>
                <p className="text-ptw-bad-ink text-sm text-center italic">
                  Are you sure you want to end your journey?
                </p>
              </div>
              <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-center mt-2">
                <DialogClose asChild>
                  <PirateButton
                    data-testid="cypress-scuttle-ship-cancel-button"
                    variant="rope"
                    className="w-full sm:w-auto"
                  >
                    <X aria-hidden="true" />
                    Cancel
                  </PirateButton>
                </DialogClose>
                <PirateButton
                  variant="wax"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    useSocket.getState().scuttleShip();
                  }}
                  //disabled={gameState.player?.gold && gameState.player.gold < 500}
                  data-testid="cypress-scuttle-ship-confirm-button"
                >
                  <Skull aria-hidden="true" />
                  Retire
                </PirateButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Cannon status */}
      <HudPanel className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 px-2 py-1.5 sm:px-3 sm:py-2">
        <div className="flex items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-5 w-5 sm:h-6 sm:w-6 mr-1.5 sm:mr-2 ${player.canFire ? 'text-ptw-gold' : 'text-ptw-cream/50'}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {/* cannon on its carriage */}
            <path fill="currentColor" d="M3 9.5c0-.8.6-1.5 1.4-1.6l12.8-1.6c.4 0 .8.1 1 .4l1.3 1.3h1c.8 0 1.5.7 1.5 1.5v1c0 .8-.7 1.5-1.5 1.5h-1l-1.3 1.3c-.3.3-.6.4-1 .4L4.4 12.1c-.8-.1-1.4-.8-1.4-1.6v-1z" />
            <circle cx="8" cy="15.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="8" cy="15.5" r="0.9" fill="currentColor" />
            <path fill="currentColor" d="M5 18.2h9l1 1.3H4z" />
          </svg>
          {/* Broadsides: port (L) and starboard (R) reload separately */}
          <ReloadGauges
            reloadPortMs={player.reloadPortMs ?? player.reloadMs}
            reloadStarboardMs={player.reloadStarboardMs ?? player.reloadMs}
            reloadTime={player.reloadTime}
          />
        </div>
      </HudPanel>
      {/* CSS for gold animation */}
      <style>
        {`
          @keyframes goldAnimation {
            0% {
              transform: translateY(0);
              opacity: 1;
            }
            100% {
              transform: translateY(-30px);
              opacity: 0;
            }
          }
          .animate-gold {
            animation: goldAnimation 3s ease-out forwards;
          }
        `}
      </style>
    </div>
  );
}
