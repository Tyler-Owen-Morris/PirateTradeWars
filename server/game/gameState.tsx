import { redisStorage } from "../redisStorage";
import { defaultPorts, goodTypes } from "./shipTypes";
import { v4 as uuidv4 } from "uuid";
import { MAP_WIDTH, MAP_HEIGHT } from "@shared/gameConstants";

export const TICK_RATE = 100; // ms (5 updates/second)
export const BROADCAST_RATE = 100; // ms (5 updates/second)
export const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const MAX_PLAYERS_PER_INSTANCE = 100;
export const GRACE_PERIOD = 600000; // 10 minutes

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

export interface GameStateData {
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
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

  async addPlayer(name: string, shipType: string, ship: any) {
    if (await redisStorage.isNameActive(name)) return null;
    const x = Math.random() * MAP_WIDTH;
    const z = Math.random() * MAP_HEIGHT;
    const uuid = uuidv4();

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
      gold: 500,
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
    await redisStorage.addActiveName(name);
    //await redisStorage.createPlayer(player);
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

    for (let i = 0; i < player.cannonCount; i++) {
      const offsetAngle = (i - (player.cannonCount - 1) / 2) * 0.1;
      const angle = player.rotationY + Math.PI / 2 + offsetAngle;
      const direction = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
      const cannonBall: CannonBall = {
        id: `${playerId}_${now}_${i}`,
        ownerId: playerId,
        damage: player.damage,
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

  async tick() {
    const now = Date.now();
    const deltaTime = (now - this.state.lastUpdate) / 1000;
    this.state.lastUpdate = now;

    for (const playerId in this.state.players) {
      const player = this.state.players[playerId];

      if (player.dead && now - player.lastSeen > 10000) {
        console.log(`Removing dead player ${player.name} (${playerId})`);
        await redisStorage.removeActiveName(player.name);
        delete this.state.players[playerId];
        continue;
      }

      if (!player.connected && !player.dead && now - player.lastSeen > GRACE_PERIOD) {
        console.log(`Marking player ${player.name} (${playerId}) as dead`);
        player.dead = true;
        await redisStorage.addToLeaderboard({ playerId: player.playerId, playerName: player.name, score: player.gold, achievedAt: new Date() });
        this.state.leaderboard = await redisStorage.getLeaderboard(10);
        this.broadcastDead(playerId);
        continue;
      }

      if (player.sunk || player.dead) continue;

      if (player.speed !== 0) {
        player.x += player.direction.x * player.speed * deltaTime * 60;
        player.z += player.direction.z * player.speed * deltaTime * 60;
        player.x = (player.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
        player.z = (player.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
      }
    }

    const cannonballs = this.state.cannonBalls;
    for (let i = cannonballs.length - 1; i >= 0; i--) {
      const ball = cannonballs[i];
      ball.x += ball.direction.x * ball.speed * deltaTime * 60;
      ball.y += ball.direction.y * ball.speed * deltaTime * 60;
      ball.z += ball.direction.z * ball.speed * deltaTime * 60;
      ball.x = (ball.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      ball.z = (ball.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;

      if (now - ball.created > 5000) {
        this.state.cannonBalls.splice(i, 1);
        continue;
      }

      for (const playerId in this.state.players) {
        const player = this.state.players[playerId];
        if (ball.ownerId === playerId || player.sunk || player.dead) continue;

        const dx = Math.min(Math.abs(ball.x - player.x), MAP_WIDTH - Math.abs(ball.x - player.x));
        const dz = Math.min(Math.abs(ball.z - player.z), MAP_HEIGHT - Math.abs(ball.z - player.z));
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < 20) {
          const armorFactor = 1 - this.getShipArmor(player.shipType) / 100;
          const damageDealt = Math.round(ball.damage * armorFactor);
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
          if (distance < 1000 || id === playerId) {
            nearbyPlayers[id] = otherPlayer;
          }
        }
      });

      const nearbyCannonBalls = this.state.cannonBalls.filter((ball) => {
        const dx = Math.min(Math.abs(player.x - ball.x), MAP_WIDTH - Math.abs(player.x - ball.x));
        const dz = Math.min(Math.abs(player.z - ball.z), MAP_HEIGHT - Math.abs(player.z - ball.z));
        return Math.sqrt(dx * dx + dz * dz) < 1000;
      });

      try {
        ws.send(JSON.stringify({
          type: "gameUpdate",
          players: nearbyPlayers,
          cannonBalls: nearbyCannonBalls,
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
    const speedMap: Record<string, number> = { "sloop": 5, "brigantine": 6, "galleon": 7, "man-o-war": 8 };
    return speedMap[shipType] || 5;
  }

  private getShipArmor(shipType: string): number {
    const armorMap: Record<string, number> = { "sloop": 0, "brigantine": 10, "galleon": 20, "man-o-war": 30 };
    return armorMap[shipType] || 0;
  }

  private getShipCannonRange(shipType: string): number {
    const rangeMap: Record<string, number> = {
      "sloop": 300,
      "brigantine": 250,
      "galleon": 200,
      "man-o-war": 150
    };
    return rangeMap[shipType] || 200;
  }

  private async handlePlayerSunk(player: PlayerState) {
    try {
      const leaderboardEntry = await redisStorage.addToLeaderboard({
        playerId: player.playerId,
        playerName: player.name,
        score: player.gold,
        achievedAt: new Date()
      });
      const leaderboard = await redisStorage.getLeaderboard(10);
      await this.updateLeaderboard(leaderboard);
      console.log(`Player ${player.name} sunk with score ${player.gold}`);
    } catch (err) {
      console.error("Error handling sunk player:", err);
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
      for (const port of defaultPorts) await redisStorage.createPort(port);
      console.log("Ports initialized");
    }
    const goods = await redisStorage.getGoods();
    if (goods.length === 0) {
      for (const good of goodTypes) await redisStorage.createGood(good);
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