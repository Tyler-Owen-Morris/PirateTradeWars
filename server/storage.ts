import {
  users,
  players,
  leaderboard,
  shipTypes,
  ports,
  goods,
  portGoods,
  playerInventory,
  type User,
  type InsertUser,
  type Player,
  type InsertPlayer,
  type Leaderboard,
  type InsertLeaderboard,
  type ShipType,
  type Port,
  type Good,
  type PortGood,
  type PlayerInventory
} from "@shared/schema";

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Player operations
  getPlayer(id: number): Promise<Player | undefined>;
  getPlayerByName(name: string): Promise<Player | undefined>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayerGold(id: number, gold: number): Promise<Player | undefined>;
  updatePlayerShipType(id: number, shipType: string): Promise<Player | undefined>;
  setPlayerActive(id: number, isActive: boolean): Promise<void>;
  
  // Ship operations
  getShipTypes(): Promise<ShipType[]>;
  getShipType(name: string): Promise<ShipType | undefined>;
  createShipType(shipType: Omit<ShipType, 'id'>): Promise<ShipType>;
  
  // Port operations
  getPorts(): Promise<Port[]>;
  getPort(id: number): Promise<Port | undefined>;
  createPort(port: Omit<Port, 'id'>): Promise<Port>;
  
  // Goods operations
  getGoods(): Promise<Good[]>;
  getGood(id: number): Promise<Good | undefined>;
  createGood(good: Omit<Good, 'id'>): Promise<Good>;
  
  // Port goods operations
  getPortGoods(portId: number): Promise<PortGood[]>;
  updatePortGoodPrice(id: number, price: number): Promise<PortGood | undefined>;
  
  // Player inventory operations
  getPlayerInventory(playerId: number): Promise<PlayerInventory[]>;
  updatePlayerInventory(playerId: number, goodId: number, quantity: number): Promise<void>;
  
  // Leaderboard operations
  getLeaderboard(limit?: number): Promise<Leaderboard[]>;
  addToLeaderboard(entry: InsertLeaderboard): Promise<Leaderboard>;
}

// In-memory storage implementation
export class MemStorage implements IStorage {
  private usersMap: Map<number, User>;
  private playersMap: Map<number, Player>;
  private leaderboardList: Leaderboard[];
  private shipTypesMap: Map<string, ShipType>;
  private portsMap: Map<number, Port>;
  private goodsMap: Map<number, Good>;
  private portGoodsMap: Map<number, PortGood[]>;
  private playerInventoryMap: Map<number, Map<number, PlayerInventory>>;
  
  private userId: number;
  private playerId: number;
  private leaderboardId: number;
  private shipTypeId: number;
  private portId: number;
  private goodId: number;
  private portGoodId: number;

  constructor() {
    this.usersMap = new Map();
    this.playersMap = new Map();
    this.leaderboardList = [];
    this.shipTypesMap = new Map();
    this.portsMap = new Map();
    this.goodsMap = new Map();
    this.portGoodsMap = new Map();
    this.playerInventoryMap = new Map();
    
    this.userId = 1;
    this.playerId = 1;
    this.leaderboardId = 1;
    this.shipTypeId = 1;
    this.portId = 1;
    this.goodId = 1;
    this.portGoodId = 1;
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.usersMap.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.usersMap.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userId++;
    const now = new Date();
    const user: User = { ...insertUser, id, createdAt: now };
    this.usersMap.set(id, user);
    return user;
  }

  // Player operations
  async getPlayer(id: number): Promise<Player | undefined> {
    return this.playersMap.get(id);
  }

  async getPlayerByName(name: string): Promise<Player | undefined> {
    return Array.from(this.playersMap.values()).find(
      (player) => player.name === name,
    );
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const id = this.playerId++;
    const now = new Date();
    const player: Player = { 
      ...insertPlayer, 
      id, 
      gold: 500, 
      isActive: true, 
      lastSeen: now 
    };
    this.playersMap.set(id, player);
    
    // Initialize empty inventory for the player
    this.playerInventoryMap.set(id, new Map());
    
    return player;
  }

  async updatePlayerGold(id: number, gold: number): Promise<Player | undefined> {
    const player = this.playersMap.get(id);
    if (!player) return undefined;
    
    player.gold = gold;
    player.lastSeen = new Date();
    this.playersMap.set(id, player);
    
    return player;
  }

  async updatePlayerShipType(id: number, shipType: string): Promise<Player | undefined> {
    const player = this.playersMap.get(id);
    if (!player) return undefined;
    
    player.shipType = shipType;
    player.lastSeen = new Date();
    this.playersMap.set(id, player);
    
    return player;
  }

  async setPlayerActive(id: number, isActive: boolean): Promise<void> {
    const player = this.playersMap.get(id);
    if (!player) return;
    
    player.isActive = isActive;
    player.lastSeen = new Date();
    this.playersMap.set(id, player);
  }

  // Ship operations
  async getShipTypes(): Promise<ShipType[]> {
    return Array.from(this.shipTypesMap.values());
  }

  async getShipType(name: string): Promise<ShipType | undefined> {
    return this.shipTypesMap.get(name);
  }

  async createShipType(shipType: Omit<ShipType, 'id'>): Promise<ShipType> {
    const id = this.shipTypeId++;
    const newShipType: ShipType = { ...shipType, id };
    this.shipTypesMap.set(shipType.name, newShipType);
    return newShipType;
  }

  // Port operations
  async getPorts(): Promise<Port[]> {
    return Array.from(this.portsMap.values());
  }

  async getPort(id: number): Promise<Port | undefined> {
    return this.portsMap.get(id);
  }

  async createPort(port: Omit<Port, 'id'>): Promise<Port> {
    const id = this.portId++;
    const newPort: Port = { ...port, id };
    this.portsMap.set(id, newPort);
    
    // Initialize empty port goods
    this.portGoodsMap.set(id, []);
    
    return newPort;
  }

  // Goods operations
  async getGoods(): Promise<Good[]> {
    return Array.from(this.goodsMap.values());
  }

  async getGood(id: number): Promise<Good | undefined> {
    return this.goodsMap.get(id);
  }

  async createGood(good: Omit<Good, 'id'>): Promise<Good> {
    const id = this.goodId++;
    const newGood: Good = { ...good, id };
    this.goodsMap.set(id, newGood);
    return newGood;
  }

  // Port goods operations
  async getPortGoods(portId: number): Promise<PortGood[]> {
    return this.portGoodsMap.get(portId) || [];
  }

  async updatePortGoodPrice(id: number, price: number): Promise<PortGood | undefined> {
    for (const [portId, goods] of this.portGoodsMap.entries()) {
      const goodIndex = goods.findIndex(good => good.id === id);
      if (goodIndex !== -1) {
        goods[goodIndex].currentPrice = price;
        goods[goodIndex].updatedAt = new Date();
        return goods[goodIndex];
      }
    }
    return undefined;
  }

  // Player inventory operations
  async getPlayerInventory(playerId: number): Promise<PlayerInventory[]> {
    const playerInv = this.playerInventoryMap.get(playerId);
    if (!playerInv) return [];
    return Array.from(playerInv.values());
  }

  async updatePlayerInventory(playerId: number, goodId: number, quantity: number): Promise<void> {
    let playerInv = this.playerInventoryMap.get(playerId);
    if (!playerInv) {
      playerInv = new Map();
      this.playerInventoryMap.set(playerId, playerInv);
    }
    
    const existingItem = playerInv.get(goodId);
    if (!existingItem) {
      playerInv.set(goodId, { playerId, goodId, quantity });
    } else {
      existingItem.quantity = quantity;
      playerInv.set(goodId, existingItem);
    }
  }

  // Leaderboard operations
  async getLeaderboard(limit = 10): Promise<Leaderboard[]> {
    return [...this.leaderboardList]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async addToLeaderboard(entry: InsertLeaderboard): Promise<Leaderboard> {
    const id = this.leaderboardId++;
    const now = new Date();
    const newEntry: Leaderboard = { ...entry, id, achievedAt: now };
    this.leaderboardList.push(newEntry);
    return newEntry;
  }
}

// Export a singleton instance
export const storage = new MemStorage();
