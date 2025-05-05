import { redisStorage } from "../redisStorage";
import { gameState } from "./gameState";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { Or } from "drizzle-orm";
import { PlayerState } from "../game/gameState";

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
      console.log(`Total players connected: ${Object.keys(gameState.state.players).length}`);
    }
  });

  ws.send(JSON.stringify({ type: "welcome", message: "Welcome to Pirate Trade Wars!", timestamp: Date.now() }));

  async function handleConnect(ws: WebSocket, data: ConnectMessage) {
    console.log("connection attempt")
    if (!data.name || data.name.trim().length < 3) {
      return sendError(ws, "Name must be at least 3 characters");
    }
    if (await redisStorage.isNameActive(data.name)) {
      return sendError(ws, "Name already in use by an active player", "nameError");
    }
    const shipType = await redisStorage.getShipType(data.shipType);
    if (!shipType) {
      return sendError(ws, "Invalid ship type");
    }
    //console.log("ship type:", shipType)

    const addedPlayer = await gameState.addPlayer(data.name, data.shipType, shipType);
    // TODO : THESE redis updates should be in the gameState.tsx file, and not here.
    if (!addedPlayer) {
      return sendError(ws, "Failed to add player due to name conflict");
    } else {
      //console.log("adding player to redis:", addedPlayer)
      await redisStorage.createPlayer(addedPlayer)
      await redisStorage.addActiveName(addedPlayer.name, addedPlayer.id);
    }

    gameState.registerClient(addedPlayer.id, ws as any);


    console.log(`Total players connected: ${Object.keys(gameState.state.players).length}`);

    ws.send(JSON.stringify({
      type: "connected",
      playerId: addedPlayer.id,
      name: data.name,
      ship: shipType,
      gold: addedPlayer.gold,
      players: gameState.state.players,
      cannonBalls: gameState.state.cannonBalls,
      timestamp: Date.now(),
    }));
    console.log(`Player ${addedPlayer.name} connected with ID ${addedPlayer.id}`);
  }

  async function handleReconnect(ws: WebSocket, data: ReconnectMessage) {
    let existingPlayer = gameState.state.players[data.id];
    //console.log("looking for reconnecting to player:", data)
    // console.log("existing players:", gameState.state.players)
    if (!existingPlayer) {
      existingPlayer = await redisStorage.getPlayer(data.id);
      //console.log("existing player from redis:", existingPlayer)
      if (!existingPlayer) {
        return sendError(ws, "Player ID not found");
      } else {
        // Don't forget to put the player object into the game state
        existingPlayer = existingPlayer as PlayerState;
        gameState.state.players[data.id] = existingPlayer;
      }
    }
    //console.log("existing player:", existingPlayer)
    if (data.name !== existingPlayer.name && await redisStorage.isNameActive(data.name)) {
      return sendError(ws, "Name already in use by an active player", "nameError");
    }

    playerId = data.id;
    console.log("reconnecting player:", existingPlayer.name, data.name)

    await redisStorage.addActiveName(data.name, playerId);
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
    //console.log("handling input:", playerId, data)
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

    // const dx = Math.min(Math.abs(player.x - port.x), 5000 - Math.abs(player.x - port.x));
    // const dz = Math.min(Math.abs(player.z - port.z), 5000 - Math.abs(player.z - port.z));
    // const distance = Math.sqrt(dx * dx + dz * dz);
    // if (distance > port.safeRadius) return sendError(ws, "Too far from port");

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
      await redisStorage.updatePlayerGold(player.playerId, player.gold)
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
      await redisStorage.updatePlayerGold(player.playerId, player.gold)
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
    // await redisStorage.updatePlayerGold(player.playerId, player.gold);
  }

  async function handleScuttle(playerId: string, ws: WebSocket) {
    const player = gameState.state.players[playerId];
    if (!player) return sendError(ws, "Player not found");
    let post_scuttle_gold = player.gold - 500;
    console.log(`Player ${player.name} scuttled their ship with score ${post_scuttle_gold}`);
    const leaderboardEntry = await redisStorage.addToLeaderboard({
      playerId: player.playerId,
      playerName: player.name,
      score: post_scuttle_gold,
      achievedAt: new Date()
    });
    // TODO: Fetch the leaderboard ranks NEAR the player's rank.
    const leaderboard = await redisStorage.getLeaderboard(10);
    await gameState.updateLeaderboard(leaderboard);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "gameEnd",
        reason: "scuttle",
        score: post_scuttle_gold,
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


    gameState.removeClient(playerId);
    await redisStorage.setPlayerActive(player.playerId, false);
    await redisStorage.removePlayer(player.playerId);
    setTimeout(() => {
      delete gameState.state.players[playerId];
    }, 5000);
  }
}

function sendError(ws: WebSocket, message: string, type: string = "error") {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, message, timestamp: Date.now() }));
  }
}