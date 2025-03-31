import { storage } from "../storage";
import { defaultPorts, goodTypes } from "./shipTypes";

// Game state constants
export const MAP_WIDTH = 5000;
export const MAP_HEIGHT = 5000;
export const TICK_RATE = 50; // ms (20 updates/second)
export const BROADCAST_RATE = 50; // ms (20 updates/second)
export const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const MAX_PLAYERS_PER_INSTANCE = 100;

// Game state interfaces
export interface PlayerState {
  id: string;
  playerId: number;
  name: string;
  shipType: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  speed: number;
  direction: { x: number, y: number, z: number };
  hp: number;
  maxHp: number;
  gold: number;
  cargoCapacity: number;
  cargoUsed: number;
  firing: boolean;
  canFire: boolean;
  lastFired: number;
  reloadTime: number;
  damage: number;
  cannonCount: number;
  sunk: boolean;
  connected: boolean;
  lastSeen: number;
}

export interface CannonBall {
  id: string;
  ownerId: string;
  damage: number;
  x: number;
  y: number;
  z: number;
  direction: { x: number, y: number, z: number };
  speed: number;
  created: number;
}

export interface GameStateData {
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  lastUpdate: number;
}

// Game state singleton
class GameState {
  state: GameStateData;
  private tickInterval: NodeJS.Timeout | null;
  private broadcastInterval: NodeJS.Timeout | null;
  private priceUpdateInterval: NodeJS.Timeout | null;
  private connectedClients: Map<string, WebSocket>;

  constructor() {
    this.state = {
      players: {},
      cannonBalls: [],
      lastUpdate: Date.now()
    };
    this.tickInterval = null;
    this.broadcastInterval = null;
    this.priceUpdateInterval = null;
    this.connectedClients = new Map();
  }

  start() {
    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this.tick(), TICK_RATE);
      console.log("Game tick started");
    }

    if (!this.broadcastInterval) {
      this.broadcastInterval = setInterval(() => this.broadcast(), BROADCAST_RATE);
      console.log("Game broadcast started");
    }

    if (!this.priceUpdateInterval) {
      this.priceUpdateInterval = setInterval(() => this.updatePrices(), PRICE_UPDATE_INTERVAL);
      console.log("Price updates started");
    }
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log("Game tick stopped");
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
      console.log("Game broadcast stopped");
    }

    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
      console.log("Price updates stopped");
    }
  }

  registerClient(playerId: string, ws: WebSocket) {
    this.connectedClients.set(playerId, ws);
  }

  removeClient(playerId: string) {
    this.connectedClients.delete(playerId);
    
    // Mark player as disconnected but don't remove them immediately
    // This allows their ship to remain in the game for a period
    const player = this.state.players[playerId];
    if (player) {
      player.connected = false;
      player.lastSeen = Date.now();
    }
  }

  addPlayer(id: string, playerId: number, name: string, shipType: string, ship: any) {
    // Random start position
    const x = Math.random() * MAP_WIDTH;
    const z = Math.random() * MAP_HEIGHT;
    
    this.state.players[id] = {
      id,
      playerId,
      name,
      shipType,
      x,
      y: 0, // On water surface
      z,
      rotationY: 0,
      speed: 0,
      direction: { x: 0, y: 0, z: 1 },
      hp: ship.hullStrength,
      maxHp: ship.hullStrength,
      gold: 500, // Starting gold
      cargoCapacity: ship.cargoCapacity,
      cargoUsed: 0,
      firing: false,
      canFire: true,
      lastFired: 0,
      reloadTime: ship.cannonReload * 1000,
      damage: ship.cannonDamage,
      cannonCount: ship.cannonCount,
      sunk: false,
      connected: true,
      lastSeen: Date.now()
    };
  }

  updatePlayer(id: string, update: Partial<PlayerState>) {
    const player = this.state.players[id];
    if (player) {
      // If player is sunk, they should not be updated
      if (player.sunk) return;
      
      // Update only the allowed properties
      if (update.rotationY !== undefined) player.rotationY = update.rotationY;
      if (update.speed !== undefined) player.speed = Math.min(update.speed, this.getShipSpeed(player.shipType));
      if (update.firing !== undefined) player.firing = update.firing;
      
      // Direction vector must be normalized
      if (update.direction) {
        const magnitude = Math.sqrt(
          update.direction.x * update.direction.x + 
          update.direction.y * update.direction.y + 
          update.direction.z * update.direction.z
        );
        
        if (magnitude > 0) {
          player.direction = {
            x: update.direction.x / magnitude,
            y: update.direction.y / magnitude,
            z: update.direction.z / magnitude
          };
        }
      }
      
      // Mark as still connected
      player.connected = true;
      player.lastSeen = Date.now();
    }
  }

  fireCannonBall(playerId: string) {
    const player = this.state.players[playerId];
    if (!player || player.sunk || !player.canFire) return;

    const now = Date.now();
    
    // Check reload time
    if (now - player.lastFired < player.reloadTime) return;
    
    // Update player's cannon state
    player.canFire = false;
    player.lastFired = now;
    
    // Schedule cannon reload
    setTimeout(() => {
      if (this.state.players[playerId]) {
        this.state.players[playerId].canFire = true;
      }
    }, player.reloadTime);
    
    // Create cannon balls for each cannon
    for (let i = 0; i < player.cannonCount; i++) {
      // Offset each cannon slightly
      const offsetAngle = (i - (player.cannonCount - 1) / 2) * 0.1;
      const angle = player.rotationY + Math.PI / 2 + offsetAngle; // 90 degrees to the ship direction
      
      const direction = {
        x: Math.sin(angle),
        y: 0,
        z: Math.cos(angle)
      };
      
      // Create the cannon ball
      const cannonBall: CannonBall = {
        id: `${playerId}_${now}_${i}`,
        ownerId: playerId,
        damage: player.damage,
        x: player.x + direction.x * 10, // Offset from ship
        y: 5, // Slight height
        z: player.z + direction.z * 10, // Offset from ship
        direction,
        speed: 15, // Fixed cannon ball speed
        created: now
      };
      
      this.state.cannonBalls.push(cannonBall);
    }
  }

  tick() {
    const now = Date.now();
    const deltaTime = (now - this.state.lastUpdate) / 1000; // Convert to seconds
    this.state.lastUpdate = now;
    
    // Update player positions
    Object.values(this.state.players).forEach(player => {
      // Skip sunk or disconnected players
      if (player.sunk) return;
      
      // Remove players that have been disconnected for too long (30 seconds)
      if (!player.connected && now - player.lastSeen > 30000) {
        delete this.state.players[player.id];
        return;
      }
      
      // Update position based on speed and direction (works for both positive and negative speed)
      if (player.speed !== 0) {
        player.x += player.direction.x * player.speed * deltaTime * 60; // Pixels per frame at 60 FPS
        player.z += player.direction.z * player.speed * deltaTime * 60;
        
        // Wrap around map edges
        player.x = (player.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
        player.z = (player.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
        
        // Log movement for debugging
        if (Math.random() < 0.05) { // Only log 5% of updates to avoid spam
          console.log(`Player ${player.name} moved to (${Math.round(player.x)}, ${Math.round(player.z)}) with speed ${player.speed}`);
        }
      }
    });
    
    // Update cannon balls
    for (let i = this.state.cannonBalls.length - 1; i >= 0; i--) {
      const ball = this.state.cannonBalls[i];
      
      // Update position
      ball.x += ball.direction.x * ball.speed * deltaTime * 60;
      ball.y += ball.direction.y * ball.speed * deltaTime * 60;
      ball.z += ball.direction.z * ball.speed * deltaTime * 60;
      
      // Wrap around map edges
      ball.x = (ball.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      ball.z = (ball.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
      
      // Remove old cannon balls (5 seconds lifetime)
      if (now - ball.created > 5000) {
        this.state.cannonBalls.splice(i, 1);
        continue;
      }
      
      // Check for collisions with players
      for (const playerId in this.state.players) {
        const player = this.state.players[playerId];
        
        // Skip if it's the player's own cannon ball or player is already sunk
        if (ball.ownerId === playerId || player.sunk) continue;
        
        // Calculate distance (considering map wrapping)
        const dx = Math.min(Math.abs(ball.x - player.x), MAP_WIDTH - Math.abs(ball.x - player.x));
        const dz = Math.min(Math.abs(ball.z - player.z), MAP_HEIGHT - Math.abs(ball.z - player.z));
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Simple collision with ship (assuming 20 unit radius)
        if (distance < 20) {
          // Apply damage, adjusted for armor
          const armorFactor = 1 - (this.getShipArmor(player.shipType) / 100);
          const damageDealt = Math.round(ball.damage * armorFactor);
          player.hp -= damageDealt;
          
          // Check if ship is sunk
          if (player.hp <= 0) {
            player.hp = 0;
            player.sunk = true;
            
            // Add to leaderboard
            this.handlePlayerSunk(player);
          }
          
          // Remove the cannon ball
          this.state.cannonBalls.splice(i, 1);
          break;
        }
      }
    }
  }

  broadcast() {
    // Prepare the broadcast message
    for (const [playerId, ws] of this.connectedClients.entries()) {
      if (ws.readyState !== 1) continue; // Skip if not open
      
      const player = this.state.players[playerId];
      if (!player) continue;
      
      // Get nearby players (within 1000 units, considering wrapping)
      const nearbyPlayers: Record<string, PlayerState> = {};
      Object.entries(this.state.players).forEach(([id, otherPlayer]) => {
        if (id === playerId) {
          // Always include the current player
          nearbyPlayers[id] = otherPlayer;
          return;
        }
        
        // Calculate wrapped distance
        const dx = Math.min(Math.abs(player.x - otherPlayer.x), MAP_WIDTH - Math.abs(player.x - otherPlayer.x));
        const dz = Math.min(Math.abs(player.z - otherPlayer.z), MAP_HEIGHT - Math.abs(player.z - otherPlayer.z));
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < 1000) {
          nearbyPlayers[id] = otherPlayer;
        }
      });
      
      // Get nearby cannon balls
      const nearbyCannonBalls = this.state.cannonBalls.filter(ball => {
        const dx = Math.min(Math.abs(player.x - ball.x), MAP_WIDTH - Math.abs(player.x - ball.x));
        const dz = Math.min(Math.abs(player.z - ball.z), MAP_HEIGHT - Math.abs(player.z - ball.z));
        const distance = Math.sqrt(dx * dx + dz * dz);
        return distance < 1000;
      });
      
      // Send the update
      try {
        ws.send(JSON.stringify({
          type: 'gameUpdate',
          players: nearbyPlayers,
          cannonBalls: nearbyCannonBalls,
          timestamp: Date.now()
        }));
      } catch (err) {
        console.error(`Error sending to ${playerId}:`, err);
        // Remove client on error
        this.removeClient(playerId);
      }
    }
  }

  async updatePrices() {
    try {
      // Get all ports
      const ports = await storage.getPorts();
      
      // Get all goods
      const goods = await storage.getGoods();
      
      // Update prices at each port
      for (const port of ports) {
        const portGoods = await storage.getPortGoods(port.id);
        
        for (const portGood of portGoods) {
          // Get base price and fluctuation for this good
          const good = goods.find(g => g.id === portGood.goodId);
          if (!good) continue;
          
          // Calculate a new price with random fluctuation
          const fluctPercent = (Math.random() * 2 - 1) * good.fluctuation / 100;
          const newPrice = Math.round(good.basePrice * (1 + fluctPercent));
          
          // Update the price
          await storage.updatePortGoodPrice(portGood.id, newPrice);
        }
      }
      
      console.log('Port prices updated');
    } catch (err) {
      console.error('Error updating prices:', err);
    }
  }

  // Helper method to get ship speed based on ship type
  private getShipSpeed(shipType: string): number {
    const speedMap: Record<string, number> = {
      'sloop': 5,
      'brigantine': 6,
      'galleon': 7,
      'man-o-war': 8
    };
    return speedMap[shipType] || 5;
  }
  
  // Helper method to get ship armor percentage
  private getShipArmor(shipType: string): number {
    const armorMap: Record<string, number> = {
      'sloop': 0,
      'brigantine': 10,
      'galleon': 20,
      'man-o-war': 30
    };
    return armorMap[shipType] || 0;
  }
  
  // Handle player being sunk
  private async handlePlayerSunk(player: PlayerState) {
    try {
      // Update player state in database if needed
      const dbPlayer = await storage.getPlayer(player.playerId);
      if (dbPlayer) {
        // Add to leaderboard
        await storage.addToLeaderboard({
          playerId: player.playerId,
          playerName: player.name,
          score: player.gold
        });
        
        console.log(`Player ${player.name} sunk with score ${player.gold}`);
      }
    } catch (err) {
      console.error('Error handling sunk player:', err);
    }
  }
}

// Create the singleton instance
export const gameState = new GameState();

// Initialize game state with ports and goods
export async function initializeGameState() {
  try {
    // Initialize ports if needed
    const ports = await storage.getPorts();
    if (ports.length === 0) {
      for (const port of defaultPorts) {
        await storage.createPort(port);
      }
      console.log('Ports initialized');
    }
    
    // Initialize goods if needed
    const goods = await storage.getGoods();
    if (goods.length === 0) {
      for (const good of goodTypes) {
        await storage.createGood(good);
      }
      console.log('Goods initialized');
    }
    
    // Initialize port goods if needed
    for (const port of await storage.getPorts()) {
      const portGoods = await storage.getPortGoods(port.id);
      if (portGoods.length === 0) {
        // Each port gets all goods with slightly randomized prices
        for (const good of await storage.getGoods()) {
          const basePrice = good.basePrice;
          const fluctPercent = (Math.random() * 2 - 1) * good.fluctuation / 100;
          const initialPrice = Math.round(basePrice * (1 + fluctPercent));
          const initialStock = Math.floor(Math.random() * 50) + 50; // 50-100 initial stock
          
          // Add good to port
          const portGood = {
            portId: port.id,
            goodId: good.id,
            currentPrice: initialPrice,
            stock: initialStock,
            updatedAt: new Date()
          };
          
          // This is simplified for in-memory storage
          // In a real DB, we'd use a proper insert method
          const id = (await storage.getPortGoods(port.id)).length + 1;
          await storage.updatePortGoodPrice(id, initialPrice);
        }
      }
    }
    
    // Start the game state loop
    gameState.start();
    
  } catch (err) {
    console.error('Error initializing game state:', err);
  }
}
