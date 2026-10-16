import { redisStorage } from "../redisStorage";
import { defaultPorts, goodTypes } from "./shipTypes";
import { v4 as uuidv4 } from "uuid";
import { MAP_WIDTH, MAP_HEIGHT, SHIP_TYPES, SHIP_STATS, GOODS, DEFAULT_PORTS } from "@shared/gameConstants";
import { trackEvent, flushSegment } from "../segmentClient";

export const TICK_RATE = 100; // ms (5 updates/second)
export const BROADCAST_RATE = 100; // ms (5 updates/second)
export const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const MAX_PLAYERS = 1000;
export const GRACE_PERIOD = 60000; // 1 minute
export const GOLD_COLLECTION_RADIUS = 50;
export const GOLD_OBJECT_LIFETIME = 60 * 1000; // 1 minute

export interface PlayerState {
  id: string;
  playerId: string;
  name: string;
  shipType: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  speed: number;
  maxSpeed: number;
  direction: { x: number, y: number, z: number };
  hp: number;
  maxHp: number;
  gold: number;
  cargoCapacity: number;
  cargoUsed: number;
  repairCost: number;
  firing: boolean;
  canFire: boolean;
  lastFired: number;
  reloadTime: number;
  damage: number;
  cannonCount: number;
  sunk: boolean;
  connected: boolean;
  isActive: boolean;
  lastSeen: number;
  dead: boolean;
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
  range: number;
  created: number;
}

export interface GoldObject {
  id: string;
  x: number;
  y: number;
  z: number;
  gold: number;
  created: number;
}

export interface GameStateData {
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  goldObjects: GoldObject[];
  lastUpdate: number;
  activeNames: Set<string>;
  leaderboard: { id: number; playerId: string; playerName: string; score: number; achievedAt: Date }[];
}

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
      goldObjects: [],
      lastUpdate: Date.now(),
      activeNames: new Set(),
      leaderboard: [],
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
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval);
    this.tickInterval = this.broadcastInterval = this.priceUpdateInterval = null;
    console.log("Game stopped");
  }

  registerClient(playerId: string, ws: WebSocket) {
    this.connectedClients.set(playerId, ws);
  }

  removeClient(playerId: string) {
    this.connectedClients.delete(playerId);
    const player = this.state.players[playerId];
    if (player) {
      player.connected = false;
      player.lastSeen = Date.now();
    }
  }

  async addPlayer(name: string, shipType: string, ship: any, tempPlayerId?: string) {
    //console.log("addPlayer", name, shipType, ship);
    const reservedPlayerId = await redisStorage.getActiveNamePlayerId(name);
    if (reservedPlayerId && reservedPlayerId !== tempPlayerId) {
      console.log(`Name conflict: ${name} is reserved with ID ${reservedPlayerId}, but tempPlayerId is ${tempPlayerId}`);
      return null;
    }
    const x = Math.random() * MAP_WIDTH;
    const z = Math.random() * MAP_HEIGHT;
    //const x = 1194;
    //const z = 5685;
    const uuid = tempPlayerId || uuidv4();

    const player: PlayerState = {
      id: uuid,
      playerId: uuid,
      name,
      shipType,
      x,
      y: 0,
      z,
      rotationY: 0,
      speed: 0,
      maxSpeed: ship.speed,
      direction: { x: 0, y: 0, z: 1 },
      hp: ship.hullStrength,
      maxHp: ship.hullStrength,
      gold: SHIP_STATS[shipType].startingGold,
      cargoCapacity: ship.cargoCapacity,
      cargoUsed: 0,
      repairCost: ship.repairCost,
      firing: false,
      canFire: true,
      lastFired: 0,
      reloadTime: ship.cannonReload * 1000,
      damage: ship.cannonDamage,
      cannonCount: ship.cannonCount,
      sunk: false,
      connected: true,
      isActive: true,
      lastSeen: Date.now(),
      dead: false,
    };
    this.state.players[uuid] = player;
    return player;
  }

  updatePlayer(id: string, update: Partial<PlayerState>) {
    const player = this.state.players[id];
    if (player && !player.sunk && !player.dead) {
      if (update.rotationY !== undefined) player.rotationY = update.rotationY;
      if (update.speed !== undefined) player.speed = Math.min(update.speed, this.getShipSpeed(player.shipType));
      if (update.firing !== undefined) player.firing = update.firing;
      if (update.direction) {
        const magnitude = Math.sqrt(update.direction.x ** 2 + update.direction.y ** 2 + update.direction.z ** 2);
        if (magnitude > 0) {
          player.direction = {
            x: update.direction.x / magnitude,
            y: update.direction.y / magnitude,
            z: update.direction.z / magnitude,
          };
        }
      }
      player.connected = true;
      player.lastSeen = Date.now();
    }
  }

  fireCannonBall(playerId: string) {
    const player = this.state.players[playerId];
    if (!player || player.sunk || player.dead || !player.canFire) return;

    const now = Date.now();
    if (now - player.lastFired < player.reloadTime) return;

    player.canFire = false;
    player.lastFired = now;
    setTimeout(() => {
      if (this.state.players[playerId]) this.state.players[playerId].canFire = true;
    }, player.reloadTime);

    const shipType = this.state.players[playerId].shipType;
    const cannonRange = this.getShipCannonRange(shipType);
    const cannonDamage = this.getShipDamage(shipType);

    for (let i = 0; i < player.cannonCount; i++) {
      const offsetAngle = (i - (player.cannonCount - 1) / 2) * 0.1;
      const angle = player.rotationY + Math.PI / 2 + offsetAngle;
      const direction = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
      const cannonBall: CannonBall = {
        id: `${playerId}_${now}_${i}`,
        ownerId: playerId,
        damage: cannonDamage,
        x: player.x + direction.x * 10,
        y: 5,
        z: player.z + direction.z * 10,
        direction,
        speed: 15,
        range: cannonRange,
        created: now,
      };
      this.state.cannonBalls.push(cannonBall);
    }
  }

  private segmentIntersectsSphere(
    p0: { x: number, y: number, z: number },
    p1: { x: number, y: number, z: number },
    center: { x: number, y: number, z: number },
    r: number
  ): boolean {
    // d = p1 - p0
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    // f = p0 - center
    const fx = p0.x - center.x;
    const fy = p0.y - center.y;
    const fz = p0.z - center.z;

    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    const c = fx * fx + fy * fy + fz * fz - r * r;

    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;            // no real roots → miss
    const sqrtD = Math.sqrt(disc);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    // if either intersection point lies between p0 (t=0) and p1 (t=1), it hit
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
  }

  async tick() {
    const now = Date.now();
    const deltaTime = (now - this.state.lastUpdate) / 1000;
    this.state.lastUpdate = now;

    // handle player state updates
    for (const playerId in this.state.players) {
      const player = this.state.players[playerId];

      // if the player has been dead for 15 seconds, remove them from the active names
      if (player.dead && now - player.lastSeen > 15 * 1000) {
        console.log(`Removing dead player ${player.name} (${playerId})`);
        await redisStorage.removeActiveName(player.name);
        delete this.state.players[playerId];
        continue;
      }

      if (!player.connected && now - player.lastSeen > GRACE_PERIOD) {
        // update the record in redis, and remove the player from the game state
        console.log(`Removing disconnected player ${player.name} (${playerId})`);
        await redisStorage.updatePlayerState(player);
        delete this.state.players[playerId];
        continue;
      }

      // old disconnect logic marked the player as dead, we're not doing that anymore
      // if (!player.connected && !player.dead && now - player.lastSeen > GRACE_PERIOD) {
      //   console.log(`Marking player ${player.name} (${playerId}) as dead`);
      //   player.dead = true;
      //   await redisStorage.addToLeaderboard({ playerId: player.playerId, playerName: player.name, score: player.gold, achievedAt: new Date() });
      //   this.state.leaderboard = await redisStorage.getLeaderboard(10);
      //   this.broadcastDead(playerId);
      //   continue;
      // }

      if (player.sunk || player.dead) continue;

      if (player.speed !== 0) {
        player.x += player.direction.x * player.speed * deltaTime * 60;
        player.z += player.direction.z * player.speed * deltaTime * 60;
        player.x = (player.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
        player.z = (player.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
      }
    }

    // handle cannonball state updates
    const cannonballs = this.state.cannonBalls;
    for (let i = cannonballs.length - 1; i >= 0; i--) {
      const ball = cannonballs[i];

      // Skip if ball is null/undefined or has been removed
      if (!ball || ball.ownerId === null || ball.x === null || ball.y === null || ball.z === null) {
        continue;
      }

      // Store previous position before moving
      const prevPos = { x: ball.x, y: ball.y, z: ball.z };

      // Move the cannonball
      ball.x += ball.direction.x * ball.speed * deltaTime * 60;
      ball.y += ball.direction.y * ball.speed * deltaTime * 60;
      ball.z += ball.direction.z * ball.speed * deltaTime * 60;
      ball.x = (ball.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      ball.z = (ball.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;

      if (now - ball.created > 3000) {
        this.state.cannonBalls.splice(i, 1);
        continue;
      }

      for (const playerId in this.state.players) {
        const player = this.state.players[playerId];
        if (!player || ball.ownerId === playerId || player.sunk || player.dead) continue;

        // Use continuous collision detection
        const newPos = { x: ball.x, y: ball.y, z: ball.z };
        const shipCenter = { x: player.x, y: player.y, z: player.z };
        const hitRadius = 20; // Same as before, but now used for sphere radius

        if (this.segmentIntersectsSphere(prevPos, newPos, shipCenter, hitRadius)) {
          const armorFactor = 1 - this.getShipArmor(player.shipType) / 100;
          const damageDealt = Math.round(ball.damage * armorFactor);
          //console.log("damageDealt", damageDealt);
          player.hp -= damageDealt;
          if (player.hp <= 0) {
            player.hp = 0;
            player.sunk = true;
            await this.handlePlayerSunk(player);
          }
          this.state.cannonBalls.splice(i, 1);
          break;
        }
      }
    }

    // Handle gold objects
    for (let i = this.state.goldObjects.length - 1; i >= 0; i--) {
      const gold = this.state.goldObjects[i];

      // Check if gold object is expired (older than 1 minute)
      if (now - gold.created > GOLD_OBJECT_LIFETIME) {
        console.log("gold object expired", gold);
        this.state.goldObjects.splice(i, 1);
        continue;
      }

      // Check for player collisions
      for (const playerId in this.state.players) {
        const player = this.state.players[playerId];
        if (player.sunk || player.dead) continue; // Skip sunk or dead players

        const dx = Math.min(Math.abs(player.x - gold.x), MAP_WIDTH - Math.abs(player.x - gold.x));
        const dz = Math.min(Math.abs(player.z - gold.z), MAP_HEIGHT - Math.abs(player.z - gold.z));
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < GOLD_COLLECTION_RADIUS) {
          // update the player's gold in the game state
          player.gold += gold.gold;
          this.state.goldObjects.splice(i, 1); // Remove collected gold

          // update the player's gold in redis
          redisStorage.updatePlayerGold(playerId, player.gold);

          // Track gold collection
          trackEvent(playerId, 'Gold Collected', {
            goldAmount: gold.gold,
            newTotalGold: player.gold,
            x: gold.x,
            z: gold.z,
          });
          await flushSegment();

          // Notify the collecting player immediately
          const ws = this.connectedClients.get(playerId);
          let message = {
            type: "goldCollected",
            gold: gold.gold,
            newTotalGold: player.gold,
            timestamp: now,
          }
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(message));
          }
          break; // Exit player loop since gold was collected
        }
      }
    }
  }

  broadcast() {
    const clientEntries = Array.from(this.connectedClients.entries());
    for (const [playerId, ws] of clientEntries) {
      if (ws.readyState !== 1) continue;
      const player = this.state.players[playerId];
      if (!player) continue;

      const nearbyPlayers: Record<string, PlayerState> = {};
      Object.entries(this.state.players).forEach(([id, otherPlayer]) => {
        if (id === playerId || !otherPlayer.dead) {
          const dx = Math.min(Math.abs(player.x - otherPlayer.x), MAP_WIDTH - Math.abs(player.x - otherPlayer.x));
          const dz = Math.min(Math.abs(player.z - otherPlayer.z), MAP_HEIGHT - Math.abs(player.z - otherPlayer.z));
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < 2000 || id === playerId) {
            nearbyPlayers[id] = otherPlayer;
          }
        }
      });

      const nearbyCannonBalls = this.state.cannonBalls.filter((ball) => {
        const dx = Math.min(Math.abs(player.x - ball.x), MAP_WIDTH - Math.abs(player.x - ball.x));
        const dz = Math.min(Math.abs(player.z - ball.z), MAP_HEIGHT - Math.abs(player.z - ball.z));
        return Math.sqrt(dx * dx + dz * dz) < 1000;
      });

      // Calculate nearby gold objects (within 1000 units)
      //console.log("this.state.goldObjects:", this.state.goldObjects);
      const nearbyGoldObjects = this.state.goldObjects.filter((gold) => {
        const dx = Math.min(Math.abs(player.x - gold.x), MAP_WIDTH - Math.abs(player.x - gold.x));
        const dz = Math.min(Math.abs(player.z - gold.z), MAP_HEIGHT - Math.abs(player.z - gold.z));
        return Math.sqrt(dx * dx + dz * dz) < 1000;
      });

      try {
        ws.send(JSON.stringify({
          type: "gameUpdate",
          players: nearbyPlayers,
          cannonBalls: nearbyCannonBalls,
          goldObjects: nearbyGoldObjects,
          timestamp: Date.now(),
        }));
      } catch (err) {
        console.error(`Error sending to ${playerId}:`, err);
        this.removeClient(playerId);
      }
    }
  }

  broadcastDead(playerId: string) {
    const clientEntries = Array.from(this.connectedClients.entries());
    for (const [_, ws] of clientEntries) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "playerDead",
          id: playerId,
          players: this.state.players,
          timestamp: Date.now(),
        }));
      }
    }
  }

  async updatePrices() {
    try {
      const ports = await redisStorage.getPorts();
      const goods = await redisStorage.getGoods();
      for (const port of ports) {
        const portGoods = await redisStorage.getPortGoods(port.id);
        if (portGoods.length === 0) {
          console.log(`Port ${port.name} has no goods. Initializing...`);
          for (const good of goods) {
            const basePrice = good.basePrice;
            const fluctPercent = (Math.random() * 2 - 1) * good.fluctuation / 100;
            const initialPrice = Math.round(basePrice * (1 + fluctPercent));
            const initialStock = Math.floor(Math.random() * 50) + 50;
            await redisStorage.createPortGood({
              portId: port.id,
              goodId: good.id,
              currentPrice: initialPrice,
              stock: initialStock,
              updatedAt: new Date(),
            });
          }
          console.log(`Port ${port.name} goods initialized with ${goods.length} goods`);
          continue;
        }
        for (const portGood of portGoods) {
          const good = goods.find((g) => g.id === portGood.goodId);
          if (!good) continue;
          const fluctPercent = (Math.random() * 2 - 1) * good.fluctuation / 100;
          const newPrice = Math.round(good.basePrice * (1 + fluctPercent));
          await redisStorage.updatePortGoodPrice(port.id, portGood.goodId, newPrice);
          if (portGood.stock < 10) {
            const newStock = Math.floor(Math.random() * 30) + 20;
            await redisStorage.updatePortGoodStock(port.id, portGood.goodId, newStock);
            console.log(`Replenished stock of good ${good.name} at port ${port.name} to ${newStock} units`);
          }
        }
      }
      console.log("Port prices and stock updated");
    } catch (err) {
      console.error("Error updating prices and stock:", err);
    }
  }

  private getShipSpeed(shipType: string): number {
    //console.log("ship type-speed", shipType, SHIP_STATS[shipType]?.speed);
    return SHIP_STATS[shipType]?.speed || SHIP_STATS[SHIP_TYPES.SLOOP].speed;
  }

  private getShipArmor(shipType: string): number {
    //console.log("ship type-armor", shipType, SHIP_STATS[shipType]?.armor);
    return SHIP_STATS[shipType]?.armor || SHIP_STATS[SHIP_TYPES.SLOOP].armor;
  }

  private getShipCannonRange(shipType: string): number {
    return SHIP_STATS[shipType]?.cannonRange || SHIP_STATS[SHIP_TYPES.SLOOP].cannonRange;
  }

  private getShipDamage(shipType: string): number {
    return SHIP_STATS[shipType]?.cannonDamage || SHIP_STATS[SHIP_TYPES.SLOOP].cannonDamage;
  }

  private async handlePlayerSunk(player: PlayerState) {
    try {
      if (player.gold > 0) {

        const goldObject: GoldObject = {
          id: uuidv4(),
          x: player.x,
          y: player.y,
          z: player.z,
          gold: player.gold,
          created: Date.now(),
        };
        //console.log("CREATING goldObject", goldObject);
        this.state.goldObjects.push(goldObject);
      }
    } catch (e) {
      console.error("Error handling sunk player:", e);
    }
    // add the player to the leaderboard
    try {
      const leaderboardEntry = await redisStorage.addToLeaderboard({
        playerId: player.playerId,
        playerName: player.name,
        score: player.gold,
        achievedAt: new Date()
      });
      const leaderboardRaw = await redisStorage.getLeaderboard(10);
      const leaderboard = leaderboardRaw.map(entry => ({
        ...entry,
        playerId: entry.playerId ?? "", // or use a placeholder like "unknown"
      }));
      await this.updateLeaderboard(leaderboard);
      console.log(`Player ${player.name} sunk with score ${player.gold}`);
      // Track player sunk
      trackEvent(player.playerId, 'Player Sunk', {
        score: player.gold,
        gold: player.gold,
        x: player.x,
        z: player.z,
      });
      await flushSegment();
    } catch (err) {
      console.error("Error handling sunk player:", err);
    }

    try {
      await redisStorage.removePlayer(player.playerId);
    } catch (err) {
      console.warn("Error removing player:", err); // This is not necessarily an error, it's just that the player is not in the database, which can be from TTL
    }
  }

  async updateLeaderboard(leaderboard: { id: number; playerId: string; playerName: string; score: number; achievedAt: Date }[]) {
    this.state.leaderboard = leaderboard;
  }
}

export const gameState = new GameState();

export async function initializeGameState() {
  try {
    const ports = await redisStorage.getPorts();
    if (ports.length === 0) {
      for (const port of DEFAULT_PORTS) await redisStorage.createPort(port);
      console.log("Ports initialized");
    }
    const goods = await redisStorage.getGoods();
    if (goods.length === 0) {
      for (const good of GOODS) await redisStorage.createGood(good);
      console.log("Goods initialized");
    }
    for (const port of await redisStorage.getPorts()) {
      const portGoods = await redisStorage.getPortGoods(port.id);
      if (portGoods.length === 0) {
        for (const good of await redisStorage.getGoods()) {
          const basePrice = good.basePrice;
          const fluctPercent = (Math.random() * 2 - 1) * good.fluctuation / 100;
          const initialPrice = Math.round(basePrice * (1 + fluctPercent));
          const initialStock = Math.floor(Math.random() * 50) + 50;
          await redisStorage.createPortGood({
            portId: port.id,
            goodId: good.id,
            currentPrice: initialPrice,
            stock: initialStock,
            updatedAt: new Date(),
          });
        }
        console.log(`Port ${port.name} goods initialized with ${(await redisStorage.getGoods()).length} goods`);
      } else {
        for (const portGood of portGoods) {
          if (portGood.stock < 10) {
            const newStock = Math.floor(Math.random() * 30) + 20;
            await redisStorage.updatePortGoodStock(port.id, portGood.goodId, newStock);
            console.log(`Replenished stock of good ${portGood.goodId} at port ${port.id} to ${newStock} units`);
          }
        }
      }
    }
    gameState.start();
  } catch (err) {
    console.error("Error initializing game state:", err);
  }
}