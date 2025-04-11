import { create } from "zustand";
import { useGameState } from "./useGameState";
import { PlayerState, SocketMessage, Vector3 } from "@/types";
import { useAudio } from "./useAudio";
import { gameState } from "server/game/gameState";

interface SocketState {
  socket: WebSocket | null;
  connected: boolean;
  playerId: string | null;
  playerName: string | null;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  resetError: () => void;

  register: (name: string, shipType: string) => void;
  sendInput: (speed: number, direction: Vector3, firing: boolean, rotationY?: number) => void;
  sendTrade: (portId: number, action: "buy" | "sell", goodId: number, quantity: number) => void;
  scuttleShip: () => void;

  onGameUpdate: (players: Record<string, PlayerState>, cannonBalls: any[]) => void;
}

export const useSocket = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,
  playerId: null,
  playerName: null,
  error: null,

  connect: () => {
    try {
      if (get().socket) {
        get().socket?.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/game-ws`;
      console.log("Connecting to WebSocket URL:", wsUrl);

      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("WebSocket connection established");
        set({ connected: true, error: null });

        const storedPlayerId = localStorage.getItem("playerId");
        const storedName = localStorage.getItem("playerName");

        if (storedPlayerId && storedName) {
          socket.send(JSON.stringify({ type: "reconnect", id: storedPlayerId, name: storedName }));
        } else {
          set({ error: "Please provide a name to join the game" });
        }
      };

      socket.onclose = () => {
        console.log("WebSocket connection closed");
        set({ connected: false });
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        set({ error: "Connection error. Please try again." });
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SocketMessage;

          switch (message.type) {
            case "welcome":
              console.log("Received welcome message:", message);
              break;

            case "connected":
              console.log("Successfully connected:", message);
              set({ playerId: message.playerId, playerName: message.name, error: null });
              localStorage.setItem("playerId", message.playerId);
              localStorage.setItem("playerName", message.name);
              useGameState.setState({ isRegistered: true });
              if (message.players) {
                get().onGameUpdate(message.players, message.cannonBalls || []);
              }
              break;

            case "reconnected":
              console.log("Successfully reconnected:", message);
              set({ playerId: message.playerId, playerName: message.name, error: null });
              useGameState.setState({ isPlaying: true });
              if (message.players) {
                get().onGameUpdate(message.players, message.cannonBalls || []);
              }
              break;

            case "fullSync":
              get().onGameUpdate(message.players, message.cannonBalls || []);
              break;

            case "registered":
              console.log("Successfully registered:", message);
              set({ playerId: message.playerId, error: null });
              useGameState.setState({ isRegistered: true });
              break;

            case "gameUpdate":
              get().onGameUpdate(message.players, message.cannonBalls);
              break;

            case "playerDead":
              console.log("Player dead:", message.id);
              useGameState.getState().updateOtherPlayers(message.players);
              break;

            case "nameError":
              console.error("Name error:", message.message);
              set({ error: message.message });
              localStorage.removeItem("playerName");
              break;

            case "error":
              console.error("Server error:", message.message);
              if (message.message === "Player ID not found") {
                // Clear invalid player data and reset
                localStorage.removeItem("playerId");
                localStorage.removeItem("playerName");
                set({ playerId: null, playerName: null, error: "Invalid player ID. Please provide a new name to join." });
                useGameState.getState().restartGame(); // Reset game state
              } else {
                set({ error: message.message });
              }
              break;

            case "tradeSuccess":
              useAudio.getState().playPlayerHit();
              if (message.gold !== undefined) {
                const gameState = useGameState.getState();
                if (gameState.gameState.player) {
                  gameState.gameState.player.gold = message.gold;
                  // useGameState.getState().loadPlayerInventory(gameState.gameState.player.id)
                }
              }
              console.log("trade success message", message)
              if (message.inventory && Array.isArray(message.inventory)) {
                useGameState.getState().updatePlayerInventory(message.inventory);
              } else {
                console.warn("websocket back to client did not catch inventory")
              }
              break;

            case "gameEnd":
              console.log("Game ended:", message);
              if (message.leaderboard && Array.isArray(message.leaderboard)) {
                useGameState.setState((state) => ({
                  gameState: { ...state.gameState, leaderboard: message.leaderboard },
                }));
              }
              useGameState.setState({ isSunk: true });
              useAudio.getState().playPlayerSinks();
              break;

            default:
              console.log("Unknown message type:", message);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      set({ socket });
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      set({ error: "Failed to establish connection. Please refresh and try again." });
    }
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, connected: false });
    }
  },

  resetError: () => {
    set({ error: null });
  },

  register: (name, shipType) => {
    const { socket, connected } = get();
    if (!socket || !connected) {
      set({ error: "Not connected. Please refresh and try again." });
      return;
    }

    const storedPlayerId = localStorage.getItem("playerId");
    if (storedPlayerId) {
      socket.send(JSON.stringify({ type: "reconnect", id: storedPlayerId, name }));
    } else {
      socket.send(JSON.stringify({ type: "connect", name, shipType }));
    }
  },

  sendInput: (speed, direction, firing, rotationY) => {
    const { socket, connected } = get();
    if (!socket || !connected) return;

    const message = { type: "input", rotationY, speed, direction, firing };
    socket.send(JSON.stringify(message));
  },

  sendTrade: (portId, action, goodId, quantity) => {
    const { socket, connected } = get();
    if (!socket || !connected) {
      set({ error: "Not connected. Please refresh and try again." });
      return;
    }

    const message = { type: "trade", portId, action, goodId, quantity };
    socket.send(JSON.stringify(message));
  },

  scuttleShip: () => {
    const { socket, connected } = get();
    if (!socket || !connected) {
      set({ error: "Not connected. Please refresh and try again." });
      return;
    }

    const message = { type: "scuttle" };
    socket.send(JSON.stringify(message));
  },

  onGameUpdate: (players, cannonBalls) => {
    useGameState.getState().updateOtherPlayers(players);
    useGameState.getState().updateCannonBalls(cannonBalls);

    const playerId = get().playerId;
    if (playerId && players[playerId]) {
      const player = players[playerId];
      const gameState = useGameState.getState();
      if (gameState.gameState.player && player.hp < gameState.gameState.player.hp) {
        useAudio.getState().playPlayerGetsHit();
      }
      gameState.updatePlayer(player);
    }
  },
}));