/**
 * useSocket: React/zustand façade over the framework-free netcode layer (`@/lib/net`).
 *
 * - Transport, prediction, interpolation and cannonballs live in `net` (see lib/net/netClient.ts).
 *   3D components read from `net` inside useFrame; nothing here runs per frame.
 * - This store exposes connection status / player id / errors and the UI actions (register, trade,
 *   upgrade, repair, scuttle).
 * - It bridges net events into useGameState for the HUD/Minimap/TradeMenu/GameOver UI:
 *   `me` → gameState.player at ~5 Hz (immediately when hp/gold/sunk/shipType/cargo change), other
 *   ships → gameState.otherPlayers at ~5 Hz, gold rows → gameState.goldObjects when they change.
 * - Never import from `server/` here (it would bundle server code into the client).
 */
import { create } from "zustand";
import { useGameState } from "./useGameState";
import { useAudio } from "./useAudio";
import type { PlayerState, RemoteShipSummary, GoldObject } from "@/types";
import { net } from "@/lib/net";
import { SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";
import { FLAG_SUNK, type GoldRow, type SelfState } from "@shared/protocol";

/** UI mirror refresh period (ms) for position-ish fields of the own ship and the minimap. */
export const UI_SYNC_INTERVAL_MS = 200;

interface SocketState {
  connected: boolean;
  playerId: string | null;
  playerName: string | null;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  resetError: () => void;

  register: (name: string, shipType: string, tempPlayerId?: string) => void;
  sendTrade: (portId: number, action: "buy" | "sell", goodId: number, quantity: number) => void;
  sendUpgradeShip: (portId: number) => void;
  sendRepairShip: (portId: number) => void;
  scuttleShip: () => void;
}

// ---------------------------------------------------------------------------------------------
// net → useGameState bridge
// ---------------------------------------------------------------------------------------------

let wired = false;
let lastUiSync = 0;
/** Set after `gameEnd` so later snapshots don't overwrite the final score shown by GameOver. */
let gameEnded = false;

function buildPlayer(me: SelfState): PlayerState {
  const { playerId, playerName } = useSocket.getState();
  const stats = SHIP_STATS[me.shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
  const r = net.getOwnRenderState();
  return {
    id: playerId ?? "",
    name: playerName ?? "",
    x: r.x,
    y: 0,
    z: r.z,
    rotationY: r.rotationY,
    speed: r.velocity,
    maxSpeed: stats.speed,
    shipType: me.shipType,
    hp: me.hp,
    maxHp: me.maxHp,
    gold: me.gold,
    cargoUsed: me.cargoUsed,
    cargoCapacity: me.cargoCapacity,
    canFire: me.canFire,
    reloadMs: me.reloadMs,
    // Broadsides: per-side gauges (an older server without them → both follow the single gauge).
    reloadPortMs: me.reloadPortMs ?? me.reloadMs,
    reloadStarboardMs: me.reloadStarboardMs ?? me.reloadMs,
    reloadTime: stats.cannonReload * 1000,
    sunk: me.sunk,
    eid: me.eid,
  };
}

function otherShipsSummary(): Record<string, RemoteShipSummary> {
  const out: Record<string, RemoteShipSummary> = {};
  for (const e of net.remote.renderable()) {
    const s = e.buffer.latest;
    if (!s || !e.meta) continue;
    out[e.meta.id] = {
      id: e.meta.id,
      eid: e.eid,
      name: e.meta.name,
      shipType: e.meta.shipType,
      x: s.x,
      z: s.z,
      rotationY: s.r,
      hp: e.hp,
      maxHp: e.meta.maxHp,
      sunk: (e.flags & FLAG_SUNK) !== 0,
    };
  }
  return out;
}

/** Push `me` into useGameState; `force` skips the 5 Hz throttle. */
function syncSelf(me: SelfState, force: boolean): void {
  if (gameEnded) return;
  const now = net.now();
  const prev = useGameState.getState().gameState.player;
  const important =
    !prev ||
    prev.hp !== me.hp ||
    prev.gold !== me.gold ||
    prev.sunk !== me.sunk ||
    prev.shipType !== me.shipType ||
    prev.cargoUsed !== me.cargoUsed ||
    prev.canFire !== me.canFire ||
    (prev.reloadPortMs === 0) !== ((me.reloadPortMs ?? me.reloadMs) === 0) ||
    (prev.reloadStarboardMs === 0) !== ((me.reloadStarboardMs ?? me.reloadMs) === 0);
  if (!force && !important && now - lastUiSync < UI_SYNC_INTERVAL_MS) return;
  const periodic = now - lastUiSync >= UI_SYNC_INTERVAL_MS;
  lastUiSync = now;
  useGameState.getState().updatePlayer(buildPlayer(me));
  if (periodic || force) useGameState.getState().updateOtherPlayers(otherShipsSummary());
}

function goldRowsToObjects(rows: GoldRow[]): GoldObject[] {
  return rows.map(([id, x, z, gold]) => ({ id, x, y: 0, z, gold }));
}

function sameGold(a: GoldObject[], rows: GoldRow[]): boolean {
  if (a.length !== rows.length) return false;
  for (let i = 0; i < rows.length; i++) {
    const g = a[i];
    const r = rows[i];
    if (g.id !== r[0] || g.x !== r[1] || g.z !== r[2] || g.gold !== r[3]) return false;
  }
  return true;
}

function wireNet(): void {
  if (wired) return;
  wired = true;

  net.on("open", () => {
    console.log("WebSocket connection established");
    useSocket.setState({ connected: true, error: null });
    const storedPlayerId = localStorage.getItem("playerId");
    const storedName = localStorage.getItem("playerName");
    if (storedPlayerId && storedName) {
      net.send({ type: "reconnect", id: storedPlayerId, name: storedName });
    }
  });

  net.on("close", (willReconnect) => {
    console.log(`WebSocket connection closed${willReconnect ? " — reconnecting" : ""}`);
    useSocket.setState({ connected: false });
  });

  net.on("error", (err) => {
    console.error("WebSocket error:", err);
    useSocket.setState({ error: "Connection error. Please try again." });
  });

  net.on("spawned", (me) => syncSelf(me, true));
  net.on("self", (me) => syncSelf(me, false));

  net.on("hit", (_m, isMe) => {
    if (isMe) {
      useAudio.getState().playPlayerGetsHit();
      if (net.me) syncSelf(net.me, true);
    }
  });

  net.on("sunk", (_m, isMe) => {
    if (isMe && net.me) syncSelf(net.me, true);
  });

  net.on("goldCollected", () => {
    useAudio.getState().playPlayerHit();
    if (net.me) syncSelf(net.me, true);
  });

  // Broadsides: a ship firing both batteries sends two `fire` events in one tick; play one bang.
  let lastBang = "";
  net.on("fire", (m) => {
    const key = `${m.eid}:${m.k}`;
    if (key === lastBang) return;
    lastBang = key;
    useAudio.getState().playCannonFire();
  });

  net.on("gold", (rows) => {
    const current = useGameState.getState().gameState.goldObjects ?? [];
    if (!sameGold(current, rows)) useGameState.getState().updateGoldObjects(goldRowsToObjects(rows));
  });

  net.on("legacy", (message) => handleLegacyMessage(message));
}

/** Legacy `type` messages (PROTOCOL §3) — world dumps are gone; the first snapshot spawns us. */
function handleLegacyMessage(message: any): void {
  switch (message.type) {
    case "welcome":
      console.log("Received welcome message:", message.message);
      break;

    case "connected":
      console.log("Successfully connected:", message.playerId);
      gameEnded = false;
      net.resetSession();
      useSocket.setState({ playerId: message.playerId, playerName: message.name, error: null });
      localStorage.setItem("playerId", message.playerId);
      localStorage.setItem("playerName", message.name);
      // Store the final player ID in localStorage to replace tempPlayerId
      localStorage.setItem("finalPlayerId", message.playerId);
      useGameState.setState({ isRegistered: true });
      break;

    case "reconnected":
      console.log("Successfully reconnected:", message.playerId);
      gameEnded = false;
      net.resetSession();
      useSocket.setState({ playerId: message.playerId, playerName: message.name, error: null });
      useGameState.setState({ isPlaying: true });
      break;

    case "nameError":
      console.error("Name error:", message.message);
      useSocket.setState({ error: message.message });
      localStorage.removeItem("playerName");
      break;

    case "error":
      console.error("Server error:", message.message);
      if (message.message === "Player ID not found") {
        localStorage.removeItem("playerId");
        localStorage.removeItem("playerName");
        useSocket.setState({
          playerId: null,
          playerName: null,
          error: "Invalid player ID. Please provide a new name to join.",
        });
        useGameState.getState().restartGame();
      } else {
        useSocket.setState({ error: message.message });
      }
      break;

    case "tradeSuccess": {
      useAudio.getState().playPlayerHit();
      const player = useGameState.getState().gameState.player;
      if (player && typeof message.gold === "number") {
        useGameState.getState().updatePlayer({ ...player, gold: message.gold });
      }
      if (Array.isArray(message.inventory)) {
        useGameState.getState().updatePlayerInventory(message.inventory);
      } else {
        console.warn("tradeSuccess without inventory");
      }
      break;
    }

    case "upgradeSuccess":
      // The next snapshot carries the new shipType / maxHp / cargo; prediction picks up new stats.
      console.log("Ship upgraded successfully to", message?.newShipType);
      if (net.me) syncSelf(net.me, true);
      break;

    case "repairSuccess": {
      const player = useGameState.getState().gameState.player;
      if (player && typeof message.gold === "number" && typeof message.hp === "number") {
        useGameState.getState().updatePlayer({ ...player, gold: message.gold, hp: message.hp });
      }
      break;
    }

    case "gameEnd":
      console.log("Game ended:", message);
      gameEnded = true;
      if (Array.isArray(message.leaderboard)) {
        useGameState.setState((state) => ({
          gameState: { ...state.gameState, leaderboard: message.leaderboard },
        }));
      }
      useGameState.setState((state) => ({
        isSunk: true,
        gameState: {
          ...state.gameState,
          player: state.gameState.player ? { ...state.gameState.player, gold: message.score } : null,
        },
      }));
      useAudio.getState().playPlayerSinks();
      break;

    default:
      console.log("Unknown message type:", message);
  }
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

function notConnectedError() {
  useSocket.setState({ error: "Not connected. Please refresh and try again." });
}

export const useSocket = create<SocketState>((set, get) => ({
  connected: false,
  playerId: null,
  playerName: null,
  error: null,

  connect: () => {
    wireNet();
    net.connect();
  },

  disconnect: () => {
    net.disconnect();
    set({ connected: false });
  },

  resetError: () => {
    set({ error: null });
  },

  register: (name, shipType, tempPlayerId?: string) => {
    if (!get().connected || !net.conn.isOpen) {
      notConnectedError();
      return;
    }
    const storedPlayerId = localStorage.getItem("playerId");
    if (storedPlayerId) {
      net.send({ type: "reconnect", id: storedPlayerId, name, tempPlayerId });
    } else {
      net.send({ type: "connect", name, shipType, tempPlayerId });
    }
  },

  sendTrade: (portId, action, goodId, quantity) => {
    if (!net.send({ type: "trade", portId, action, goodId, quantity })) notConnectedError();
  },

  sendUpgradeShip: (portId: number) => {
    if (!net.send({ type: "upgradeShip", portId })) notConnectedError();
  },

  sendRepairShip: (portId: number) => {
    if (!net.send({ type: "repairShip", portId })) notConnectedError();
  },

  scuttleShip: () => {
    if (!net.send({ type: "scuttle" })) notConnectedError();
  },
}));
