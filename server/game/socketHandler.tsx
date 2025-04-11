import { redisStorage } from "../redisStorage";
import { gameState } from "./gameState";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { Or } from "drizzle-orm";
import { PlayerState } from "../types";

interface ConnectMessage {
  type: "connect";
  name: string;
  shipType: string;
}

interface ReconnectMessage {
  type: "reconnect";
  id: string;
  name: string;
}

interface InputMessage {
  type: "input";
  rotationY?: number;
  speed?: number;
  direction?: { x: number; y: number; z: number };
  firing?: boolean;
}

interface TradeMessage {
  type: "trade";
  portId: number;
  action: "buy" | "sell";
  goodId: number;
  quantity: number;
}

interface ScuttleMessage {
  type: "scuttle";
}

type ClientMessage = ConnectMessage | ReconnectMessage | InputMessage | TradeMessage | ScuttleMessage;

export function handleSocketConnection(ws: WebSocket) {
  let playerId: string | null = null;

  ws.on("message", async (message) => {
    try {
      const data: ClientMessage = JSON.parse(message.toString());

      switch (data.type) {
        case "connect":
          await handleConnect(ws, data);
          break;
        case "reconnect":
          await handleReconnect(ws, data);
          break;
        case "input":
          if (playerId) handleInput(playerId, data);
          break;
        case "trade":
          if (playerId) await handleTrade(playerId, data);
          break;
        case "scuttle":
          if (playerId) await handleScuttle(playerId, ws);
          break;
        default:
          sendError(ws, "Unknown message type");
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      sendError(ws, "Invalid message format");
    }
  });

  ws.on("close", () => {
    if (playerId) {
      gameState.removeClient(playerId);
      console.log(`Player ${playerId} disconnected`);
    }
  });

  ws.send(JSON.stringify({ type: "welcome", message: "Welcome to Pirate Trade Wars!", timestamp: Date.now() }));

  async function handleConnect(ws: WebSocket, data: ConnectMessage) {
    if (!data.name || data.name.trim().length < 3) {
      return sendError(ws, "Name must be at least 3 characters");
    }
    if (await redisStorage.getActiveNames().then(names => names.has(data.name))) {
      return sendError(ws, "Name already in use by an active player", "nameError");
    }
    const shipType = await redisStorage.getShipType(data.shipType);
    if (!shipType) {
      return sendError(ws, "Invalid ship type");
    }

    const player = await redisStorage.createPlayer({
      userId: null,
      name: data.name,
      shipType: data.shipType,
      gold: 1000,
      lastSeen: new Date(),
      isActive: true
    });

    const addedPlayer = gameState.addPlayer(player.id, player.id, player.name, player.shipType, shipType);
    if (!addedPlayer) {
      return sendError(ws, "Failed to add player due to name conflict");
    }

    gameState.registerClient(player.id, ws as any);
    await redisStorage.addActiveName(data.name);

    ws.send(JSON.stringify({
      type: "connected",
      playerId: player.id,
      name: data.name,
      ship: shipType,
      gold: player.gold,
      players: gameState.state.players,
      cannonBalls: gameState.state.cannonBalls,
      timestamp: Date.now(),
    }));
    console.log(`Player ${player.name} connected with ID ${player.id}`);
  }

  async function handleReconnect(ws: WebSocket, data: ReconnectMessage) {
    const existingPlayer = gameState.state.players[data.id];
    if (!existingPlayer) {
      return sendError(ws, "Player ID not found");
    }
    if (data.name !== existingPlayer.name && await redisStorage.getActiveNames().then(names => names.has(data.name))) {
      return sendError(ws, "Name already in use by an active player", "nameError");
    }

    playerId = data.id;
    if (data.name !== existingPlayer.name) {
      await redisStorage.removeActiveName(existingPlayer.name);
      existingPlayer.name = data.name;
      await redisStorage.addActiveName(data.name);
    }
    existingPlayer.connected = true;
    existingPlayer.lastSeen = Date.now();
    gameState.registerClient(playerId, ws as any);

    ws.send(JSON.stringify({
      type: "reconnected",
      playerId,
      name: existingPlayer.name,
      ship: await redisStorage.getShipType(existingPlayer.shipType),
      gold: existingPlayer.gold,
      players: gameState.state.players,
      cannonBalls: gameState.state.cannonBalls,
      timestamp: Date.now(),
    }));
    console.log(`Player ${existingPlayer.name} reconnected with ID ${playerId}`);
  }

  function handleInput(playerId: string, data: InputMessage) {
    const updateData: Partial<PlayerState> = {
      ...(data.rotationY !== undefined && { rotationY: data.rotationY }),
      ...(data.speed !== undefined && { speed: data.speed }),
      ...(data.direction && { direction: data.direction }),
      ...(data.firing !== undefined && { firing: data.firing })
    };
    gameState.updatePlayer(playerId, updateData);
    if (data.firing) gameState.fireCannonBall(playerId);
  }

  async function handleTrade(playerId: string, data: TradeMessage) {
    console.log("socket starting trade.")
    const player = gameState.state.players[playerId];
    if (!player || player.dead) return;

    const port = await redisStorage.getPort(data.portId);
    if (!port) return sendError(ws, "Port not found");

    const dx = Math.min(Math.abs(player.x - port.x), 5000 - Math.abs(player.x - port.x));
    const dz = Math.min(Math.abs(player.z - port.z), 5000 - Math.abs(player.z - port.z));
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > port.safeRadius) return sendError(ws, "Too far from port");

    const portGoods = await redisStorage.getPortGoods(port.id);
    // console.log(port.id, "data request for trade", data)
    // console.log("port goods for trade:", portGoods)
    const portGood = portGoods.find((pg) => pg.goodId === data.goodId);
    if (!portGood) return sendError(ws, "Good not available at this port");

    //console.log("socket handler:handle trade -- player:", player)
    const inventory = await redisStorage.getPlayerInventory(player.playerId);
    const inventoryItem = inventory.find((item) => item.goodId === data.goodId);
    const currentQuantity = inventoryItem ? inventoryItem.quantity : 0;

    if (data.action === "buy") {
      if (portGood.stock < data.quantity) return sendError(ws, "Not enough stock available");
      const totalCost = portGood.currentPrice * data.quantity;
      if (player.gold < totalCost) return sendError(ws, "Not enough gold");
      if (player.cargoUsed + data.quantity > player.cargoCapacity) return sendError(ws, "Not enough cargo space");

      player.gold -= totalCost;
      player.cargoUsed += data.quantity;
      await redisStorage.updatePlayerInventory(player.playerId, data.goodId, currentQuantity + data.quantity);
      const updatedInventory = await redisStorage.getPlayerInventory(player.playerId);

      ws.send(JSON.stringify({
        type: "tradeSuccess",
        action: "buy",
        good: portGood.goodId,
        quantity: data.quantity,
        price: portGood.currentPrice,
        totalCost,
        gold: player.gold,
        inventory: updatedInventory,
        timestamp: Date.now(),
      }));
    } else if (data.action === "sell") {
      if (currentQuantity < data.quantity) return sendError(ws, "Not enough goods to sell");
      const totalEarnings = portGood.currentPrice * data.quantity;

      player.gold += totalEarnings;
      player.cargoUsed -= data.quantity;
      //console.log("sell trade taking place", player)
      await redisStorage.updatePlayerInventory(player.playerId, data.goodId, currentQuantity - data.quantity);
      const updatedInventory = await redisStorage.getPlayerInventory(player.playerId);

      ws.send(JSON.stringify({
        type: "tradeSuccess",
        action: "sell",
        good: portGood.goodId,
        quantity: data.quantity,
        price: portGood.currentPrice,
        totalEarnings,
        gold: player.gold,
        inventory: updatedInventory,
        timestamp: Date.now(),
      }));
    }
    await redisStorage.updatePlayerGold(player.playerId, player.gold);
  }

  async function handleScuttle(playerId: string, ws: WebSocket) {
    const player = gameState.state.players[playerId];
    if (!player) return sendError(ws, "Player not found");

    console.log(`Player ${player.name} scuttled their ship with score ${player.gold}`);
    const leaderboardEntry = await redisStorage.addToLeaderboard({
      playerId: player.playerId,
      playerName: player.name,
      score: player.gold,
      achievedAt: new Date()
    });
    const leaderboard = await redisStorage.getLeaderboard(10);
    await gameState.updateLeaderboard(leaderboard);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "gameEnd",
        reason: "scuttle",
        score: player.gold,
        message: "You scuttled your ship and joined the leaderboard!",
        leaderboard,
        timestamp: Date.now(),
      }));

      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 1000);
    }

    await redisStorage.removeActiveName(player.name);
    delete gameState.state.players[playerId];
    gameState.removeClient(playerId);
    await redisStorage.setPlayerActive(player.playerId, false);
  }
}

function sendError(ws: WebSocket, message: string, type: string = "error") {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, message, timestamp: Date.now() }));
  }
}