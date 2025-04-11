import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { type User, type Player, type ShipType, type Port, type Good, type PortGood, type PlayerInventory, type Leaderboard } from '@shared/schema';
import { PlayerState } from '@/types';

export class RedisStorage {
    private redis: Redis;
    private readonly PLAYER_TTL = 24 * 60 * 60; // 24 hours in seconds
    private readonly INVENTORY_TTL = 24 * 60 * 60; // 24 hours in seconds
    private readonly ACTIVE_NAME_TTL = 5 * 60; // 5 minutes in seconds

    constructor() {
        //console.log("env", process.env)
        const connString = process.env.REDIS_CONN_STRING;
        if (!connString) {
            throw new Error('REDIS_CONN_STRING environment variable is required');
        }
        this.redis = new Redis(connString);
    }

    // User operations
    async getUser(id: number): Promise<User | undefined> {
        const data = await this.redis.hgetall(`user:${id}`);
        return data ? this.deserializeUser(data) : undefined;
    }

    async getUserByUsername(username: string): Promise<User | undefined> {
        const userId = await this.redis.smembers('usernames');
        for (const id of userId) {
            const user = await this.getUser(parseInt(id));
            if (user?.username === username) return user;
        }
        return undefined;
    }

    async createUser(user: Omit<User, 'id'>): Promise<User> {
        const id = await this.redis.incr('user:next_id');
        const newUser = { ...user, id };
        await this.redis.hmset(`user:${id}`, this.serializeUser(newUser));
        await this.redis.sadd('usernames', id.toString());
        return newUser;
    }

    // Player operations
    async getPlayer(id: string): Promise<Player | undefined> {
        const data = await this.redis.hgetall(`player:${id}`);
        return data ? this.deserializePlayer(data) : undefined;
    }

    async getPlayerByName(name: string): Promise<Player | undefined> {
        const playerId = await this.redis.smembers('player_names');
        for (const id of playerId) {
            const player = await this.getPlayer(parseInt(id));
            if (player?.name === name) return player;
        }
        return undefined;
    }

    async createPlayer(player: any): Promise<Player> {
        const id = uuidv4();
        const newPlayer = { ...player, id };

        // Start a transaction to ensure atomicity
        const multi = this.redis.multi();
        multi.hmset(`player:${id}`, this.serializePlayer(newPlayer));
        multi.expire(`player:${id}`, this.PLAYER_TTL);
        multi.set(`player_inventory:${id}`, JSON.stringify([]));
        multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
        multi.sadd('player_names', id);
        multi.sadd(`active_names:${newPlayer.name}`, "1");
        multi.expire(`active-names:${newPlayer.name}`, this.ACTIVE_NAME_TTL)
        await multi.exec();

        return newPlayer;
    }

    async updatePlayerGold(id: string, gold: number): Promise<void> {
        const multi = this.redis.multi();
        multi.hset(`player:${id}`, 'gold', gold);
        multi.expire(`player:${id}`, this.PLAYER_TTL);
        multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
        await multi.exec();
    }

    // Modified setPlayerActive
    async setPlayerActive(id: string, isActive: boolean): Promise<void> {
        const player_name = await this.redis.hget(`player:${id}`, 'name')
        const multi = this.redis.multi();
        multi.hset(`player:${id}`, 'isActive', isActive.toString());
        multi.expire(`player:${id}`, this.PLAYER_TTL);
        multi.expire(`player_inventory:${id}`, this.INVENTORY_TTL);
        multi.set(`active_names:${player_name}}`, "1")
        multi.expire(`active_names:${player_name}`, this.ACTIVE_NAME_TTL);
        await multi.exec();
    }

    // Leaderboard operations
    async getLeaderboard(limit = 10): Promise<Leaderboard[]> {
        const entries = await this.redis.zrevrange('leaderboard', 0, limit - 1, 'WITHSCORES');
        const leaderboard: Leaderboard[] = [];

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

    async addToLeaderboard(entry: Omit<Leaderboard, 'id'>): Promise<Leaderboard> {
        const id = await this.redis.incr('leaderboard:next_id');
        const newEntry = { ...entry, id };

        // Store the entry details
        await this.redis.hmset(`leaderboard_entry:${id}`, {
            playerId: entry.playerId,
            playerName: entry.playerName,
            achievedAt: entry.achievedAt.toISOString()
        });

        // Add to sorted set with score
        await this.redis.zadd('leaderboard', entry.score, id.toString());

        return newEntry;
    }

    // Ship type operations
    async getShipTypes(): Promise<ShipType[]> {
        const shipTypes = await this.redis.hgetall('ship_types');
        const entries = Object.entries(shipTypes);
        const result: ShipType[] = [];

        for (const [_, data] of entries) {
            const parsedData = JSON.parse(data as string);
            result.push(this.deserializeShipType(parsedData));
        }

        return result;
    }

    async getShipType(name: string): Promise<ShipType | undefined> {
        const data = await this.redis.hget('ship_types', name);
        return data ? this.deserializeShipType(JSON.parse(data)) : undefined;
    }

    async createShipType(shipType: Omit<ShipType, 'id'>): Promise<ShipType> {
        const id = await this.redis.incr('ship_type:next_id');
        const newShipType = { ...shipType, id };
        await this.redis.hset('ship_types', shipType.name, JSON.stringify(newShipType));
        return newShipType;
    }

    // Port operations
    async getPorts(): Promise<Port[]> {
        const ports = await this.redis.hgetall('ports');
        const result: Port[] = [];

        for (const [id, data] of Object.entries(ports)) {
            if (data) {
                const parsedData = JSON.parse(data as string);
                result.push(this.deserializePort(parsedData));
            }
        }

        return result;
    }

    async getPort(id: number): Promise<Port | undefined> {
        const data = await this.redis.hget('ports', id.toString());
        if (!data) return undefined;
        const parsedData = JSON.parse(data);
        return this.deserializePort(parsedData);
    }

    // Port goods operations
    async getPortGoods(portId: number): Promise<PortGood[]> {
        const data = await this.redis.get(`port:${portId}:goods`);
        if (!data) return [];
        return JSON.parse(data);
    }

    async updatePortGoodPrice(portId: number, goodId: number, price: number): Promise<void> {
        const portGoods = await this.getPortGoods(portId);
        const portGood = portGoods.find(pg => pg.goodId === goodId);
        if (portGood) {
            portGood.currentPrice = price;
            portGood.updatedAt = new Date();
            await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
        }
    }

    async updatePortGoodStock(portId: number, goodId: number, stock: number): Promise<void> {
        const portGoods = await this.getPortGoods(portId);
        const portGood = portGoods.find(pg => pg.goodId === goodId);
        if (portGood) {
            portGood.stock = stock;
            portGood.updatedAt = new Date();
            await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
        }
    }

    async createPortGood(portGood: Omit<PortGood, 'id'>): Promise<PortGood> {
        const id = await this.redis.incr('port_good:next_id');
        const newPortGood = { ...portGood, id };

        const portGoods = await this.getPortGoods(portGood.portId);
        portGoods.push(newPortGood);
        await this.redis.set(`port:${portGood.portId}:goods`, JSON.stringify(portGoods));

        return newPortGood;
    }

    // Player inventory operations
    async getPlayerInventory(playerId: string): Promise<PlayerInventory[]> {
        //console.log("fetching player inventory from DB:", playerId)
        const data = await this.redis.get(`player_inventory:${playerId}`);
        const multi = this.redis.multi();
        multi.expire(`player_inventory:${playerId}`, this.INVENTORY_TTL);
        multi.expire(`player:${playerId}`, this.PLAYER_TTL);
        await multi.exec()
        //console.log("got back", data)
        this.setPlayerActive(playerId, true)
        return data ? JSON.parse(data) : [];
    }

    async updatePlayerInventory(playerId: string, goodId: number, quantity: number): Promise<void> {
        console.log("update player inventory called with playerid, goodId, quantity:", playerId, goodId, quantity)
        const inventory = await this.getPlayerInventory(playerId);
        const existingItemIndex = inventory.findIndex(item => item.goodId === goodId);

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
        this.setPlayerActive(playerId, true)
        await multi.exec();
    }

    // Game state operations
    async getGamePlayer(playerId: string): Promise<any> {
        return this.redis.hgetall(`game_player:${playerId}`);
    }

    async updateGamePlayer(playerId: string, data: Record<string, any>): Promise<void> {
        await this.redis.hmset(`game_player:${playerId}`, data);
    }

    async isNameActive(name: string): Promise<boolean> {
        return (await this.redis.exists(`active_name:${name}`)) === 1;
    }

    async getActiveNames(): Promise<Set<string>> {
        const names = await this.redis.smembers('active_names');
        return new Set(names);
    }

    async addActiveName(name: string): Promise<void> {
        const multi = this.redis.multi();
        multi.set(`active_name:${name}`, '1');
        multi.expire(`active_name:${name}`, this.ACTIVE_NAME_TTL);
        await multi.exec();
    }

    async removeActiveName(name: string): Promise<void> {
        const multi = this.redis.multi();
        multi.del(`active_name:${name}`);
        await multi.exec();
    }

    // Serialization/deserialization helpers
    private serializeUser(user: User): Record<string, string> {
        return {
            id: user.id.toString(),
            username: user.username,
            password: user.password,
            createdAt: user.createdAt.toISOString()
        };
    }

    private deserializeUser(data: Record<string, string>): User {
        return {
            id: parseInt(data.id),
            username: data.username,
            password: data.password,
            createdAt: new Date(data.createdAt)
        };
    }

    private serializePlayer(player: Player): Record<string, string> {
        const serialized: Record<string, string> = {
            id: player.id,
            userId: player.userId?.toString() || '',
            name: player.name,
            shipType: player.shipType,
            gold: player.gold.toString(),
            isActive: player.isActive.toString(),
        };

        // Handle lastSeen safely
        if (player.lastSeen instanceof Date) {
            serialized.lastSeen = player.lastSeen.toISOString();
        } else if (typeof player.lastSeen === 'string') {
            // If it's already an ISO string, use it; otherwise, try to parse it
            try {
                serialized.lastSeen = new Date(player.lastSeen).toISOString();
            } catch {
                // Fallback to current time if parsing fails
                serialized.lastSeen = new Date().toISOString();
            }
        } else if (typeof player.lastSeen === 'number') {
            // If it's a timestamp (like from Date.now())
            serialized.lastSeen = new Date(player.lastSeen).toISOString();
        } else {
            // Fallback to current time if lastSeen is invalid
            serialized.lastSeen = new Date().toISOString();
        }

        if (player.x !== undefined) serialized.x = player.x.toString();
        if (player.z !== undefined) serialized.z = player.z.toString();
        if (player.rotationY !== undefined) serialized.rotationY = player.rotationY.toString();
        if (player.speed !== undefined) serialized.speed = player.speed.toString();
        if (player.hp !== undefined) serialized.hp = player.hp.toString();
        if (player.maxHp !== undefined) serialized.maxHp = player.maxHp.toString();
        if (player.cargoCapacity !== undefined) serialized.cargoCapacity = player.cargoCapacity.toString();
        if (player.cargoUsed !== undefined) serialized.cargoUsed = player.cargoUsed.toString();
        if (player.cannonCount !== undefined) serialized.cannonCount = player.cannonCount.toString();
        if (player.damage !== undefined) serialized.damage = player.damage.toString();
        if (player.reloadTime !== undefined) serialized.reloadTime = player.reloadTime.toString();

        return serialized;
    }

    private deserializePlayer(data: Record<string, string>): Player {
        const player: Player = {
            id: data.id,
            userId: data.userId && data.userId !== '' ? data.userId : null,
            name: data.name,
            shipType: data.shipType,
            gold: parseInt(data.gold) || 0,
            isActive: data.isActive === '1' || data.isActive === 'true',
            lastSeen: new Date(data.lastSeen)
        };

        if (data.x !== undefined) player.x = parseFloat(data.x);
        if (data.z !== undefined) player.z = parseFloat(data.z);
        if (data.rotationY !== undefined) player.rotationY = parseFloat(data.rotationY);
        if (data.speed !== undefined) player.speed = parseFloat(data.speed);
        if (data.hp !== undefined) player.hp = parseInt(data.hp);
        if (data.maxHp !== undefined) player.maxHp = parseInt(data.maxHp);
        if (data.cargoCapacity !== undefined) player.cargoCapacity = parseInt(data.cargoCapacity);
        if (data.cargoUsed !== undefined) player.cargoUsed = parseInt(data.cargoUsed);
        if (data.cannonCount !== undefined) player.cannonCount = parseInt(data.cannonCount);
        if (data.damage !== undefined) player.damage = parseInt(data.damage);
        if (data.reloadTime !== undefined) player.reloadTime = parseInt(data.reloadTime);

        // Validate lastSeen
        if (!(player.lastSeen instanceof Date) || isNaN(player.lastSeen.getTime())) {
            player.lastSeen = new Date();
        }

        return player;
    }

    private deserializeShipType(data: any): ShipType {
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
            isPaid: data.isPaid === 'true'
        };
    }

    private deserializePort(data: Record<string, string>): Port {
        return {
            id: parseInt(data.id),
            name: data.name,
            x: parseInt(data.x),
            y: parseInt(data.y),
            z: parseInt(data.z),
            safeRadius: parseInt(data.safeRadius)
        };
    }

    private deserializePortGood(data: Record<string, string>): PortGood {
        return {
            id: parseInt(data.id),
            portId: parseInt(data.portId),
            goodId: parseInt(data.goodId),
            currentPrice: parseInt(data.currentPrice),
            stock: parseInt(data.stock),
            updatedAt: new Date(data.updatedAt)
        };
    }

    async getGoods(): Promise<Good[]> {
        const goods = await this.redis.hgetall('goods');
        return Object.entries(goods).map(([id, data]) => {
            const parsed = JSON.parse(data as string);
            return {
                id: parseInt(id),
                name: parsed.name,
                basePrice: parsed.basePrice,
                fluctuation: parsed.fluctuation,
            };
        });
    }

    async createGood(good: Omit<Good, 'id'>): Promise<Good> {
        const id = await this.redis.incr('good:next_id');
        const newGood = { ...good, id };
        await this.redis.hset('goods', id.toString(), JSON.stringify(newGood));
        return newGood;
    }

    async createPort(port: Omit<Port, 'id'>): Promise<Port> {
        const id = await this.redis.incr('port:next_id');
        const newPort = { ...port, id };
        await this.redis.hset('ports', id.toString(), JSON.stringify(newPort));
        return newPort;
    }
}

// Export a singleton instance
export const redisStorage = new RedisStorage(); 