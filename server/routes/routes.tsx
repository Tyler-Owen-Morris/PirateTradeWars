import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { redisStorage } from '../redisStorage'
import { WebSocketServer, WebSocket } from "ws";
import { handleSocketConnection } from "../game/socketHandler";
import { initializeGameState, gameState } from "../game/gameState";
import { setupShipTypes } from "../game/shipTypes";
import crypto from "crypto";
import { registerStripeRoutes } from "./stripeRoutes";
import { SHIP_STATS, SHIP_TYPES, GOODS } from "@shared/gameConstants";
import { portGoodView } from "@shared/market";
import { HEARTBEAT_INTERVAL_MS } from "@shared/protocol";
import { shipsFree } from "../config";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize ship types and game state
  await setupShipTypes();
  await initializeGameState();

  registerStripeRoutes(app)

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy' });
  });


  // Public runtime config for the client (no secrets). shipsFree: SHIPS_FREE env var, see server/config.ts.
  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ shipsFree: shipsFree() });
  });

  // Player name verification
  app.get('/api/check-player-name', async (req, res) => {
    const { name } = req.query;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Player name is required' });
    }

    try {
      const player = await redisStorage.getPlayerByName(name);
      res.json({ available: !player });
    } catch (error) {
      console.error('Error checking player name:', error);
      res.status(500).json({ message: 'Failed to check player name' });
    }
  });

  // Get ship types
  const shipTypes = Object.entries(SHIP_STATS).map(([name, stats]) => ({
    name,
    ...stats
  }));

  // Get leaderboard
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const leaderboard = await redisStorage.getLeaderboard();
      res.json(leaderboard);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ message: 'Failed to fetch leaderboard' });
    }
  });

  // Get ports
  app.get('/api/ports', async (req, res) => {
    try {
      const ports = await redisStorage.getPorts();
      res.json(ports);
    } catch (error) {
      console.error('Error fetching ports:', error);
      res.status(500).json({ message: 'Failed to fetch ports' });
    }
  });

  // Get goods
  app.get('/api/goods', async (req, res) => {
    try {
      const goods = await redisStorage.getGoods();
      res.json(goods);
    } catch (error) {
      console.error('Error fetching goods:', error);
      res.status(500).json({ message: 'Failed to fetch goods' });
    }
  });

  // Get port goods
  app.get('/api/ports/:portId/goods', async (req, res) => {
    const portId = parseInt(req.params.portId);

    if (isNaN(portId)) {
      return res.status(400).json({ message: 'Invalid port ID' });
    }

    try {
      let portGoods = await redisStorage.getPortGoods(portId);

      // If the port has no goods, trigger an update
      if (portGoods.length === 0) {
        console.log(`Port ${portId} has no goods, triggering price update`);
        await gameState.updatePrices();
        portGoods = await redisStorage.getPortGoods(portId);
      }
      // Trading (2026-10-23): each row keeps the stored fields (legacy clients read `currentPrice`) and adds
      // the trade screen's view: `buyPrice` (null = not sold here), `sellPrice` (the ~10% spread), `wanted`.
      const port = await redisStorage.getPort(portId);
      res.json(portGoods.map((pg) => ({
        ...pg,
        ...portGoodView(pg, port ?? null, GOODS.find((g) => g.id === pg.goodId)?.name ?? ""),
      })));
    } catch (error) {
      console.error('Error fetching port goods:', error);
      res.status(500).json({ message: 'Failed to fetch port goods' });
    }
  });

  // Get player inventory
  app.get('/api/players/:playerId/inventory', async (req, res) => {
    console.log(req.params)
    const playerId = req.params.playerId;

    if (!playerId) {
      return res.status(400).json({ message: 'Invalid player ID' });
    }

    try {
      console.log("get player inventory route called with passed param:", playerId)
      const inventory = await redisStorage.getPlayerInventory(playerId);
      res.json(inventory);
    } catch (error) {
      console.error('Error fetching player inventory:', error);
      res.status(500).json({ message: 'Failed to fetch player inventory' });
    }
  });

  // (2026-10-23) The old `PUT /api/players/:playerId/inventory` is gone: it let any caller write any cargo,
  // and the client used it to overwrite the server's inventory after every trade (a race). The server is
  // the only writer of inventories now (server/game/trade.ts via the socket).

  // Endpoint to manually trigger price and stock updates
  app.post('/api/update-prices', async (req, res) => {
    try {
      await gameState.updatePrices();
      res.json({ success: true, message: 'Port prices and stock updated successfully' });
    } catch (error) {
      console.error('Error updating prices:', error);
      res.status(500).json({ message: 'Failed to update prices and stock' });
    }
  });

  const httpServer = createServer(app);

  // Initialize WebSocket server without direct server integration
  const wss = new WebSocketServer({
    noServer: true
  });

  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    console.log('New WebSocket connection to game server');
    missedPongs.set(ws, 0);
    ws.on('pong', () => missedPongs.set(ws, 0));
    handleSocketConnection(ws);
  });

  // Heartbeat (PROTOCOL §3): ws-level ping every HEARTBEAT_INTERVAL_MS; a socket that missed 2
  // pongs in a row is terminated (its 'close' handler then starts the player's grace period).
  // Also keeps idle sockets inside the ALB/nginx idle timeouts.
  const missedPongs = new WeakMap<WebSocket, number>();
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const missed = missedPongs.get(ws) ?? 0;
      if (missed >= 2) {
        console.log('Terminating WebSocket that missed 2 heartbeats');
        ws.terminate();
        return;
      }
      missedPongs.set(ws, missed + 1);
      try {
        ws.ping();
      } catch {
        // socket already closing
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  registerGracefulShutdown(httpServer, wss);

  // Handle upgrade requests manually via HTTP server
  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle upgrades to our specific game WebSocket path
    if (request.url === '/game-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  return httpServer;
}

/**
 * Graceful shutdown on SIGTERM/SIGINT (EB deploys send SIGTERM): stop the tick, persist every
 * in-world player to Redis, flush Segment, close sockets with 1012 (service restart, so clients
 * reconnect with backoff), then exit. A hard timeout guarantees exit even if Redis hangs.
 */
function registerGracefulShutdown(httpServer: Server, wss: WebSocketServer) {
  let shuttingDown = false;
  const onSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: shutting down gracefully`);
    const hardExit = setTimeout(() => {
      console.error('Graceful shutdown timed out; exiting');
      process.exit(1);
    }, 10000);
    hardExit.unref();
    try {
      await gameState.shutdown();
    } catch (err) {
      console.error('Error during game shutdown:', err);
    }
    wss.clients.forEach((ws) => {
      try {
        ws.close(1012, 'Server restarting');
      } catch {
        ws.terminate();
      }
    });
    wss.close();
    httpServer.close();
    // Give close frames a moment to flush.
    setTimeout(() => process.exit(0), 300).unref();
  };
  process.once('SIGTERM', () => void onSignal('SIGTERM'));
  process.once('SIGINT', () => void onSignal('SIGINT'));
}
