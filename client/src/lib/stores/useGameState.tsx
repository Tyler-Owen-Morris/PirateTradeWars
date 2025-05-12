import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { apiRequest } from "../queryClient";
import { MAP_HEIGHT, MAP_WIDTH } from "../constants";
import { GameState, Port, Good, PortGood, LeaderboardEntry, InventoryItem, PlayerState } from "@/types";

interface GameStateStore {
  gameState: GameState;
  isRegistered: boolean;
  isPlaying: boolean;
  isSunk: boolean;
  isTrading: boolean;
  isNearPort: boolean;
  nearPortId: number | null;
  currentPortGoods: PortGood[];
  goldDrops: Array<{ id: string; position: [number, number, number]; value: number }>;

  registerPlayer: (name: string) => void;
  selectShip: (shipType: string) => void;
  startGame: () => void;
  restartGame: () => void;

  updatePlayer: (player: PlayerState) => void;
  updateOtherPlayers: (players: Record<string, PlayerState>) => void;
  updateCannonBalls: (cannonBalls: any[]) => void;
  updateGoldObjects: (goldObjects: any[]) => void;
  updatePlayerInventory: (inventory: InventoryItem[]) => void;

  loadPorts: () => Promise<void>;
  loadGoods: () => Promise<void>;
  loadPortGoods: (portId: number) => Promise<void>;
  loadPlayerInventory: (playerId: string) => Promise<void>;
  setNearPort: (portId: number | null) => void;
  setIsTrading: (isTrading: boolean) => void;

  loadLeaderboard: () => Promise<void>;

  getNearestPort: () => Port | null;
  isPlayerNearPort: () => boolean;
  calculateDistance: (x1: number, z1: number, x2: number, z2: number) => number;

  addGoldDrop: (position: [number, number, number], value: number) => void;
  removeGoldDrop: (id: string) => void;
  addGold: (amount: number) => void;
}

export const useGameState = create<GameStateStore>()(
  subscribeWithSelector((set, get) => ({
    gameState: {
      player: null,
      otherPlayers: {},
      cannonBalls: [],
      goldObjects: [],
      ports: [],
      goods: [],
      inventory: [],
      nearestPort: null,
      isNearPort: false,
      leaderboard: [],
    },
    isRegistered: false,
    isPlaying: false,
    isSunk: false,
    isTrading: false,
    isNearPort: false,
    nearPortId: null,
    currentPortGoods: [],
    goldDrops: [],

    registerPlayer: (name: string) => {
      set({ isRegistered: true });
    },

    selectShip: (shipType: string) => {
      set({ isPlaying: true });
    },

    startGame: () => {
      // this somehow prevents a websocket disconnect error - do not remove it
      // setTimeout(() => {
      //   window.location.reload();
      // }, 100)
      set({ isPlaying: true });
    },

    restartGame: () => {
      console.log("restart game called")
      if (window.stripe) {
        window.stripe._elements = null;
      }
      set({
        isRegistered: false,
        isPlaying: false,
        isSunk: false,
        isTrading: false,
        isNearPort: false,
        nearPortId: null,
        currentPortGoods: [],
        gameState: {
          player: null,
          otherPlayers: {},
          cannonBalls: [],
          goldObjects: [],
          ports: get().gameState.ports, // Preserve ports
          goods: get().gameState.goods, // Preserve goods
          inventory: [],
          nearestPort: null,
          isNearPort: false,
          leaderboard: get().gameState.leaderboard, // Preserve leaderboard
        },
      });
      localStorage.removeItem("playerId");
      localStorage.removeItem("playerName");
      //localStorage.removeItem("finalPlayerId");

      // Force a new Stripe instance to be created on next payment
      const stripeScript = document.querySelector('script[src*="stripe"]');
      if (stripeScript) {
        stripeScript.remove();
      }
      setTimeout(() => {
        window.location.reload();
      }, 100)
    },

    updatePlayer: (player: PlayerState) => {
      set((state) => {
        const oldPlayer = state.gameState.player;
        const newState: Partial<GameStateStore> = {
          gameState: { ...state.gameState, player },
          isSunk: player.sunk,
        };

        // If player just died from cannon fire (not scuttle), create a gold drop
        if (oldPlayer && !oldPlayer.sunk && player.sunk && !player.scuttled) {
          const goldValue = Math.floor(oldPlayer.gold * 0.5); // Drop 50% of gold
          if (goldValue > 0) {
            const goldDrop = {
              id: `gold-${Date.now()}-${Math.random()}`,
              position: [oldPlayer.x, oldPlayer.y, oldPlayer.z] as [number, number, number],
              value: goldValue
            };
            newState.goldDrops = [...state.goldDrops, goldDrop];
          }
        }

        return newState as GameStateStore;
      });
    },

    updateOtherPlayers: (players: Record<string, PlayerState>) => {
      const currentPlayerId = get().gameState.player?.id;
      if (!currentPlayerId) return;

      const currentPlayer = players[currentPlayerId];
      const otherPlayers: Record<string, PlayerState> = {};

      Object.entries(players).forEach(([id, player]) => {
        if (id !== currentPlayerId && !player.sunk) {
          otherPlayers[id] = player;
        }
      });

      set((state) => ({
        gameState: {
          ...state.gameState,
          player: currentPlayer || state.gameState.player,
          otherPlayers,
        },
      }));
    },

    updateCannonBalls: (cannonBalls) => {
      set((state) => ({
        gameState: { ...state.gameState, cannonBalls },
      }));
    },

    updateGoldObjects: (goldObjects) => {
      set((state) => ({
        gameState: { ...state.gameState, goldObjects },
      }));
    },

    updatePlayerInventory: (inventory) => {
      set((state) => ({
        gameState: { ...state.gameState, inventory },
      }));
      console.log("inventory to update player with", inventory)
      console.log("player id", get().gameState.player?.id)
      // Also update the server with the new inventory
      const playerId = get().gameState.player?.id;
      if (playerId) {
        apiRequest("PUT", `/api/players/${playerId}/inventory`, inventory).catch((error) => {
          console.error("Failed to update inventory on server:", error);
        });
      }
    },

    loadPorts: async () => {
      try {
        const response = await apiRequest("GET", "/api/ports", undefined);
        const ports = await response.json();
        set((state) => ({
          gameState: { ...state.gameState, ports },
        }));

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
        console.error("Failed to load ports:", error);
      }
    },

    loadGoods: async () => {
      try {
        const response = await apiRequest("GET", "/api/goods", undefined);
        const goods = await response.json();
        set((state) => ({
          gameState: { ...state.gameState, goods },
        }));
      } catch (error) {
        console.error("Failed to load goods:", error);
      }
    },

    loadPortGoods: async (portId: number) => {
      try {
        const response = await apiRequest("GET", `/api/ports/${portId}/goods`, undefined);
        const portGoods = await response.json();
        set({ currentPortGoods: portGoods });
      } catch (error) {
        console.error("Failed to load port goods:", error);
      }
    },

    loadPlayerInventory: async (playerId: string) => {
      try {
        const response = await fetch(`/api/players/${playerId}/inventory`);
        if (!response.ok) {
          throw new Error('Failed to load inventory');
        }
        const data = await response.json();
        set((state) => ({
          gameState: { ...state.gameState, inventory: data }
        }));
      } catch (error) {
        console.error('Error loading inventory:', error);
      }
    },

    setNearPort: (portId: number | null) => {
      if (portId === null) {
        console.log("Clearing nearest port");
        set({
          nearPortId: null,
          gameState: { ...get().gameState, nearestPort: null, isNearPort: false },
        });
        return;
      }

      const ports = get().gameState.ports;
      const nearestPort = ports.find((p) => p.id === portId) || null;
      console.log(`Setting near port: ${nearestPort?.name} (ID: ${portId})`);
      set({
        nearPortId: portId,
        gameState: { ...get().gameState, nearestPort, isNearPort: true },
      });
      get().loadPortGoods(portId);
    },

    setIsTrading: (isTrading) => {
      set({ isTrading });
      if (isTrading && get().nearPortId !== null) {
        const portId = get().nearPortId;
        if (portId !== null) {
          get().loadPortGoods(portId);
        }
      }
    },

    loadLeaderboard: async () => {
      try {
        const response = await apiRequest("GET", "/api/leaderboard", undefined);
        const leaderboard = await response.json();
        set((state) => ({
          gameState: { ...state.gameState, leaderboard },
        }));
      } catch (error) {
        console.error("Failed to load leaderboard:", error);
      }
    },

    getNearestPort: () => {
      const { ports } = get().gameState;
      const player = get().gameState.player;
      if (!player || ports.length === 0) return null;

      let nearestPort = null;
      let minDistance = Infinity;

      ports.forEach((port) => {
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
      const PORT_INTERACTION_RADIUS = 200;
      return distance <= PORT_INTERACTION_RADIUS;
    },

    calculateDistance: (x1, z1, x2, z2) => {
      const MAP_WIDTH = 5000;
      const MAP_HEIGHT = 5000;
      const dx = Math.min(Math.abs(x1 - x2), MAP_WIDTH - Math.abs(x1 - x2));
      const dz = Math.min(Math.abs(z1 - z2), MAP_HEIGHT - Math.abs(z1 - z2));
      return Math.sqrt(dx * dx + dz * dz);
    },

    addGoldDrop: (position: [number, number, number], value: number) => {
      set((state) => ({
        goldDrops: [...state.goldDrops, {
          id: `gold-${Date.now()}-${Math.random()}`,
          position,
          value
        }]
      }));
    },

    removeGoldDrop: (id: string) => {
      set((state) => ({
        goldDrops: state.goldDrops.filter(drop => drop.id !== id)
      }));
    },

    addGold: (amount: number) => {
      set((state) => {
        if (!state.gameState.player) return state;
        return {
          gameState: {
            ...state.gameState,
            player: {
              ...state.gameState.player,
              gold: state.gameState.player.gold + amount
            }
          }
        };
      });
    },
  }))
);