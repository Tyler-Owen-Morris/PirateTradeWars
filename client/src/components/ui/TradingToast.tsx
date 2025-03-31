import { useState, useEffect } from 'react';
import { useGameState } from '@/lib/stores/useGameState';

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
  
  const bgColorMap = {
    success: 'bg-green-800/90',
    error: 'bg-red-800/90',
    info: 'bg-blue-800/90'
  };
  
  const borderColorMap = {
    success: 'border-green-500',
    error: 'border-red-500',
    info: 'border-blue-500'
  };
  
  const iconMap = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };
  
  return (
    <div className={`fixed top-20 right-5 z-50 ${bgColorMap[type]} border ${borderColorMap[type]} text-white p-3 rounded-md shadow-lg animate-fade-in max-w-xs`}>
      <div className="flex items-start gap-2">
        <div className="font-bold text-lg">{iconMap[type]}</div>
        <div>{message}</div>
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
        // Add toast messages for trading interactions
        if (gameState.nearestPort && gameState.isNearPort) {
          addToast(`Trading at ${gameState.nearestPort.name}`, 'success');
        } else {
          const nearestPort = useGameState.getState().getNearestPort();
          if (nearestPort) {
            const player = gameState.player;
            if (player) {
              const distance = useGameState.getState().calculateDistance(
                player.x, player.z, nearestPort.x, nearestPort.z
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