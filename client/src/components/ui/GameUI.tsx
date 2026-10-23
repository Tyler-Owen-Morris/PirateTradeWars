import { useState, useEffect, useRef } from "react";
import { useKeyboardControls } from "@react-three/drei";
import { useGameState } from "@/lib/stores/useGameState";
import { useAudio } from "@/lib/stores/useAudio";
import { useSocket } from "@/lib/stores/useSocket";
import HUD from "./HUD";
import Leaderboard from "./Leaderboard";
import { HudPanel, Kbd, PirateButton, WoodPanel, ptwDialogTorn } from "./pirate";
import { Volume2, VolumeX, HelpCircle, Map, Skull, Sliders, QrCode } from "lucide-react";
import { HelpTooltip } from "./HelpTooltip";
import { Minimap } from "./Minimap";
import { portPoint } from "@/lib/nav";
import { WorldMap } from "./WorldMap";
import { CompassHUD } from "./CompassHUD";
import { ToastContainer } from "./TradingToast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Slider } from "./slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import TouchControls from "./TouchControls";
import { QRCodeSVG } from 'qrcode.react';
//import { isMobile } from "react-device-detect"; // I don't know if we need this since we're detecting touch-enabled browser

interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

interface GameUIProps {
  controlsRef: React.MutableRefObject<ControlState>;
}

export default function GameUI({ controlsRef }: GameUIProps) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showWorldMap, setShowWorldMap] = useState(false);
  const { isSunk, gameState } = useGameState();
  const {
    isMuted,
    isMusicMuted,
    isSfxMuted,
    musicVolume,
    sfxVolume,
    toggleMute,
    toggleMusicMute,
    toggleSfxMute,
    setMusicVolume,
    setSfxVolume,
  } = useAudio();
  const [isDeviceTouch, setIsDeviceTouch] = useState(false)
  const [displayTouchControls, setDisplayTouchControls] = useState(false)

  useEffect(() => {
    function isTouchDevice() {
      return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0 || (navigator.msMaxTouchPoints > 0)))
    }
    let result = isTouchDevice();
    if (result) {
      setIsDeviceTouch(true)
      setShowMinimap(false)
    }
    console.log("device is touch", result)
  }, [])

  useEffect(() => {
    const shouldDisplay = !isSunk && isDeviceTouch
    console.log("touch", isDeviceTouch, "| sunk:", isSunk, "result:", shouldDisplay)
    setDisplayTouchControls(shouldDisplay)
  }, [isDeviceTouch, isSunk])


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      //console.log("key down", e.key, showLeaderboard)
      if (e.key === "Tab") {
        e.preventDefault();
        setShowLeaderboard(true);
      }

      if (e.key === "h" || e.key === "H") {
        setShowControls((prev) => !prev);
      }

      if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") setShowWorldMap((prev) => !prev);
      }

      if (e.key === "t" || e.key === "T") {
        startTrade();
      };
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        setShowLeaderboard(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState.nearestPort, gameState.isNearPort, gameState.player, isMuted, isSfxMuted, sfxVolume]);

  const [showMinimap, setShowMinimap] = useState(!isDeviceTouch);

  const toggleMinimap = () => {
    setShowMinimap(!showMinimap);
  };

  const startTrade = () => {
    if (gameState.nearestPort && gameState.isNearPort) {
      useGameState.setState({ isTrading: true });
      console.log(`Trading at ${gameState.nearestPort.name}`);
      const { playSound } = useAudio.getState();
      if (typeof playSound === "function" && !isMuted && !isSfxMuted) {
        playSound("success", sfxVolume);
      }
    } else {
      const nearestPort = useGameState.getState().getNearestPort();
      if (nearestPort) {
        const player = gameState.player;
        if (player) {
          const distance = useGameState
            .getState()
            .calculateDistance(
              player.x,
              player.z,
              portPoint(nearestPort).x,
              portPoint(nearestPort).z,
            );
          const message = `Too far from ${nearestPort.name} (${Math.round(distance)} units away). Sail closer to trade!`;
          console.log(message);
        }
      } else {
        console.log("No ports nearby. Find a port to trade!");
      }
    }

  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  return (
    <>
      <CompassHUD onOpenMap={() => setShowWorldMap(true)} />
      <HUD controlsRef={controlsRef} onShowLeaderboard={() => setShowLeaderboard(true)} />
      {showLeaderboard && <div onClick={() => setShowLeaderboard(false)}><Leaderboard /></div>}
      <ToastContainer />

      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-50 flex gap-1.5 sm:gap-2">
        <PirateButton
          variant="porthole"
          onClick={() => setShowQRCode(true)}
          title="Share Game Link"
          aria-label="Share game link"
        >
          <QrCode />
        </PirateButton>

        <PirateButton
          variant="porthole"
          onClick={toggleMinimap}
          title="Toggle Navigation Map"
          aria-label="Toggle navigation map"
          aria-pressed={showMinimap}
        >
          <Map />
        </PirateButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PirateButton
              variant="porthole"
              title={isMuted ? "Unmute Sound" : "Mute Sound"}
              aria-label="Audio settings"
            >
              {isMuted ? <VolumeX /> : <Volume2 />}
            </PirateButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="ptw-hud border-ptw-brass/60 bg-transparent text-ptw-cream p-4 rounded-md shadow-lg w-60">
            <DropdownMenuLabel className="ptw-font-display text-xl font-normal text-ptw-brass-hi p-0">Audio Settings</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-ptw-brass/50 my-2" />

            {/* <DropdownMenuItem
              onClick={(event) => {
                toggleMute();
                (event.currentTarget as HTMLElement).blur();
              }}
              className="flex justify-between items-center cursor-pointer hover:bg-amber-500/20"
            >
              <span>{isMuted ? "Unmute All" : "Mute All"}</span>
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </DropdownMenuItem> */}

            <div className="mt-2">
              <div className="flex justify-between items-center mb-2">
                <span className="ptw-font-label">Music</span>
                <PirateButton
                  variant="porthole"
                  size="sm"
                  aria-label={isMusicMuted ? "Unmute music" : "Mute music"}
                  onClick={(event) => {
                    toggleMusicMute();
                    (event.currentTarget as HTMLButtonElement).blur();
                  }}
                >
                  {isMusicMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </PirateButton>
              </div>
              <Slider
                value={[musicVolume * 100]}
                onValueChange={(value) => setMusicVolume(value[0] / 100)}
                min={0}
                max={100}
                step={1}
                className="w-full"
                aria-label="Music volume"
              />
            </div>

            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="ptw-font-label">Sound Effects</span>
                <PirateButton
                  variant="porthole"
                  size="sm"
                  aria-label={isSfxMuted ? "Unmute sound effects" : "Mute sound effects"}
                  onClick={(event) => {
                    toggleSfxMute();
                    (event.currentTarget as HTMLButtonElement).blur();
                  }}
                >
                  {isSfxMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </PirateButton>
              </div>
              <Slider
                value={[sfxVolume * 100]}
                onValueChange={(value) => setSfxVolume(value[0] / 100)}
                min={0}
                max={100}
                step={1}
                className="w-full"
                aria-label="Sound effects volume"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showWorldMap && <WorldMap onClose={() => setShowWorldMap(false)} />}
      {showMinimap && gameState.player && <Minimap toggleMinimap={toggleMinimap} />}

      {/* Request to Trade */}
      {gameState.nearestPort && gameState.isNearPort && !isSunk && (
        <WoodPanel
          role="button"
          tabIndex={0}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 px-6 py-3 cursor-pointer motion-safe:animate-pulse hover:brightness-110 text-center max-w-[90vw]"
          onClick={startTrade}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") startTrade();
          }}
        >
          <p className="ptw-font-display text-2xl sm:text-3xl leading-none text-ptw-brass-hi">
            {gameState.nearestPort.name}
          </p>
          <p className="mt-1.5 text-sm sm:text-base">
            Click here or press <Kbd>T</Kbd> to trade
          </p>
        </WoodPanel>
      )}

      {!isSunk && (
        <div
          onClick={() => setShowControls(true)}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-40 text-ptw-cream text-sm cursor-pointer [text-shadow:0_1px_2px_#000]"
        >
          Press <Kbd>H</Kbd> for help
        </div>
      )}

      {showControls && (
        <HudPanel onClick={() => setShowControls(false)} className="absolute left-1/2 bottom-4 transform -translate-x-1/2 z-50 px-5 py-4 w-[min(22rem,92vw)]">
          <h3 className="ptw-title text-2xl mb-3 text-ptw-brass-hi">
            Game Controls
          </h3>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
            <div><Kbd>W</Kbd> <Kbd>â†‘</Kbd></div>
            <div>Move Forward</div>
            <div><Kbd>S</Kbd> <Kbd>â†“</Kbd></div>
            <div>Move Backward</div>
            <div><Kbd>A</Kbd> <Kbd>â†</Kbd></div>
            <div>Turn Left</div>
            <div><Kbd>D</Kbd> <Kbd>â†’</Kbd></div>
            <div>Turn Right</div>
            <div><Kbd>Space</Kbd></div>
            <div>Fire Cannons</div>
            <div><Kbd>T</Kbd></div>
            <div>Trade at Port</div>
            <div><Kbd>Tab</Kbd></div>
            <div>View Leaderboard</div>
            <div><Kbd>M</Kbd></div>
            <div>World Map</div>
            <div><Kbd>H</Kbd></div>
            <div>Toggle Controls</div>
          </div>
        </HudPanel>
      )}

      {displayTouchControls && <TouchControls controlsRef={controlsRef} />}

      <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
        <DialogContent className={`${ptwDialogTorn} w-[92vw] max-w-md px-6 pt-8 pb-7`}>
          <DialogHeader>
            <DialogTitle className="ptw-title font-normal text-3xl">Share Game Link</DialogTitle>
            <DialogDescription className="text-ptw-ink-soft text-base text-center italic">
              Scan the QR code or copy the link to share this game with others
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="bg-[#fbf3df] p-3 rounded-sm shadow-[0_0_0_2px_#2a1a0c,0_0_0_5px_#f7ecd2,0_0_0_6px_rgba(42,26,12,0.5)]">
              <QRCodeSVG value={window.location.href} size={200} bgColor="#fbf3df" fgColor="#2a1a0c" />
            </div>
            <PirateButton onClick={copyToClipboard}>
              Click to Copy Link
            </PirateButton>
          </div>
          <DialogFooter className="sm:justify-center">
            <PirateButton
              variant="rope"
              onClick={() => setShowQRCode(false)}
            >
              Close
            </PirateButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
