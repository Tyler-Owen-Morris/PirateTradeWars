/**
 * Per-socket message handling for `/game-ws` (docs/netcode/PROTOCOL.md §3–§4).
 *
 * Every frame is validated with `parseClientMessage`; invalid frames are dropped silently (no
 * per-frame error replies). Hot-path messages are synchronous: `input` goes straight into the
 * world's per-player input queue (consumed by the 20 Hz tick), `ping` is answered with `pong`, and
 * `chat` is rate-limited/cleaned by `gameState.chat` (server/game/chat.ts) and broadcast at once.
 * The legacy flows (connect / reconnect / trade / upgradeShip / repairShip / scuttle) stay async
 * (Redis) but run outside the tick and operate on the live world player objects.
 */
import { redisStorage } from "../redisStorage";
import { gameState, type WorldPlayer } from "./gameState";
import { isNpcId } from "./world";
import { decayNotoriety } from "./npc/factions";
import { WebSocket } from "ws";
import { SHIP_UPGRADE_PATH, SHIP_STATS, GOODS } from "@shared/gameConstants";
import { applyTrade, applySellAll, refuse, playerQueue, portQueue, type Refusal } from "./trade";
import { withinDock, type DockedPortLike } from "@shared/world/ports";
import {
  parseClientMessage,
  type ConnectMessage,
  type ReconnectMessage,
  type TradeMessage,
  type SellAllMessage,
  type TradeResultMessage,
  type InventoryRow,
  type TradeCode,
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
      } else if (data.t === "chat") {
        handleChat(data.text);
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

  /**
   * Global chat (synchronous, message path only; never touches the tick). Only a joined player whose
   * socket is the one attached, and whose ship is afloat, may chat. The name comes from the world's
   * player record. `text` was already sanitized by parseClientMessage.
   */
  function handleChat(text: string) {
    if (!playerId || !gameState.isRegisteredSocket(playerId, ws)) return;
    const player = gameState.getPlayer(playerId);
    if (!player || player.controller !== "player" || player.dead || player.sunk) return;
    const res = gameState.chat.submit({ id: playerId, name: player.name }, text);
    if (res.ok) gameState.broadcast(JSON.stringify(res.line));
    else if (res.notice) send(ws, res.notice);
  }

  /** Global chat: replay the recent history to this socket (after `connected`/`reconnected`). */
  function sendChatHistory() {
    send(ws, { t: "chatHistory", lines: gameState.chat.history() });
  }

  async function handleLegacy(data: Exclude<ClientMessage, { t: string }>) {
    switch (data.type) {
      case "connect":
        return handleConnect(data);
      case "reconnect":
        return handleReconnect(data);
      case "trade":
        if (playerId) return handleTrade(playerId, data);
        return;
      case "sellAll":
        if (playerId) return handleSellAll(playerId, data);
        return;
      case "upgradeShip":
        if (playerId && data.portId) { const id = playerId; return playerQueue.run(id, () => handleUpgradeShip(id, data.portId)); }
        return;
      case "repairShip":
        if (playerId && data.portId) { const id = playerId; return playerQueue.run(id, () => handleRepairShip(id, data.portId)); }
        return;
      case "scuttle":
        if (playerId) return handleScuttle(playerId);
        return;
    }
  }

  async function handleConnect(data: ConnectMessage) {
    if (isNpcId(data.tempPlayerId)) delete data.tempPlayerId; // NPC1: npc:* ids are reserved
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
    sendChatHistory();
    console.log(`Player ${addedPlayer.name} connected with ID ${addedPlayer.id} (players in world: ${gameState.playerCount})`);
  }

  async function handleReconnect(data: ReconnectMessage) {
    if (isNpcId(data.id)) return sendError(ws, "Player ID not found"); // NPC1: never attach to an NPC
    let existingPlayer: WorldPlayer | undefined = gameState.getPlayer(data.id);
    if (!existingPlayer) {
      const stored = await redisStorage.getPlayer(data.id);
      if (!stored) return sendError(ws, "Player ID not found");
      // NPC2: notoriety kept decaying while the player was offline.
      const standing = (stored as any).standing;
      if (standing && typeof stored.lastSeen === "number") decayNotoriety(standing, (Date.now() - stored.lastSeen) / 60_000);
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
    sendChatHistory();
    console.log(`Player ${existingPlayer.name} reconnected with ID ${playerId}`);
  }

  /** Every port action of a player runs one at a time (trade.ts `playerQueue`): no read-await-write races. */
  function handleTrade(playerId: string, data: TradeMessage) {
    return playerQueue.run(playerId, () => doTrade(playerId, data));
  }
  function handleSellAll(playerId: string, data: SellAllMessage) {
    return playerQueue.run(playerId, () => doSellAll(playerId, data));
  }

  /** Answer a trade: `tradeResult` when the request carried a `ref` (new clients) or was a sellAll;
   *  otherwise the legacy `tradeSuccess` / `error` (cached old clients). */
  function answer(
    player: WorldPlayer,
    req: { ref?: number; action: "buy" | "sell" | "sellAll"; legacy: boolean },
    res: Refusal | ({ ok: true; inventory: InventoryRow[]; total: number } & Partial<{ good: number; quantity: number; price: number; lines: { goodId: number; quantity: number; price: number }[] }>),
    inventory: InventoryRow[],
  ) {
    if (req.legacy) {
      if (!res.ok) return sendError(ws, LEGACY_TRADE_ERRORS[res.code] ?? res.message);
      return send(ws, {
        type: "tradeSuccess", action: req.action, good: res.good, quantity: res.quantity, price: res.price,
        ...(req.action === "buy" ? { totalCost: res.total } : { totalEarnings: res.total }),
        gold: player.gold, inventory: res.inventory, timestamp: Date.now(),
      });
    }
    const msg: TradeResultMessage = res.ok
      ? { type: "tradeResult", ok: true, action: req.action, good: res.good, quantity: res.quantity, price: res.price, total: res.total, lines: res.lines,
          gold: player.gold, cargoUsed: player.cargoUsed, inventory: res.inventory, timestamp: Date.now() }
      : { type: "tradeResult", ok: false, action: req.action, code: res.code, message: res.message,
          gold: player.gold, cargoUsed: player.cargoUsed, inventory, timestamp: Date.now() };
    if (req.ref !== undefined) msg.ref = req.ref;
    send(ws, msg);
  }

  async function doTrade(playerId: string, data: TradeMessage) {
    const player = gameState.getPlayer(playerId);
    if (!player) return;
    const req = { ref: data.ref, action: data.action, legacy: data.ref === undefined };
    const goodName = GOODS.find((g) => g.id === data.goodId)?.name ?? "that good";
    if (player.dead || player.sunk) return answer(player, req, refuse("dead", "A sunk ship can't trade."), []);
    const port = await redisStorage.getPort(data.portId);
    if (!port) return answer(player, req, refuse("no_port", "Port not found"), []);
    if (!withinPort(player, port)) return answer(player, req, refuse("too_far", "Too far from port"), []);

    await portQueue.run(`port:${port.id}`, async () => {
      const [market, inventory] = await Promise.all([redisStorage.getPortGoods(port.id), redisStorage.getPlayerInventory(player.playerId)]);
      // Decide and apply in one synchronous block (the tick may change gold between awaits).
      if (!withinPort(player, port)) return answer(player, req, refuse("too_far", "Too far from port"), inventory);
      const res = applyTrade({ gold: player.gold, cargoCapacity: player.cargoCapacity, inventory }, market, data, goodName);
      if (!res.ok) return answer(player, req, res, inventory);
      player.gold = res.gold;
      player.cargoUsed = res.cargoUsed;
      await Promise.all([
        redisStorage.saveTrade(player.playerId, res.inventory, res.gold),
        redisStorage.setPortGoods(port.id, res.market as typeof market),
      ]);
      trackEvent(playerId, data.action === "buy" ? "Trade Buy" : "Trade Sell", {
        portId: data.portId, goodId: data.goodId, quantity: data.quantity,
        ...(data.action === "buy" ? { totalCost: res.total } : { totalEarnings: res.total }), gold: player.gold,
      });
      answer(player, req, { ...res, good: data.goodId, quantity: data.quantity }, res.inventory);
    });
  }

  async function doSellAll(playerId: string, data: SellAllMessage) {
    const player = gameState.getPlayer(playerId);
    if (!player) return;
    const req = { ref: data.ref, action: "sellAll" as const, legacy: false };
    if (player.dead || player.sunk) return answer(player, req, refuse("dead", "A sunk ship can't trade."), []);
    const port = await redisStorage.getPort(data.portId);
    if (!port) return answer(player, req, refuse("no_port", "Port not found"), []);
    if (!withinPort(player, port)) return answer(player, req, refuse("too_far", "Too far from port"), []);
    await portQueue.run(`port:${port.id}`, async () => {
      const [market, inventory] = await Promise.all([redisStorage.getPortGoods(port.id), redisStorage.getPlayerInventory(player.playerId)]);
      if (!withinPort(player, port)) return answer(player, req, refuse("too_far", "Too far from port"), inventory);
      const res = applySellAll({ gold: player.gold, cargoCapacity: player.cargoCapacity, inventory }, market, data.lines,
        (id) => GOODS.find((g) => g.id === id)?.name ?? "that good");
      if (!res.ok) return answer(player, req, res, inventory);
      player.gold = res.gold;
      player.cargoUsed = 0;
      await Promise.all([
        redisStorage.saveTrade(player.playerId, [], res.gold),
        redisStorage.setPortGoods(port.id, res.market as typeof market),
      ]);
      trackEvent(playerId, "Trade Sell All", { portId: data.portId, lines: res.lines.length, totalEarnings: res.total, gold: player.gold });
      answer(player, req, res, []);
    });
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

/** Legacy `error` texts for old clients (no `ref`), kept identical to the pre-2026-10-23 server. */
const LEGACY_TRADE_ERRORS: Partial<Record<TradeCode, string>> = {
  too_far: "Too far from port",
  no_port: "Port not found",
  not_traded: "Good not available at this port",
  not_sold: "Good not available at this port",
  no_stock: "Not enough stock available",
  no_gold: "Not enough gold",
  no_space: "Not enough cargo space",
  not_owned: "Not enough goods to sell",
};

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string, type: string = "error") {
  send(ws, { type, message, timestamp: Date.now() });
}
