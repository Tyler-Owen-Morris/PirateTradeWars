import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { apiRequest } from "../queryClient";
import { 
  GameState, 
  Port, 
  Good, 
  PortGood, 
  LeaderboardEntry, 
  InventoryItem,
  PlayerState
} from "@/types";

interface GameStateStore {
  gameState: GameState;
  isRegistered: boolean;
  isPlaying: boolean;
  isSunk: boolean;
  isTrading: boolean;
  isNearPort: boolean;
  nearPortId: number | null;
  currentPortGoods: PortGood[];

  // Player actions
  registerPlayer: (name: string) => void;
  selectShip: (shipType: string) => void;
  startGame: () => void;
  restartGame: () => void;
  
  // Game state updates
  updatePlayer: (player: PlayerState) => void;
  updateOtherPlayers: (players: Record<string, PlayerState>) => void;
  updateCannonBalls: (cannonBalls: any[]) => void;
  updatePlayerInventory: (inventory: InventoryItem[]) => void;
  
  // Port and trading
  loadPorts: () => Promise<void>;
  loadGoods: () => Promise<void>;
  loadPortGoods: (portId: number) => Promise<void>;
  setNearPort: (portId: number | null) => void;
  setIsTrading: (isTrading: boolean) => void;
  
  // Leaderboard
  loadLeaderboard: () => Promise<void>;
  
  // Helper methods
  getNearestPort: () => Port | null;
  isPlayerNearPort: () => boolean;
  calculateDistance: (x1: number, z1: number, x2: number, z2: number) => number;
}

export const useGameState = create<GameStateStore>()(
  subscribeWithSelector((set, get) => ({
    gameState: {
      player: null,
      otherPlayers: {},
      cannonBalls: [],
      ports: [],
      goods: [],
      inventory: [],
      nearestPort: null,
      isNearPort: false,
      leaderboard: []
    },
    isRegistered: false,
    isPlaying: false,
    isSunk: false,
    isTrading: false,
    isNearPort: false,
    nearPortId: null,
    currentPortGoods: [],
    
    // Player registration and game start
    registerPlayer: (name: string) => {
      set({ isRegistered: true });
    },
    
    selectShip: (shipType: string) => {
      set({ isPlaying: true });
    },
    
    startGame: () => {
      set({ isPlaying: true });
    },
    
    restartGame: () => {
      set({
        isRegistered: false,
        isPlaying: false,
        isSunk: false,
        isTrading: false,
        gameState: {
          ...get().gameState,
          player: null,
          otherPlayers: {},
          cannonBalls: [],
          inventory: []
        }
      });
    },
    
    // Game state updates
    updatePlayer: (player: PlayerState) => {
      set((state) => ({
        gameState: {
          ...state.gameState,
          player
        },
        isSunk: player.sunk
      }));
    },
    
    updateOtherPlayers: (players: Record<string, PlayerState>) => {
      // Extract current player and filter out other players
      const currentPlayerId = get().gameState.player?.id;
      
      if (!currentPlayerId) return;
      
      const currentPlayer = players[currentPlayerId];
      const otherPlayers: Record<string, PlayerState> = {};
      
      Object.entries(players).forEach(([id, player]) => {
        if (id !== currentPlayerId) {
          otherPlayers[id] = player;
        }
      });
      
      set((state) => ({
        gameState: {
          ...state.gameState,
          player: currentPlayer || state.gameState.player,
          otherPlayers
        }
      }));
    },
    
    updateCannonBalls: (cannonBalls) => {
      set((state) => ({
        gameState: {
          ...state.gameState,
          cannonBalls
        }
      }));
    },
    
    updatePlayerInventory: (inventory) => {
      set((state) => ({
        gameState: {
          ...state.gameState,
          inventory
        }
      }));
    },
    
    // Port and trading
    loadPorts: async () => {
      try {
        const response = await apiRequest('GET', '/api/ports', undefined);
        const ports = await response.json();
        
        set((state) => ({
          gameState: {
            ...state.gameState,
            ports
          }
        }));
        
        // After loading ports, check if player is near any port
        setTimeout(() => {
          const player = get().gameState.player;
          if (player) {
            const nearestPort = get().getNearestPort();
            if (nearestPort) {
              const distance = get().calculateDistance(player.x, player.z, nearestPort.x, nearestPort.z);
              if (distance <= nearestPort.safeRadius) {
                get().setNearPort(nearestPort.id);
              }
            }
          }
        }, 500);
      } catch (error) {
        console.error('Failed to load ports:', error);
      }
    },
    
    loadGoods: async () => {
      try {
        const response = await apiRequest('GET', '/api/goods', undefined);
        const goods = await response.json();
        
        set((state) => ({
          gameState: {
            ...state.gameState,
            goods
          }
        }));
      } catch (error) {
        console.error('Failed to load goods:', error);
      }
    },
    
    loadPortGoods: async (portId: number) => {
      try {
        const response = await apiRequest('GET', `/api/ports/${portId}/goods`, undefined);
        const portGoods = await response.json();
        
        set({ currentPortGoods: portGoods });
      } catch (error) {
        console.error('Failed to load port goods:', error);
      }
    },
    
    setNearPort: (portId: number | null) => {
      if (portId === null) {
        // Clear port
        console.log("Clearing nearest port");
        set({ 
          nearPortId: null,
          gameState: {
            ...get().gameState,
            nearestPort: null,
            isNearPort: false
          }
        });
        return;
      }
      
      // Find the port with this ID
      const ports = get().gameState.ports;
      const nearestPort = ports.find(p => p.id === portId) || null;
      
      console.log(`Setting near port: ${nearestPort?.name} (ID: ${portId})`);
      
      set({ 
        nearPortId: portId,
        gameState: {
          ...get().gameState,
          nearestPort,
          isNearPort: true
        }
      });
      
      // Load the port goods if we're near a port
      get().loadPortGoods(portId);
    },
    
    // clearNearPort is now handled by setNearPort(null)
    
    setIsTrading: (isTrading) => {
      set({ isTrading });
      
      // If starting to trade, make sure we load port goods
      if (isTrading && get().nearPortId !== null) {
        const portId = get().nearPortId;
        if (portId !== null) {
          get().loadPortGoods(portId);
        }
      }
    },
    
    // Leaderboard
    loadLeaderboard: async () => {
      try {
        const response = await apiRequest('GET', '/api/leaderboard', undefined);
        const leaderboard = await response.json();
        
        set((state) => ({
          gameState: {
            ...state.gameState,
            leaderboard
          }
        }));
      } catch (error) {
        console.error('Failed to load leaderboard:', error);
      }
    },
    
    // Helper methods
    getNearestPort: () => {
      const { ports } = get().gameState;
      const player = get().gameState.player;
      
      if (!player || ports.length === 0) return null;
      
      let nearestPort = null;
      let minDistance = Infinity;
      
      ports.forEach(port => {
        const distance = get().calculateDistance(player.x, player.z, port.x, port.z);
        if (distance < minDistance) {
          minDistance = distance;
          nearestPort = port;
        }
      });
      
      return nearestPort;
    },
    
    isPlayerNearPort: () => {
      const player = get().gameState.player;
      const nearestPort = get().getNearestPort();
      
      if (!player || !nearestPort) return false;
      
      const distance = get().calculateDistance(player.x, player.z, nearestPort.x, nearestPort.z);
      // Use the same PORT_INTERACTION_RADIUS constant for consistency
      // Using a hardcoded value of 200 to match what's in constants.ts
      const PORT_INTERACTION_RADIUS = 200;
      return distance <= PORT_INTERACTION_RADIUS;
    },
    
    calculateDistance: (x1, z1, x2, z2) => {
      // Map size constants
      const MAP_WIDTH = 5000;
      const MAP_HEIGHT = 5000;
      
      // Calculate wrapped distance along each axis
      const dx = Math.min(Math.abs(x1 - x2), MAP_WIDTH - Math.abs(x1 - x2));
      const dz = Math.min(Math.abs(z1 - z2), MAP_HEIGHT - Math.abs(z1 - z2));
      
      // Euclidean distance
      return Math.sqrt(dx * dx + dz * dz);
    }
  }))
);
