import { create } from "zustand";
import { useGameState } from "./useGameState";
import { PlayerState, SocketMessage, Vector3 } from "@/types";
import { useAudio } from "./useAudio";

interface SocketState {
  socket: WebSocket | null;
  connected: boolean;
  playerId: string | null;
  error: string | null;
  
  // Connection management
  connect: () => void;
  disconnect: () => void;
  resetError: () => void;
  
  // Message sending
  register: (name: string, shipType: string) => void;
  sendInput: (speed: number, direction: Vector3, firing: boolean, rotationY?: number) => void;
  sendTrade: (portId: number, action: 'buy' | 'sell', goodId: number, quantity: number) => void;
  scuttleShip: () => void;
  
  // Receive handlers
  onGameUpdate: (players: Record<string, PlayerState>, cannonBalls: any[]) => void;
}

export const useSocket = create<SocketState>((set, get) => {
  return {
    socket: null,
    connected: false,
    playerId: null,
    error: null,
    
    connect: () => {
      try {
        // Close existing connection if any
        if (get().socket) {
          get().socket?.close();
        }
        
        // Create new WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Use a specific game WebSocket path to avoid conflicts with Vite's websocket
        const wsUrl = `${protocol}//${window.location.host}/game-ws`;
        console.log('Connecting to WebSocket URL:', wsUrl);
        
        const socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
          console.log('WebSocket connection established');
          set({ connected: true, error: null });
        };
        
        socket.onclose = () => {
          console.log('WebSocket connection closed');
          set({ connected: false, playerId: null });
        };
        
        socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          set({ error: 'Connection error. Please try again.' });
        };
        
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as SocketMessage;
            
            switch (message.type) {
              case 'welcome':
                console.log('Received welcome message:', message);
                break;
                
              case 'registered':
                console.log('Successfully registered:', message);
                set({ playerId: message.playerId, error: null });
                // Set the player as registered in game state
                useGameState.setState({ isRegistered: true });
                break;
                
              case 'gameUpdate':
                // Update game state with received data
                get().onGameUpdate(message.players, message.cannonBalls);
                break;
                
              case 'tradeSuccess':
                // Play success sound
                useAudio.getState().playSuccess();
                
                // Update player gold and inventory if present in the message
                if (message.gold !== undefined) {
                  // Update player's gold in the game state
                  const gameState = useGameState.getState();
                  if (gameState.gameState.player) {
                    gameState.gameState.player.gold = message.gold;
                  }
                }
                
                // Update inventory if present
                if (message.inventory && Array.isArray(message.inventory)) {
                  // Update inventory in game state
                  useGameState.getState().updatePlayerInventory(message.inventory);
                }
                break;
                
              case 'gameEnd':
                console.log('Game ended:', message);
                // Update game state with the reason for game ending
                const gameState = useGameState.getState();
                // Update leaderboard data
                if (message.leaderboard && Array.isArray(message.leaderboard)) {
                  gameState.gameState.leaderboard = message.leaderboard;
                }
                // Set player as sunk to show game over screen
                gameState.isSunk = true;
                break;
                
              case 'error':
                console.error('Server error:', message.message);
                set({ error: message.message });
                break;
                
              default:
                console.log('Unknown message type:', message);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };
        
        set({ socket });
        
      } catch (error) {
        console.error('Failed to connect WebSocket:', error);
        set({ error: 'Failed to establish connection. Please refresh and try again.' });
      }
    },
    
    disconnect: () => {
      const { socket } = get();
      if (socket) {
        socket.close();
        set({ socket: null, connected: false, playerId: null });
      }
    },
    
    resetError: () => {
      set({ error: null });
    },
    
    register: (name, shipType) => {
      const { socket, connected } = get();
      if (!socket || !connected) {
        set({ error: 'Not connected. Please refresh and try again.' });
        return;
      }
      
      const message = {
        type: 'register',
        name,
        shipType
      };
      
      socket.send(JSON.stringify(message));
    },
    
    sendInput: (speed, direction, firing, rotationY) => {
      const { socket, connected } = get();
      if (!socket || !connected) return;
      
      const message = {
        type: 'input',
        rotationY,
        speed,
        direction,
        firing
      };
      
      socket.send(JSON.stringify(message));
    },
    
    sendTrade: (portId, action, goodId, quantity) => {
      const { socket, connected } = get();
      if (!socket || !connected) {
        set({ error: 'Not connected. Please refresh and try again.' });
        return;
      }
      
      const message = {
        type: 'trade',
        portId,
        action,
        goodId,
        quantity
      };
      
      socket.send(JSON.stringify(message));
    },
    
    scuttleShip: () => {
      const { socket, connected } = get();
      if (!socket || !connected) {
        set({ error: 'Not connected. Please refresh and try again.' });
        return;
      }
      
      const message = {
        type: 'scuttle'
      };
      
      socket.send(JSON.stringify(message));
    },
    
    onGameUpdate: (players, cannonBalls) => {
      // Update game state with received data
      useGameState.getState().updateOtherPlayers(players);
      useGameState.getState().updateCannonBalls(cannonBalls);
      
      // Check for hits (play sound if player was hit)
      const playerId = get().playerId;
      if (playerId && players[playerId]) {
        const player = players[playerId];
        const gameState = useGameState.getState();
        
        // Check if player HP decreased
        if (gameState.gameState.player && player.hp < gameState.gameState.player.hp) {
          useAudio.getState().playHit();
        }
        
        // Update player state
        gameState.updatePlayer(player);
      }
    }
  };
});
