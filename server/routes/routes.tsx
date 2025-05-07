import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { redisStorage } from '../redisStorage'
import { WebSocketServer } from "ws";
import { handleSocketConnection } from "../game/socketHandler";
import { initializeGameState, gameState } from "../game/gameState";
import { setupShipTypes } from "../game/shipTypes";
import crypto from "crypto";
import { validate as isUUID } from "uuid";
import { registerStripeRoutes } from "./stripeRoutes";
import { SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize ship types and game state
  await setupShipTypes();
  await initializeGameState();

  registerStripeRoutes(app)

  // Start game server for AWS Autoscaling
  app.post('/start-game', async (req, res) => {
    const AWS = require('aws-sdk');
    const autoscaling = new AWS.AutoScaling({ region: 'us-east-2' });
    await autoscaling.updateAutoScalingGroup({
      AutoScalingGroupName: 'PirateTradeWarsGameAsg',
      DesiredCapacity: 1,
    }).promise();
    const serverId = generateServerId(); // e.g., 'abcdef'
    res.json({ wsUrl: `wss://piratetradewars.com/server-${serverId}` });
  });

  app.post('/no-players', async (req, res) => {
    await autoscaling.updateAutoScalingGroup({
      AutoScalingGroupName: 'PirateTradeWarsGameAsg',
      DesiredCapacity: 0,
    }).promise();
    res.sendStatus(200);
  });

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy' });
  });

  // User registration and authentication
  app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
      // Check if username already exists
      const existingUser = await redisStorage.getUserByUsername(username);

      if (existingUser) {
        return res.status(409).json({ message: 'Username already taken' });
      }

      // Hash password
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

      // Create user
      const user = await redisStorage.createUser({
        username,
        password: hashedPassword
      });

      res.status(201).json({ id: user.id, username: user.username });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ message: 'Failed to create user' });
    }
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
      const portGoods = await redisStorage.getPortGoods(portId);

      // If the port has no goods, trigger an update
      if (portGoods.length === 0) {
        console.log(`Port ${portId} has no goods, triggering price update`);
        await gameState.updatePrices();
        // Fetch updated goods after regeneration
        const updatedGoods = await redisStorage.getPortGoods(portId);
        res.json(updatedGoods);
      } else {
        res.json(portGoods);
      }
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

  // Update player inventory
  app.put('/api/players/:playerId/inventory', async (req, res) => {
    const playerId = req.params.playerId;
    const inventory = req.body;

    if (!playerId) {
      return res.status(400).json({ message: 'Invalid player ID' });
    }

    if (!Array.isArray(inventory)) {
      return res.status(400).json({ message: 'Inventory must be an array' });
    }

    if (!isUUID(playerId)) {
      return res.status(400).json({ message: 'Invalid player ID' });
    }

    try {
      // Update each item in the inventory
      for (const item of inventory) {
        await redisStorage.updatePlayerInventory(playerId, item.goodId, item.quantity);
      }

      res.json({ success: true, message: 'Inventory updated successfully' });
    } catch (error) {
      console.error('Error updating player inventory:', error);
      res.status(500).json({ message: 'Failed to update player inventory' });
    }
  });

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
    handleSocketConnection(ws);
  });

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
