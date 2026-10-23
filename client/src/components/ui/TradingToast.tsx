import { portPoint } from "@/lib/nav";
import { useState, useEffect } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { isTextEntryActive } from '@/lib/stores/useInputFocus';

interface TradingToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number; // in milliseconds
}

/**
 * A toast notification component for the pirate game
 * Used to show trading-related messages
 */
export function TradingToast({ message, type, duration = 3000 }: TradingToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  if (!visible) return null;

  // Accent colour of the slip's left edge and icon (on parchment, so dark inks).
  const accentMap = {
    success: '#2f6b2a',
    error: '#8e1a14',
    info: '#1f4a6b'
  };
  
  const iconMap = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };

  return (
    <div
      role="status"
      className="ptw-toast fixed top-20 right-5 z-50 px-3 py-2.5 motion-safe:animate-fade-in max-w-xs"
      style={{ ['--ptw-toast-c' as string]: accentMap[type] } as React.CSSProperties}
    >
      <div className="flex items-start gap-2">
        <div className="font-bold text-lg leading-none mt-0.5" style={{ color: accentMap[type] }} aria-hidden="true">{iconMap[type]}</div>
        <div className="leading-snug">{message}</div>
      </div>
    </div>
  );
}

/**
 * Toast container that manages multiple toasts
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success' | 'error' | 'info'}[]>([]);
  const { gameState } = useGameState();

  // Listen for toast events in a real application, this would be handled by a proper toast manager
  useEffect(() => {
    // This is just for demonstration, in a real app you would use a pub/sub system or context
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') {
        // 2026-10-23: no "Trading at ..." toast any more (it duplicated the screen opening); only the
        // too-far / no-port explanations remain. Ignored while trading or typing (chat).
        const gs = useGameState.getState();
        if (gs.isTrading || isTextEntryActive()) return;
        if (gameState.nearestPort && gameState.isNearPort) {
          return;
        } else {
          const nearestPort = useGameState.getState().getNearestPort();
          if (nearestPort) {
            const player = gameState.player;
            if (player) {
              const distance = useGameState.getState().calculateDistance(
                player.x, player.z, portPoint(nearestPort).x, portPoint(nearestPort).z
              );
              addToast(`Too far from ${nearestPort.name} (${Math.round(distance)} units away)`, 'error');
            }
          } else {
            addToast("No ports nearby. Find a port to trade!", 'info');
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameState.nearestPort, gameState.isNearPort, gameState.player]);

  // Add a new toast
  const addToast = (message: string, type: 'success' | 'error' | 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);

    // Remove the toast after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);
  };

  return (
    <div className="fixed top-5 right-5 z-50 space-y-2">
      {toasts.map(toast => (
        <TradingToast
          key={toast.id}
          message={toast.message}
          type={toast.type}
        />
      ))}
    </div>
  );
}