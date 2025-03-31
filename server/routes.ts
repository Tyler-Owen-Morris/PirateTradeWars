import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer } from "ws";
import { handleSocketConnection } from "./game/socketHandler";
import { initializeGameState } from "./game/gameState";
import { setupShipTypes } from "./game/shipTypes";
import crypto from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize ship types and game state
  await setupShipTypes();
  await initializeGameState();

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
      const existingUser = await storage.getUserByUsername(username);
      
      if (existingUser) {
        return res.status(409).json({ message: 'Username already taken' });
      }
      
      // Hash password
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
      
      // Create user
      const user = await storage.createUser({
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
      const player = await storage.getPlayerByName(name);
      res.json({ available: !player });
    } catch (error) {
      console.error('Error checking player name:', error);
      res.status(500).json({ message: 'Failed to check player name' });
    }
  });

  // Get ship types
  app.get('/api/ship-types', async (req, res) => {
    try {
      const shipTypes = await storage.getShipTypes();
      res.json(shipTypes);
    } catch (error) {
      console.error('Error fetching ship types:', error);
      res.status(500).json({ message: 'Failed to fetch ship types' });
    }
  });

  // Get leaderboard
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const leaderboard = await storage.getLeaderboard();
      res.json(leaderboard);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ message: 'Failed to fetch leaderboard' });
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
