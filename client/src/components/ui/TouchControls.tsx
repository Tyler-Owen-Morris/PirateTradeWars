
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useGameState } from '@/lib/stores/useGameState';

interface TouchPosition {
  x: number;
  y: number;
}

export function TouchControls() {
  const isMobile = useIsMobile();
  const joystickRef = useRef<HTMLDivElement>(null);
  const [touching, setTouching] = useState(false);
  const [startPos, setStartPos] = useState<TouchPosition>({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState<TouchPosition>({ x: 0, y: 0 });
  
  // Don't render on desktop
  if (!isMobile) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const pos = { x: touch.clientX, y: touch.clientY };
    setStartPos(pos);
    setCurrentPos(pos);
    setTouching(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touching) return;
    const touch = e.touches[0];
    setCurrentPos({ x: touch.clientX, y: touch.clientY });
    
    // Calculate direction vector
    const dx = touch.clientX - startPos.x;
    const dy = touch.clientY - startPos.y;
    const angle = Math.atan2(dy, dx);
    const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 50);
    
    // Update controls based on joystick position
    const forward = dy < -20;
    const backward = dy > 20;
    const left = dx < -20;
    const right = dx > 20;
    
    // Update global game state with touch controls
    useGameState.setState(state => ({
      ...state,
      controls: {
        forward,
        backward,
        left,
        right,
        fire: false
      }
    }));
  };

  const handleTouchEnd = () => {
    setTouching(false);
    // Reset controls
    useGameState.setState(state => ({
      ...state,
      controls: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        fire: false
      }
    }));
  };

  return (
    <div className="fixed bottom-20 left-10 touch-none">
      {/* Virtual joystick */}
      <div 
        ref={joystickRef}
        className="w-40 h-40 rounded-full bg-black/20 border-2 border-white/20"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          className="w-20 h-20 rounded-full bg-white/40 absolute"
          style={{
            left: touching ? currentPos.x - startPos.x : '50%',
            top: touching ? currentPos.y - startPos.y : '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>
      
      {/* Fire button */}
      <button
        className="fixed bottom-20 right-10 w-20 h-20 rounded-full bg-red-500/50"
        onTouchStart={() => useGameState.setState(state => ({
          ...state,
          controls: { ...state.controls, fire: true }
        }))}
        onTouchEnd={() => useGameState.setState(state => ({
          ...state,
          controls: { ...state.controls, fire: false }
        }))}
      >
        Fire
      </button>
    </div>
  );
}
