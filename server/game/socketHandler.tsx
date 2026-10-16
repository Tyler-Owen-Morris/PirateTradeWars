/**
 * Per-socket message handling for `/game-ws` (docs/netcode/PROTOCOL.md §3–§4).
 *
 * Every frame is validated with `parseClientMessage`; invalid frames are dropped silently (no
 * per-frame error replies). Hot-path messages are synchronous: `input` goes straight into the
 * world's per-player input queue (consumed by the 20 Hz tick) and `ping` is answered with `pong`.
 * The legacy flows (connect / reconnect / trade / upgradeShip / repairShip / scuttle) stay async
 * (Redis) but run outside the tick and operate on the live world player objects.
 */
import { redisStorage } from "../redisStorage";
import { gameState, type WorldPlayer } from "./gameState";
import { WebSocket } from "ws";
import { SHIP_UPGRADE_PATH, SHIP_STATS } from "@shared/gameConstants";
import { withinDock, type DockedPortLike } from "@shared/world/ports";
import {
  parseClientMessage,
  type ConnectMessage,
  type ReconnectMessage,
  type TradeMessage,
  type ClientMessage,
} from "@shared/protocol";
import { identifyPlayer, trackEvent } from "../segmentClient";

export function handleSocketConnection(ws: WebSocket) {
  let playerId: string | null = null;

  ws.on("message", (raw) => {
    const data = parseClientMessage(raw.toString());
    if (!data) return; // invalid frame: drop quietly

    if ("t" in data) {
      if (data.t === "input") {
        if (playerId) gameState.world.queueInput(playerId, data);
      } else if (data.t === "ping") {
        send(ws, { t: "pong", c: data.c, st: Date.now() });
      }
      return;
    }

    handleLegacy(data).catch((error) => {
      console.error(`Error handling '${data.type}' message:`, error);
      sendError(ws, "Server error");
    });
  });

  ws.on("close", () => {
    if (playerId) {
      gameState.removeClient(playerId, ws);
      console.log(`Player ${playerId} disconnected (players in world: ${gameState.playerCount})`);
    }
  });

  send(ws, { type: "welcome", message: "Welcome to Pirate Trade Wars!", timestamp: Date.now() });

  async function handleLegacy(data: Exclude<ClientMessage, { t: string }>) {
    switch (data.type) {
      case "connect":
        return handleConnect(data);
      case "reconnect":
        return handleReconnect(data);
      case "trade":
        if (playerId) return handleTrade(playerId, data);
        return;
      case "upgradeShip":
        if (playerId && data.portId) return handleUpgradeShip(playerId, data.portId);
        return;
      case "repairShip":
        if (playerId && data.portId) return handleRepairShip(playerId, data.portId);
        return;
      case "scuttle":
        if (playerId) return handleScuttle(playerId);
        return;
    }
  }

  async function handleConnect(data: ConnectMessage) {
    if (!data.name || data.name.trim().length < 3) {
      return sendError(ws, "Name must be at least 3 characters");
    }
    const reservedPlayerId = await redisStorage.getActiveNamePlayerId(data.name);
    if (reservedPlayerId && reservedPlayerId !== data.tempPlayerId) {
      return sendError(ws, "Name already in use by an active player", "nameError");
    }
    const shipStats = SHIP_STATS[data.shipType];
    if (!shipStats) {
      return sendError(ws, "Invalid ship type");
    }
    const addedPlayer = await gameState.addPlayer(data.name, data.shipType, shipStats, data.tempPlayerId);
    if (!addedPlayer) {
      return sendError(ws, "Failed to add player due to name conflict");
    }
    await redisStorage.createPlayer(addedPlayer);
    await redisStorage.addActiveName(addedPlayer.name, addedPlayer.id);

    playerId = addedPlayer.id;

    identifyPlayer(playerId, {
      name: data.name,
      shipType: data.shipType,
      gold: addedPlayer.gold,
      createdAt: new Date(),
    });
    trackEvent(playerId, "Player Connected", { name: data.name, shipType: data.shipType });

    // `connected` first, then attach: the first snapshot (next tick) delivers the world.
    send(ws, {
      type: "connected",
      playerId: addedPlayer.id,
      name: data.name,
      ship: shipStats,
      gold: addedPlayer.gold,
      timestamp: Date.now(),
    });
    gameState.registerClient(addedPlayer.id, ws);
    console.log(`Player ${addedPlayer.name} connected with ID ${addedPlayer.id} (players in world: ${gameState.playerCount})`);
  }

  async function handleReconnect(data: ReconnectMessage) {
    let existingPlayer: WorldPlayer | undefined = gameState.getPlayer(data.id);
    if (!existingPlayer) {
      const stored = await redisStorage.getPlayer(data.id);
      if (!stored) return sendError(ws, "Player ID not found");
      existingPlayer = gameState.world.restorePlayer(stored as any);
    }
    if (data.name !== existingPlayer.name) {
      const reservedPlayerId = await redisStorage.getActiveNamePlayerId(data.name);
      if (reservedPlayerId && reservedPlayerId !== data.tempPlayerId) {
        return sendError(ws, "Name already in use by an active player", "nameError");
      }
    }
    const shipStats = SHIP_STATS[existingPlayer.shipType];
    if (!shipStats) {
      return sendError(ws, "Invalid ship type for reconnecting player");
    }

    playerId = data.id;
    await redisStorage.addActiveName(data.name, playerId);

    trackEvent(playerId, "Player Reconnected", { name: existingPlayer.name, shipType: existingPlayer.shipType });

    send(ws, {
      type: "reconnected",
      playerId,
      name: existingPlayer.name,
      ship: shipStats,
      gold: existingPlayer.gold,
      timestamp: Date.now(),
    });
    gameState.registerClient(playerId, ws);
    console.log(`Player ${existingPlayer.name} reconnected with ID ${playerId}`);
  }

  async function handleTrade(playerId: string, data: TradeMessage) {
    const player = gameState.getPlayer(playerId);
    if (!player || player.dead) return;

    const port = await redisStorage.getPort(data.portId);
    if (!port) return sendError(ws, "Port not found");
    if (!withinPort(player, port)) return sendError(ws, "Too far from port");

    const portGoods = await redisStorage.getPortGoods(port.id);
    const portGood = portGoods.find((pg) => pg.goodId === data.goodId);
    if (!portGood) return sendError(ws, "Good not available at this port");

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
      await redisStorage.updatePlayerGold(player.playerId, player.gold);
      const updatedInventory = await redisStorage.getPlayerInventory(player.playerId);
      trackEvent(playerId, "Trade Buy", {
        portId: data.portId,
        goodId: data.goodId,
        quantity: data.quantity,
        totalCost,
        gold: player.gold,
      });

      send(ws, {
        type: "tradeSuccess",
        action: "buy",
        good: portGood.goodId,
        quantity: data.quantity,
        price: portGood.currentPrice,
        totalCost,
        gold: player.gold,
        inventory: updatedInventory,
        timestamp: Date.now(),
      });
    } else if (data.action === "sell") {
      if (currentQuantity < data.quantity) return sendError(ws, "Not enough goods to sell");
      const totalEarnings = portGood.currentPrice * data.quantity;

      player.gold += totalEarnings;
      player.cargoUsed -= data.quantity;
      await redisStorage.updatePlayerInventory(player.playerId, data.goodId, currentQuantity - data.quantity);
      await redisStorage.updatePlayerGold(player.playerId, player.gold);
      const updatedInventory = await redisStorage.getPlayerInventory(player.playerId);
      trackEvent(playerId, "Trade Sell", {
        portId: data.portId,
        goodId: data.goodId,
        quantity: data.quantity,
        totalEarnings,
        gold: player.gold,
      });

      send(ws, {
        type: "tradeSuccess",
        action: "sell",
        good: portGood.goodId,
        quantity: data.quantity,
        price: portGood.currentPrice,
        totalEarnings,
        gold: player.gold,
        inventory: updatedInventory,
        timestamp: Date.now(),
      });
    }
  }

  async function handleUpgradeShip(playerId: string, portId: number) {
    const player = gameState.getPlayer(playerId);
    if (!player) return sendError(ws, "Player not found");

    const port = await redisStorage.getPort(portId);
    if (!port) return sendError(ws, "Port not found");
    if (!withinPort(player, port)) return sendError(ws, "Too far from port");

    const currentShip = player.shipType;
    const upgradeOption = SHIP_UPGRADE_PATH.find((option) => option.from === currentShip);
    if (!upgradeOption) return sendError(ws, "No upgrade available");

    const nextShipType = upgradeOption.to;
    const upgradeCost = upgradeOption.cost;
    if (player.gold < upgradeCost) return sendError(ws, "Not enough gold");

    player.gold -= upgradeCost;
    // Refreshes hull (full repair), cargo, speed/physics, reload, damage, cannons; re-sends `ent`.
    gameState.world.setShipType(playerId, nextShipType);

    await redisStorage.updatePlayerState(player);

    trackEvent(playerId, "Ship Upgraded", {
      portId,
      fromShipType: currentShip,
      toShipType: nextShipType,
      upgradeCost,
      gold: player.gold,
    });

    send(ws, { type: "upgradeSuccess", newShipType: nextShipType, gold: player.gold, timestamp: Date.now() });
  }

  async function handleRepairShip(playerId: string, portId: number) {
    const player = gameState.getPlayer(playerId);
    if (!player) return sendError(ws, "Player not found");
    if (player.dead || player.sunk) return sendError(ws, "Cannot repair a sunk or dead ship");

    const port = await redisStorage.getPort(portId);
    if (!port) return sendError(ws, "Port not found");
    if (!withinPort(player, port)) return sendError(ws, "Too far from port");

    const repairCost = SHIP_STATS[player.shipType].repairCost;
    if (player.gold < repairCost) return sendError(ws, "Not enough gold");

    player.gold -= repairCost;
    player.hp = player.maxHp;

    await redisStorage.updatePlayerState(player);

    trackEvent(playerId, "Ship Repaired", { portId, repairCost, gold: player.gold, hp: player.hp });

    send(ws, { type: "repairSuccess", gold: player.gold, hp: player.hp, timestamp: Date.now() });
  }

  async function handleScuttle(playerId: string) {
    const player = gameState.getPlayer(playerId);
    if (!player) return sendError(ws, "Player not found");
    const postScuttleGold = player.gold - 500;
    console.log(`Player ${player.name} scuttled their ship with score ${postScuttleGold}`);
    if (postScuttleGold > 0) {
      await redisStorage.addToLeaderboard({
        playerId: player.playerId,
        playerName: player.name,
        score: postScuttleGold,
        achievedAt: new Date(),
      });
    }
    // TODO: Fetch the leaderboard ranks NEAR the player's rank.
    const leaderboardRaw = await redisStorage.getLeaderboard(10);
    const leaderboard = leaderboardRaw.map((entry) => ({ ...entry, playerId: entry.playerId ?? "" }));
    await gameState.updateLeaderboard(leaderboard);

    trackEvent(playerId, "Ship Scuttled", { score: postScuttleGold, gold: player.gold });

    if (ws.readyState === WebSocket.OPEN) {
      send(ws, {
        type: "gameEnd",
        reason: "scuttle",
        score: postScuttleGold,
        message: "You scuttled your ship and joined the leaderboard!",
        leaderboard,
        timestamp: Date.now(),
      });
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }, 1000);
    }

    gameState.removeClient(playerId, ws);
    await redisStorage.setPlayerActive(player.playerId, false);
    await redisStorage.removePlayer(player.playerId);
    setTimeout(() => {
      // Only remove the same ship (the id may have been reused by a new connect).
      if (gameState.getPlayer(playerId) === player) gameState.world.removePlayer(playerId);
    }, 5000);
  }
}

/** Port interaction gate (trade, upgrade, repair; WORLD_SPEC §5): metric distance from the ship to
 *  the port's DOCK ≤ PORT_INTERACTION_RADIUS (300). */
export function withinPort(player: { x: number; z: number }, port: DockedPortLike): boolean {
  return withinDock(player.x, player.z, port);
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string, type: string = "error") {
  send(ws, { type, message, timestamp: Date.now() });
}
