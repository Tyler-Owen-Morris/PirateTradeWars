var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// server/index.ts
import express2 from "express";

// server/routes.tsx
import { createServer } from "http";

// server/redisStorage.tsx
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();
var RedisStorage = class {
  // 5 minutes in seconds
  constructor() {
    this.PLAYER_TTL = 24 * 60 * 60;
    // 24 hours in seconds
    this.INVENTORY_TTL = 24 * 60 * 60;
    // 24 hours in seconds
    this.ACTIVE_NAME_TTL = 5 * 60;
    const connString = process.env["REDIS_CONN_STRING"];
    if (!connString) {
      throw new Error("REDIS_CONN_STRING environment variable is required");
    }
    this.redis = new Redis(connString);
  }
  // User operations
  async getUser(id) {
    const data = await this.redis.hgetall(`user:${id}`);
    return data ? this.deserializeUser(data) : void 0;
  }
  async getUserByUsername(username) {
    const userId = await this.redis.smembers("usernames");
    for (const id of userId) {
      const user = await this.getUser(parseInt(id));
      if (user?.username === username) return user;
    }
    return void 0;
  }
  async createUser(user) {
    const id = await this.redis.incr("user:next_id");
    const newUser = { ...user, id };
    await this.redis.hmset(`user:${id}`, this.serializeUser(newUser));
    await this.redis.sadd("usernames", id.toString());
    return newUser;
  }
  // Player operations
  async getPlayer(id) {
    const data = await this.redis.hgetall(`player:${id}`);
    return data ? this.deserializePlayer(data) : void 0;
  }
  async getPlayerByName(name) {
    const playerId = await this.redis.smembers("player_names");
    for (const id of playerId) {
      const player = await this.getPlayer(parseInt(id));
      if (player?.name === name) return player;
    }
    return void 0;
  }
  async createPlayer(player) {
    const id = uuidv4();
    const newPlayer = { ...player, id };
    const multi = this.redis.multi();
    multi.hmset(`player:${id}`, this.serializePlayer(newPlayer));
    multi.expire(`player:${id}`, this.PLAYER_TTL);
    multi.set(`player_inventory:${id}`, JSON.stringify([]));
    multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
    multi.sadd("player_names", id);
    multi.sadd(`active_names:${newPlayer.name}`, "1");
    multi.expire(`active-names:${newPlayer.name}`, this.ACTIVE_NAME_TTL);
    await multi.exec();
    return newPlayer;
  }
  async updatePlayerGold(id, gold) {
    const multi = this.redis.multi();
    multi.hset(`player:${id}`, { "gold": gold });
    multi.expire(`player:${id}`, this.PLAYER_TTL);
    multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
    await multi.exec();
  }
  // Modified setPlayerActive
  async setPlayerActive(id, isActive) {
    const player_name = await this.redis.hget(`player:${id}`, "name");
    const multi = this.redis.multi();
    multi.hset(`player:${id}`, { "isActive": isActive.toString() });
    multi.expire(`player:${id}`, this.PLAYER_TTL);
    multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
    multi.set(`active_names:${player_name}}`, "1");
    multi.expire(`active_names:${player_name}`, this.ACTIVE_NAME_TTL);
    await multi.exec();
  }
  // Leaderboard operations
  async getLeaderboard(limit = 10) {
    const entries = await this.redis.zrevrange("leaderboard", 0, limit - 1, "WITHSCORES");
    const leaderboard = [];
    for (let i = 0; i < entries.length; i += 2) {
      const entryId = entries[i];
      const score = parseInt(entries[i + 1]);
      const entryData = await this.redis.hgetall(`leaderboard_entry:${entryId}`);
      if (entryData) {
        leaderboard.push({
          id: parseInt(entryId),
          playerId: entryData.playerId,
          playerName: entryData.playerName,
          score,
          achievedAt: new Date(entryData.achievedAt)
        });
      }
    }
    return leaderboard;
  }
  async addToLeaderboard(entry) {
    const id = await this.redis.incr("leaderboard:next_id");
    const newEntry = { ...entry, id };
    await this.redis.hmset(`leaderboard_entry:${id}`, {
      playerId: entry.playerId,
      playerName: entry.playerName,
      achievedAt: entry.achievedAt.toISOString()
    });
    await this.redis.zadd("leaderboard", entry.score, id.toString());
    return newEntry;
  }
  // Ship type operations
  async getShipTypes() {
    const shipTypes = await this.redis.hgetall("ship_types");
    const entries = Object.entries(shipTypes);
    const result = [];
    for (const [_, data] of entries) {
      const parsedData = JSON.parse(data);
      result.push(this.deserializeShipType(parsedData));
    }
    return result;
  }
  async getShipType(name) {
    const data = await this.redis.hget("ship_types", name);
    return data ? this.deserializeShipType(JSON.parse(data)) : void 0;
  }
  async createShipType(shipType) {
    const id = await this.redis.incr("ship_type:next_id");
    const newShipType = { ...shipType, id };
    await this.redis.hset("ship_types", shipType.name, JSON.stringify(newShipType));
    return newShipType;
  }
  // Port operations
  async getPorts() {
    const ports = await this.redis.hgetall("ports");
    const result = [];
    for (const [id, data] of Object.entries(ports)) {
      if (data) {
        const parsedData = JSON.parse(data);
        result.push(this.deserializePort(parsedData));
      }
    }
    return result;
  }
  async getPort(id) {
    const data = await this.redis.hget("ports", id.toString());
    if (!data) return void 0;
    const parsedData = JSON.parse(data);
    return this.deserializePort(parsedData);
  }
  // Port goods operations
  async getPortGoods(portId) {
    const data = await this.redis.get(`port:${portId}:goods`);
    if (!data) return [];
    return JSON.parse(data);
  }
  async updatePortGoodPrice(portId, goodId, price) {
    const portGoods = await this.getPortGoods(portId);
    const portGood = portGoods.find((pg) => pg.goodId === goodId);
    if (portGood) {
      portGood.currentPrice = price;
      portGood.updatedAt = /* @__PURE__ */ new Date();
      await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
    }
  }
  async updatePortGoodStock(portId, goodId, stock) {
    const portGoods = await this.getPortGoods(portId);
    const portGood = portGoods.find((pg) => pg.goodId === goodId);
    if (portGood) {
      portGood.stock = stock;
      portGood.updatedAt = /* @__PURE__ */ new Date();
      await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
    }
  }
  async createPortGood(portGood) {
    const id = await this.redis.incr("port_good:next_id");
    const newPortGood = { ...portGood, id };
    const portGoods = await this.getPortGoods(portGood.portId);
    portGoods.push(newPortGood);
    await this.redis.set(`port:${portGood.portId}:goods`, JSON.stringify(portGoods));
    return newPortGood;
  }
  // Player inventory operations
  async getPlayerInventory(playerId) {
    const data = await this.redis.get(`player_inventory:${playerId}`);
    const multi = this.redis.multi();
    multi.expire(`player_inventory:${playerId}`, this.INVENTORY_TTL);
    multi.expire(`player:${playerId}`, this.PLAYER_TTL);
    await multi.exec();
    this.setPlayerActive(playerId, true);
    return data ? JSON.parse(data) : [];
  }
  async updatePlayerInventory(playerId, goodId, quantity) {
    console.log("update player inventory called with playerid, goodId, quantity:", playerId, goodId, quantity);
    const inventory = await this.getPlayerInventory(playerId);
    const existingItemIndex = inventory.findIndex((item) => item.goodId === goodId);
    if (existingItemIndex >= 0) {
      if (quantity > 0) {
        inventory[existingItemIndex].quantity = quantity;
      } else {
        inventory.splice(existingItemIndex, 1);
      }
    } else if (quantity > 0) {
      inventory.push({ playerId, goodId, quantity });
    }
    const multi = this.redis.multi();
    multi.set(`player_inventory:${playerId}`, JSON.stringify(inventory));
    multi.expire(`player_inventory:${playerId}`, this.INVENTORY_TTL);
    multi.expire(`player:${playerId}`, this.PLAYER_TTL);
    this.setPlayerActive(playerId, true);
    await multi.exec();
  }
  // Game state operations
  async getGamePlayer(playerId) {
    return this.redis.hgetall(`game_player:${playerId}`);
  }
  async updateGamePlayer(playerId, data) {
    await this.redis.hmset(`game_player:${playerId}`, data);
  }
  async isNameActive(name) {
    return await this.redis.exists(`active_name:${name}`) === 1;
  }
  async getActiveNames() {
    const names = await this.redis.smembers("active_names");
    return new Set(names);
  }
  async addActiveName(name) {
    const multi = this.redis.multi();
    multi.set(`active_name:${name}`, "1");
    multi.expire(`active_name:${name}`, this.ACTIVE_NAME_TTL);
    await multi.exec();
  }
  async removeActiveName(name) {
    const multi = this.redis.multi();
    multi.del(`active_name:${name}`);
    await multi.exec();
  }
  // Serialization/deserialization helpers
  serializeUser(user) {
    return {
      id: user.id.toString(),
      username: user.username,
      password: user.password,
      createdAt: user.createdAt.toISOString()
    };
  }
  deserializeUser(data) {
    return {
      id: parseInt(data.id),
      username: data.username,
      password: data.password,
      createdAt: new Date(data.createdAt)
    };
  }
  serializePlayer(player) {
    const serialized = {
      id: player.id,
      userId: player.userId?.toString() || "",
      name: player.name,
      shipType: player.shipType,
      gold: player.gold.toString(),
      isActive: player.isActive.toString()
    };
    if (player.lastSeen instanceof Date) {
      serialized.lastSeen = player.lastSeen.toISOString();
    } else if (typeof player.lastSeen === "string") {
      try {
        serialized.lastSeen = new Date(player.lastSeen).toISOString();
      } catch {
        serialized.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
      }
    } else if (typeof player.lastSeen === "number") {
      serialized.lastSeen = new Date(player.lastSeen).toISOString();
    } else {
      serialized.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (player.x !== void 0) serialized.x = player.x.toString();
    if (player.z !== void 0) serialized.z = player.z.toString();
    if (player.rotationY !== void 0) serialized.rotationY = player.rotationY.toString();
    if (player.speed !== void 0) serialized.speed = player.speed.toString();
    if (player.hp !== void 0) serialized.hp = player.hp.toString();
    if (player.maxHp !== void 0) serialized.maxHp = player.maxHp.toString();
    if (player.cargoCapacity !== void 0) serialized.cargoCapacity = player.cargoCapacity.toString();
    if (player.cargoUsed !== void 0) serialized.cargoUsed = player.cargoUsed.toString();
    if (player.cannonCount !== void 0) serialized.cannonCount = player.cannonCount.toString();
    if (player.damage !== void 0) serialized.damage = player.damage.toString();
    if (player.reloadTime !== void 0) serialized.reloadTime = player.reloadTime.toString();
    return serialized;
  }
  deserializePlayer(data) {
    const player = {
      id: data.id,
      userId: data.userId && data.userId !== "" ? data.userId : null,
      name: data.name,
      shipType: data.shipType,
      gold: parseInt(data.gold) || 0,
      isActive: data.isActive === "1" || data.isActive === "true",
      lastSeen: new Date(data.lastSeen)
    };
    if (data.x !== void 0) player.x = parseFloat(data.x);
    if (data.z !== void 0) player.z = parseFloat(data.z);
    if (data.rotationY !== void 0) player.rotationY = parseFloat(data.rotationY);
    if (data.speed !== void 0) player.speed = parseFloat(data.speed);
    if (data.hp !== void 0) player.hp = parseInt(data.hp);
    if (data.maxHp !== void 0) player.maxHp = parseInt(data.maxHp);
    if (data.cargoCapacity !== void 0) player.cargoCapacity = parseInt(data.cargoCapacity);
    if (data.cargoUsed !== void 0) player.cargoUsed = parseInt(data.cargoUsed);
    if (data.cannonCount !== void 0) player.cannonCount = parseInt(data.cannonCount);
    if (data.damage !== void 0) player.damage = parseInt(data.damage);
    if (data.reloadTime !== void 0) player.reloadTime = parseInt(data.reloadTime);
    if (!(player.lastSeen instanceof Date) || isNaN(player.lastSeen.getTime())) {
      player.lastSeen = /* @__PURE__ */ new Date();
    }
    return player;
  }
  deserializeShipType(data) {
    return {
      ...data,
      id: parseInt(data.id),
      hullStrength: parseInt(data.hullStrength),
      armor: parseInt(data.armor),
      cargoCapacity: parseInt(data.cargoCapacity),
      speed: parseInt(data.speed),
      cannonCount: parseInt(data.cannonCount),
      cannonDamage: parseInt(data.cannonDamage),
      cannonReload: parseInt(data.cannonReload),
      repairCost: parseInt(data.repairCost),
      isPaid: data.isPaid === "true"
    };
  }
  deserializePort(data) {
    return {
      id: parseInt(data.id),
      name: data.name,
      x: parseInt(data.x),
      y: parseInt(data.y),
      z: parseInt(data.z),
      safeRadius: parseInt(data.safeRadius)
    };
  }
  deserializePortGood(data) {
    return {
      id: parseInt(data.id),
      portId: parseInt(data.portId),
      goodId: parseInt(data.goodId),
      currentPrice: parseInt(data.currentPrice),
      stock: parseInt(data.stock),
      updatedAt: new Date(data.updatedAt)
    };
  }
  async getGoods() {
    const goods = await this.redis.hgetall("goods");
    return Object.entries(goods).map(([id, data]) => {
      const parsed = JSON.parse(data);
      return {
        id: parseInt(id),
        name: parsed.name,
        basePrice: parsed.basePrice,
        fluctuation: parsed.fluctuation
      };
    });
  }
  async createGood(good) {
    const id = await this.redis.incr("good:next_id");
    const newGood = { ...good, id };
    await this.redis.hset("goods", id.toString(), JSON.stringify(newGood));
    return newGood;
  }
  async createPort(port) {
    const id = await this.redis.incr("port:next_id");
    const newPort = { ...port, id };
    await this.redis.hset("ports", id.toString(), JSON.stringify(newPort));
    return newPort;
  }
};
var redisStorage = new RedisStorage();

// server/routes.tsx
import { WebSocketServer } from "ws";

// server/game/shipTypes.tsx
var defaultShipTypes = [
  {
    name: "sloop",
    displayName: "The Sloop",
    description: "A small, rickety vessel for new pirates. Cheap but vulnerable, it's a starting point for all free players.",
    hullStrength: 50,
    armor: 0,
    cargoCapacity: 20,
    speed: 5,
    cannonCount: 1,
    cannonDamage: 5,
    cannonReload: 2,
    repairCost: 100,
    isPaid: false
  },
  {
    name: "brigantine",
    displayName: "The Brigantine",
    description: "A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.",
    hullStrength: 150,
    armor: 10,
    cargoCapacity: 40,
    speed: 6,
    cannonCount: 2,
    cannonDamage: 8,
    cannonReload: 1.8,
    repairCost: 300,
    isPaid: true
  },
  {
    name: "galleon",
    displayName: "The Galleon",
    description: "A formidable merchant vessel, blending cargo capacity with combat strength.",
    hullStrength: 300,
    armor: 20,
    cargoCapacity: 60,
    speed: 7,
    cannonCount: 3,
    cannonDamage: 12,
    cannonReload: 1.5,
    repairCost: 600,
    isPaid: true
  },
  {
    name: "man-o-war",
    displayName: "The Man-o'-War",
    description: "The ultimate warship, a terror of the seas built for dominance.",
    hullStrength: 500,
    armor: 30,
    cargoCapacity: 80,
    speed: 8,
    cannonCount: 4,
    cannonDamage: 15,
    cannonReload: 1.2,
    repairCost: 1e3,
    isPaid: true
  }
];
var goodTypes = [
  { name: "Fish", basePrice: 10, fluctuation: 20 },
  { name: "Wood", basePrice: 15, fluctuation: 10 },
  { name: "Sugar", basePrice: 30, fluctuation: 25 },
  { name: "Cotton", basePrice: 40, fluctuation: 20 },
  { name: "Rum", basePrice: 50, fluctuation: 30 },
  { name: "Tobacco", basePrice: 60, fluctuation: 35 },
  { name: "Spices", basePrice: 80, fluctuation: 40 },
  { name: "Silk", basePrice: 100, fluctuation: 50 }
];
var defaultPorts = [
  { name: "Tortuga", x: 1e3, y: 0, z: 1200, safeRadius: 200 },
  { name: "Port Royale", x: 4e3, y: 0, z: 300, safeRadius: 200 },
  { name: "Nassau", x: 2500, y: 0, z: 4500, safeRadius: 200 },
  { name: "Havana", x: 4200, y: 0, z: 4e3, safeRadius: 200 },
  { name: "Kingston", x: 800, y: 0, z: 3500, safeRadius: 200 },
  { name: "Santo Domingo", x: 2800, y: 0, z: 1500, safeRadius: 200 },
  { name: "Barbados", x: 1500, y: 0, z: 2500, safeRadius: 200 },
  { name: "Puerto Rico", x: 3500, y: 0, z: 2800, safeRadius: 200 }
];
async function setupShipTypes() {
  try {
    const existingShipTypes = await redisStorage.getShipTypes();
    if (existingShipTypes.length === 0) {
      console.log("Initializing ship types...");
      for (const shipType of defaultShipTypes) {
        await redisStorage.createShipType(shipType);
      }
      console.log("Ship types initialized");
    }
  } catch (err) {
    console.error("Error initializing ship types:", err);
  }
}

// server/game/gameState.tsx
import { v4 as uuidv42 } from "uuid";

// shared/gameConstants.ts
var MAP_WIDTH = 1e4;
var MAP_HEIGHT = 1e4;
var SHIP_TYPES = {
  SLOOP: "sloop",
  BRIGANTINE: "brigantine",
  GALLEON: "galleon",
  MAN_O_WAR: "man-o-war"
};
var SHIP_DISPLAY_NAMES = {
  [SHIP_TYPES.SLOOP]: "The Sloop",
  [SHIP_TYPES.BRIGANTINE]: "The Brigantine",
  [SHIP_TYPES.GALLEON]: "The Galleon",
  [SHIP_TYPES.MAN_O_WAR]: "The Man-o'-War"
};
var SHIP_DESCRIPTIONS = {
  [SHIP_TYPES.SLOOP]: "A small, rickety vessel for new pirates. Cheap but vulnerable, it's a starting point for all free players.",
  [SHIP_TYPES.BRIGANTINE]: "A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.",
  [SHIP_TYPES.GALLEON]: "A formidable merchant vessel, blending cargo capacity with combat strength.",
  [SHIP_TYPES.MAN_O_WAR]: "The ultimate warship, a terror of the seas built for dominance."
};
var SHIP_STATS = {
  [SHIP_TYPES.SLOOP]: {
    hullStrength: 50,
    armor: 5,
    cargoCapacity: 20,
    speed: 6,
    cannonCount: 1,
    cannonDamage: 5,
    cannonReload: 2,
    cannonRange: 300,
    repairCost: 100,
    isPaid: false
  },
  [SHIP_TYPES.BRIGANTINE]: {
    hullStrength: 150,
    armor: 10,
    cargoCapacity: 40,
    speed: 5,
    cannonCount: 2,
    cannonDamage: 8,
    cannonReload: 1.8,
    cannonRange: 250,
    repairCost: 300,
    isPaid: true
  },
  [SHIP_TYPES.GALLEON]: {
    hullStrength: 300,
    armor: 15,
    cargoCapacity: 60,
    speed: 4,
    cannonCount: 3,
    cannonDamage: 12,
    cannonReload: 1.5,
    cannonRange: 200,
    repairCost: 600,
    isPaid: true
  },
  [SHIP_TYPES.MAN_O_WAR]: {
    hullStrength: 500,
    armor: 20,
    cargoCapacity: 80,
    speed: 3.5,
    cannonCount: 4,
    cannonDamage: 15,
    cannonReload: 1.2,
    cannonRange: 150,
    repairCost: 1e3,
    isPaid: true
  }
};

// server/game/gameState.tsx
var TICK_RATE = 100;
var BROADCAST_RATE = 100;
var PRICE_UPDATE_INTERVAL = 5 * 60 * 1e3;
var GRACE_PERIOD = 6e5;
var GameState = class {
  constructor() {
    this.state = {
      players: {},
      cannonBalls: [],
      lastUpdate: Date.now(),
      activeNames: /* @__PURE__ */ new Set(),
      leaderboard: []
    };
    this.tickInterval = null;
    this.broadcastInterval = null;
    this.priceUpdateInterval = null;
    this.connectedClients = /* @__PURE__ */ new Map();
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
  registerClient(playerId, ws) {
    this.connectedClients.set(playerId, ws);
  }
  removeClient(playerId) {
    this.connectedClients.delete(playerId);
    const player = this.state.players[playerId];
    if (player) {
      player.connected = false;
      player.lastSeen = Date.now();
    }
  }
  async addPlayer(name, shipType, ship) {
    if (await redisStorage.isNameActive(name)) return null;
    const x = Math.random() * MAP_WIDTH;
    const z = Math.random() * MAP_HEIGHT;
    const uuid = uuidv42();
    const player = {
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
      reloadTime: ship.cannonReload * 1e3,
      damage: ship.cannonDamage,
      cannonCount: ship.cannonCount,
      sunk: false,
      connected: true,
      isActive: true,
      lastSeen: Date.now(),
      dead: false
    };
    this.state.players[uuid] = player;
    await redisStorage.addActiveName(name);
    return player;
  }
  updatePlayer(id, update) {
    const player = this.state.players[id];
    if (player && !player.sunk && !player.dead) {
      if (update.rotationY !== void 0) player.rotationY = update.rotationY;
      if (update.speed !== void 0) player.speed = Math.min(update.speed, this.getShipSpeed(player.shipType));
      if (update.firing !== void 0) player.firing = update.firing;
      if (update.direction) {
        const magnitude = Math.sqrt(update.direction.x ** 2 + update.direction.y ** 2 + update.direction.z ** 2);
        if (magnitude > 0) {
          player.direction = {
            x: update.direction.x / magnitude,
            y: update.direction.y / magnitude,
            z: update.direction.z / magnitude
          };
        }
      }
      player.connected = true;
      player.lastSeen = Date.now();
    }
  }
  fireCannonBall(playerId) {
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
      const cannonBall = {
        id: `${playerId}_${now}_${i}`,
        ownerId: playerId,
        damage: cannonDamage,
        x: player.x + direction.x * 10,
        y: 5,
        z: player.z + direction.z * 10,
        direction,
        speed: 15,
        range: cannonRange,
        created: now
      };
      this.state.cannonBalls.push(cannonBall);
    }
  }
  segmentIntersectsSphere(p0, p1, center, r) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const fx = p0.x - center.x;
    const fy = p0.y - center.y;
    const fz = p0.z - center.z;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    const c = fx * fx + fy * fy + fz * fz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sqrtD = Math.sqrt(disc);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    return t1 >= 0 && t1 <= 1 || t2 >= 0 && t2 <= 1;
  }
  async tick() {
    const now = Date.now();
    const deltaTime = (now - this.state.lastUpdate) / 1e3;
    this.state.lastUpdate = now;
    for (const playerId in this.state.players) {
      const player = this.state.players[playerId];
      if (player.dead && now - player.lastSeen > 1e4) {
        console.log(`Removing dead player ${player.name} (${playerId})`);
        await redisStorage.removeActiveName(player.name);
        delete this.state.players[playerId];
        continue;
      }
      if (!player.connected && !player.dead && now - player.lastSeen > GRACE_PERIOD) {
        console.log(`Marking player ${player.name} (${playerId}) as dead`);
        player.dead = true;
        await redisStorage.addToLeaderboard({ playerId: player.playerId, playerName: player.name, score: player.gold, achievedAt: /* @__PURE__ */ new Date() });
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
      const prevPos = { x: ball.x, y: ball.y, z: ball.z };
      ball.x += ball.direction.x * ball.speed * deltaTime * 60;
      ball.y += ball.direction.y * ball.speed * deltaTime * 60;
      ball.z += ball.direction.z * ball.speed * deltaTime * 60;
      ball.x = (ball.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      ball.z = (ball.z % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
      if (now - ball.created > 3e3) {
        this.state.cannonBalls.splice(i, 1);
        continue;
      }
      for (const playerId in this.state.players) {
        const player = this.state.players[playerId];
        if (ball.ownerId === playerId || player.sunk || player.dead) continue;
        const newPos = { x: ball.x, y: ball.y, z: ball.z };
        const shipCenter = { x: player.x, y: player.y, z: player.z };
        const hitRadius = 20;
        if (this.segmentIntersectsSphere(prevPos, newPos, shipCenter, hitRadius)) {
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
      const nearbyPlayers = {};
      Object.entries(this.state.players).forEach(([id, otherPlayer]) => {
        if (id === playerId || !otherPlayer.dead) {
          const dx = Math.min(Math.abs(player.x - otherPlayer.x), MAP_WIDTH - Math.abs(player.x - otherPlayer.x));
          const dz = Math.min(Math.abs(player.z - otherPlayer.z), MAP_HEIGHT - Math.abs(player.z - otherPlayer.z));
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < 1e3 || id === playerId) {
            nearbyPlayers[id] = otherPlayer;
          }
        }
      });
      const nearbyCannonBalls = this.state.cannonBalls.filter((ball) => {
        const dx = Math.min(Math.abs(player.x - ball.x), MAP_WIDTH - Math.abs(player.x - ball.x));
        const dz = Math.min(Math.abs(player.z - ball.z), MAP_HEIGHT - Math.abs(player.z - ball.z));
        return Math.sqrt(dx * dx + dz * dz) < 1e3;
      });
      try {
        ws.send(JSON.stringify({
          type: "gameUpdate",
          players: nearbyPlayers,
          cannonBalls: nearbyCannonBalls,
          timestamp: Date.now()
        }));
      } catch (err) {
        console.error(`Error sending to ${playerId}:`, err);
        this.removeClient(playerId);
      }
    }
  }
  broadcastDead(playerId) {
    const clientEntries = Array.from(this.connectedClients.entries());
    for (const [_, ws] of clientEntries) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "playerDead",
          id: playerId,
          players: this.state.players,
          timestamp: Date.now()
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
              updatedAt: /* @__PURE__ */ new Date()
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
  getShipSpeed(shipType) {
    return SHIP_STATS[shipType]?.speed || SHIP_STATS[SHIP_TYPES.SLOOP].speed;
  }
  getShipArmor(shipType) {
    return SHIP_STATS[shipType]?.armor || SHIP_STATS[SHIP_TYPES.SLOOP].armor;
  }
  getShipCannonRange(shipType) {
    return SHIP_STATS[shipType]?.cannonRange || SHIP_STATS[SHIP_TYPES.SLOOP].cannonRange;
  }
  getShipDamage(shipType) {
    return SHIP_STATS[shipType]?.cannonDamage || SHIP_STATS[SHIP_TYPES.SLOOP].cannonDamage;
  }
  async handlePlayerSunk(player) {
    try {
      const leaderboardEntry = await redisStorage.addToLeaderboard({
        playerId: player.playerId,
        playerName: player.name,
        score: player.gold,
        achievedAt: /* @__PURE__ */ new Date()
      });
      const leaderboard = await redisStorage.getLeaderboard(10);
      await this.updateLeaderboard(leaderboard);
      console.log(`Player ${player.name} sunk with score ${player.gold}`);
    } catch (err) {
      console.error("Error handling sunk player:", err);
    }
  }
  async updateLeaderboard(leaderboard) {
    this.state.leaderboard = leaderboard;
  }
};
var gameState = new GameState();
async function initializeGameState() {
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
            updatedAt: /* @__PURE__ */ new Date()
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

// server/game/socketHandler.tsx
import { WebSocket } from "ws";
function handleSocketConnection(ws) {
  let playerId = null;
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
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
  async function handleConnect(ws2, data) {
    console.log("connection attempt");
    if (!data.name || data.name.trim().length < 3) {
      return sendError(ws2, "Name must be at least 3 characters");
    }
    if (await redisStorage.isNameActive(data.name)) {
      return sendError(ws2, "Name already in use by an active player", "nameError");
    }
    const shipType = await redisStorage.getShipType(data.shipType);
    if (!shipType) {
      return sendError(ws2, "Invalid ship type");
    }
    const addedPlayer = await gameState.addPlayer(data.name, data.shipType, shipType);
    if (!addedPlayer) {
      return sendError(ws2, "Failed to add player due to name conflict");
    } else {
      await redisStorage.createPlayer(addedPlayer);
    }
    gameState.registerClient(addedPlayer.id, ws2);
    await redisStorage.addActiveName(data.name);
    ws2.send(JSON.stringify({
      type: "connected",
      playerId: addedPlayer.id,
      name: data.name,
      ship: shipType,
      gold: addedPlayer.gold,
      players: gameState.state.players,
      cannonBalls: gameState.state.cannonBalls,
      timestamp: Date.now()
    }));
    console.log(`Player ${addedPlayer.name} connected with ID ${addedPlayer.id}`);
  }
  async function handleReconnect(ws2, data) {
    const existingPlayer = gameState.state.players[data.id];
    if (!existingPlayer) {
      return sendError(ws2, "Player ID not found");
    }
    if (data.name !== existingPlayer.name && await redisStorage.isNameActive(data.name)) {
      return sendError(ws2, "Name already in use by an active player", "nameError");
    }
    playerId = data.id;
    if (data.name !== existingPlayer.name) {
      await redisStorage.removeActiveName(existingPlayer.name);
      existingPlayer.name = data.name;
      await redisStorage.addActiveName(data.name);
    }
    existingPlayer.connected = true;
    existingPlayer.lastSeen = Date.now();
    gameState.registerClient(playerId, ws2);
    ws2.send(JSON.stringify({
      type: "reconnected",
      playerId,
      name: existingPlayer.name,
      ship: await redisStorage.getShipType(existingPlayer.shipType),
      gold: existingPlayer.gold,
      players: gameState.state.players,
      cannonBalls: gameState.state.cannonBalls,
      timestamp: Date.now()
    }));
    console.log(`Player ${existingPlayer.name} reconnected with ID ${playerId}`);
  }
  function handleInput(playerId2, data) {
    const updateData = {
      ...data.rotationY !== void 0 && { rotationY: data.rotationY },
      ...data.speed !== void 0 && { speed: data.speed },
      ...data.direction && { direction: data.direction },
      ...data.firing !== void 0 && { firing: data.firing }
    };
    gameState.updatePlayer(playerId2, updateData);
    if (data.firing) gameState.fireCannonBall(playerId2);
  }
  async function handleTrade(playerId2, data) {
    console.log("socket starting trade.");
    const player = gameState.state.players[playerId2];
    if (!player || player.dead) return;
    const port = await redisStorage.getPort(data.portId);
    if (!port) return sendError(ws, "Port not found");
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
      ws.send(JSON.stringify({
        type: "tradeSuccess",
        action: "buy",
        good: portGood.goodId,
        quantity: data.quantity,
        price: portGood.currentPrice,
        totalCost,
        gold: player.gold,
        inventory: updatedInventory,
        timestamp: Date.now()
      }));
    } else if (data.action === "sell") {
      if (currentQuantity < data.quantity) return sendError(ws, "Not enough goods to sell");
      const totalEarnings = portGood.currentPrice * data.quantity;
      player.gold += totalEarnings;
      player.cargoUsed -= data.quantity;
      await redisStorage.updatePlayerInventory(player.playerId, data.goodId, currentQuantity - data.quantity);
      await redisStorage.updatePlayerGold(player.playerId, player.gold);
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
        timestamp: Date.now()
      }));
    }
    await redisStorage.updatePlayerGold(player.playerId, player.gold);
  }
  async function handleScuttle(playerId2, ws2) {
    const player = gameState.state.players[playerId2];
    if (!player) return sendError(ws2, "Player not found");
    let post_scuttle_gold = player.gold - 500;
    console.log(`Player ${player.name} scuttled their ship with score ${post_scuttle_gold}`);
    const leaderboardEntry = await redisStorage.addToLeaderboard({
      playerId: player.playerId,
      playerName: player.name,
      score: post_scuttle_gold,
      achievedAt: /* @__PURE__ */ new Date()
    });
    const leaderboard = await redisStorage.getLeaderboard(10);
    await gameState.updateLeaderboard(leaderboard);
    if (ws2.readyState === WebSocket.OPEN) {
      ws2.send(JSON.stringify({
        type: "gameEnd",
        reason: "scuttle",
        score: post_scuttle_gold,
        message: "You scuttled your ship and joined the leaderboard!",
        leaderboard,
        timestamp: Date.now()
      }));
      setTimeout(() => {
        if (ws2.readyState === WebSocket.OPEN) {
          ws2.close();
        }
      }, 1e3);
    }
    await redisStorage.removeActiveName(player.name);
    delete gameState.state.players[playerId2];
    gameState.removeClient(playerId2);
    await redisStorage.setPlayerActive(player.playerId, false);
  }
}
function sendError(ws, message, type = "error") {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, message, timestamp: Date.now() }));
  }
}

// server/routes.tsx
import crypto from "crypto";
import { autoscaling } from "aws-sdk";
function generateServerId() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
}
async function registerRoutes(app2) {
  await setupShipTypes();
  await initializeGameState();
  app2.post("/start-game", async (req, res) => {
    const AWS = __require("aws-sdk");
    const autoscaling2 = new AWS.AutoScaling({ region: "us-east-2" });
    await autoscaling2.updateAutoScalingGroup({
      AutoScalingGroupName: "PirateTradeWarsGameAsg",
      DesiredCapacity: 1
    }).promise();
    const serverId = generateServerId();
    res.json({ wsUrl: `wss://piratetradewars.com/server-${serverId}` });
  });
  app2.post("/no-players", async (req, res) => {
    await autoscaling.updateAutoScalingGroup({
      AutoScalingGroupName: "PirateTradeWarsGameAsg",
      DesiredCapacity: 0
    }).promise();
    res.sendStatus(200);
  });
  app2.get("/api/health", (req, res) => {
    res.json({ status: "healthy" });
  });
  app2.post("/api/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    try {
      const existingUser = await redisStorage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");
      const user = await redisStorage.createUser({
        username,
        password: hashedPassword
      });
      res.status(201).json({ id: user.id, username: user.username });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });
  app2.get("/api/check-player-name", async (req, res) => {
    const { name } = req.query;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "Player name is required" });
    }
    try {
      const player = await redisStorage.getPlayerByName(name);
      res.json({ available: !player });
    } catch (error) {
      console.error("Error checking player name:", error);
      res.status(500).json({ message: "Failed to check player name" });
    }
  });
  app2.get("/api/ship-types", async (req, res) => {
    try {
      const shipTypes = await redisStorage.getShipTypes();
      res.json(shipTypes);
    } catch (error) {
      console.error("Error fetching ship types:", error);
      res.status(500).json({ message: "Failed to fetch ship types" });
    }
  });
  app2.get("/api/leaderboard", async (req, res) => {
    try {
      const leaderboard = await redisStorage.getLeaderboard();
      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });
  app2.get("/api/ports", async (req, res) => {
    try {
      const ports = await redisStorage.getPorts();
      res.json(ports);
    } catch (error) {
      console.error("Error fetching ports:", error);
      res.status(500).json({ message: "Failed to fetch ports" });
    }
  });
  app2.get("/api/goods", async (req, res) => {
    try {
      const goods = await redisStorage.getGoods();
      res.json(goods);
    } catch (error) {
      console.error("Error fetching goods:", error);
      res.status(500).json({ message: "Failed to fetch goods" });
    }
  });
  app2.get("/api/ports/:portId/goods", async (req, res) => {
    const portId = parseInt(req.params.portId);
    if (isNaN(portId)) {
      return res.status(400).json({ message: "Invalid port ID" });
    }
    try {
      const portGoods = await redisStorage.getPortGoods(portId);
      if (portGoods.length === 0) {
        console.log(`Port ${portId} has no goods, triggering price update`);
        await gameState.updatePrices();
        const updatedGoods = await redisStorage.getPortGoods(portId);
        res.json(updatedGoods);
      } else {
        res.json(portGoods);
      }
    } catch (error) {
      console.error("Error fetching port goods:", error);
      res.status(500).json({ message: "Failed to fetch port goods" });
    }
  });
  app2.get("/api/players/:playerId/inventory", async (req, res) => {
    console.log(req.params);
    const playerId = req.params.playerId;
    if (!playerId) {
      return res.status(400).json({ message: "Invalid player ID" });
    }
    try {
      console.log("get player inventory route called with passed param:", playerId);
      const inventory = await redisStorage.getPlayerInventory(playerId);
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching player inventory:", error);
      res.status(500).json({ message: "Failed to fetch player inventory" });
    }
  });
  app2.put("/api/players/:playerId/inventory", async (req, res) => {
    const playerId = req.params.playerId;
    const inventory = req.body;
    if (!playerId) {
      return res.status(400).json({ message: "Invalid player ID" });
    }
    if (!Array.isArray(inventory)) {
      return res.status(400).json({ message: "Inventory must be an array" });
    }
    try {
      for (const item of inventory) {
        await redisStorage.updatePlayerInventory(parseInt(playerId), item.goodId, item.quantity);
      }
      res.json({ success: true, message: "Inventory updated successfully" });
    } catch (error) {
      console.error("Error updating player inventory:", error);
      res.status(500).json({ message: "Failed to update player inventory" });
    }
  });
  app2.post("/api/update-prices", async (req, res) => {
    try {
      await gameState.updatePrices();
      res.json({ success: true, message: "Port prices and stock updated successfully" });
    } catch (error) {
      console.error("Error updating prices:", error);
      res.status(500).json({ message: "Failed to update prices and stock" });
    }
  });
  const httpServer = createServer(app2);
  const wss = new WebSocketServer({
    noServer: true
  });
  wss.on("connection", (ws) => {
    console.log("New WebSocket connection to game server");
    handleSocketConnection(ws);
  });
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url === "/game-ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2, { dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";
import glsl from "vite-plugin-glsl";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    glsl()
    // Add GLSL shader support
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true
  },
  // Add support for large models and audio files
  assetsInclude: ["**/*.gltf", "**/*.glb", "**/*.mp3", "**/*.ogg", "**/*.wav"]
});

// server/vite.ts
import { nanoid } from "nanoid";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        __dirname2,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(__dirname2, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    console.error("Server error:", err);
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = 5e3;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
