import { useState, useEffect, useRef } from "react";
import { useKeyboardControls } from "@react-three/drei";
import { useGameState } from "@/lib/stores/useGameState";
import { useAudio } from "@/lib/stores/useAudio";
import { useSocket } from "@/lib/stores/useSocket";
import HUD from "./HUD";
import Leaderboard from "./Leaderboard";
import { Button } from "./button";
import { Volume2, VolumeX, HelpCircle, Map, Skull, Sliders, QrCode } from "lucide-react";
import { HelpTooltip } from "./HelpTooltip";
import { Minimap } from "./Minimap";
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
      if (e.key === "Tab") {
        e.preventDefault();
        setShowLeaderboard(true);
      }

      if (e.key === "h" || e.key === "H") {
        setShowControls((prev) => !prev);
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
              nearestPort.x,
              nearestPort.z,
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
      <HUD controlsRef={controlsRef} />
      {showLeaderboard && <Leaderboard />}
      <ToastContainer />

      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowQRCode(true)}
          className="bg-black/50 border-0 text-white hover:bg-black/70"
          title="Share Game Link"
        >
          <QrCode />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={toggleMinimap}
          className="bg-black/50 border-0 text-white hover:bg-black/70"
          title="Toggle Navigation Map"
        >
          <Map />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="bg-black/50 border-0 text-white hover:bg-black/70"
              title={isMuted ? "Unmute Sound" : "Mute Sound"}
            >
              {isMuted ? <VolumeX /> : <Volume2 />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-black/90 border-amber-500 text-white p-4 rounded-md shadow-lg">
            <DropdownMenuLabel className="text-amber-400">Audio Settings</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-amber-500" />

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
              <div className="flex justify-between items-center mb-1">
                <span>Music </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(event) => {
                    toggleMusicMute();
                    (event.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="bg-black/50 border-0 text-white hover:bg-amber-500/20"
                >
                  {isMusicMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </Button>
              </div>
              <Slider
                value={[musicVolume * 100]}
                onValueChange={(value) => setMusicVolume(value[0] / 100)}
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
            </div>

            <div className="mt-2">
              <div className="flex justify-between items-center mb-1">
                <span>SFX </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(event) => {
                    toggleSfxMute();
                    (event.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="bg-black/50 border-0 text-white hover:bg-amber-500/20"
                >
                  {isSfxMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </Button>
              </div>
              <Slider
                value={[sfxVolume * 100]}
                onValueChange={(value) => setSfxVolume(value[0] / 100)}
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showMinimap && gameState.player && <Minimap toggleMinimap={toggleMinimap} />}

      {/* Request to Trade */}
      {gameState.nearestPort && gameState.isNearPort && !isSunk && (
        <div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-black/80 text-white p-3 rounded-md border border-amber-500 shadow-lg animate-pulse cursor-pointer hover:bg-black/90 transition-colors"
          onClick={startTrade}
        >
          <p className="text-center">
            <span className="font-bold text-amber-400">
              {gameState.nearestPort.name}
            </span>{" "}
            - Click here or press <span className="font-mono bg-black px-2 rounded">T</span>{" "}
            to trade
          </p>
        </div>
      )}

      {!isSunk && (
        <div onClick={() => setShowControls(true)} className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-40 text-white text-sm opacity-70">
          Press <span className="font-mono bg-black/60 px-1 rounded">H</span> for help
        </div>
      )}

      {showControls && (
        <div onClick={() => setShowControls(false)} className="absolute left-1/2 bottom-4 transform -translate-x-1/2 z-50 bg-black/80 text-white p-4 rounded-md border border-amber-500 shadow-lg">
          <h3 className="text-center font-bold mb-2 text-amber-400">
            Game Controls
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div className="font-mono bg-black/60 px-2 rounded">W / ↑</div>
            <div>Move Forward</div>
            <div className="font-mono bg-black/60 px-2 rounded">S / ↓</div>
            <div>Move Backward</div>
            <div className="font-mono bg-black/60 px-2 rounded">A / ←</div>
            <div>Turn Left</div>
            <div className="font-mono bg-black/60 px-2 rounded">D / →</div>
            <div>Turn Right</div>
            <div className="font-mono bg-black/60 px-2 rounded">Space</div>
            <div>Fire Cannons</div>
            <div className="font-mono bg-black/60 px-2 rounded">T</div>
            <div>Trade at Port</div>
            <div className="font-mono bg-black/60 px-2 rounded">Tab</div>
            <div>View Leaderboard</div>
            <div className="font-mono bg-black/60 px-2 rounded">H</div>
            <div>Toggle Controls</div>
          </div>
        </div>
      )}

      {displayTouchControls && <TouchControls controlsRef={controlsRef} />}

      <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
        <DialogContent className="bg-black/90 border-amber-500 text-white">
          <DialogHeader>
            <DialogTitle className="text-amber-400">Share Game Link</DialogTitle>
            <DialogDescription className="text-gray-300">
              Scan the QR code or copy the link to share this game with others
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={window.location.href} size={200} />
            </div>
            <Button
              onClick={copyToClipboard}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Click to Copy Link
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowQRCode(false)}
              className="border-amber-400 text-amber-200 hover:bg-amber-800"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}