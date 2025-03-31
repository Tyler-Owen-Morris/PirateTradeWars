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
    
    loadPortGoods: async (portId) => {
      try {
        const response = await apiRequest('GET', `/api/ports/${portId}/goods`, undefined);
        const portGoods = await response.json();
        
        set({ currentPortGoods: portGoods });
      } catch (error) {
        console.error('Failed to load port goods:', error);
      }
    },
    
    setNearPort: (portId) => {
      set({ nearPortId: portId });
    },
    
    setIsTrading: (isTrading) => {
      set({ isTrading });
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
      return distance <= nearestPort.safeRadius;
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
