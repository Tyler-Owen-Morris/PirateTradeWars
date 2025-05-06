import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { type User, type Player, type ShipType, type Port, type Good, type PortGood, type PlayerInventory, type Leaderboard } from '@shared/schema';
import { PlayerState } from '@/types';
import { SHIP_STATS } from '@shared/gameConstants';
import { set } from 'node_modules/cypress/types/lodash';
import dotenv from 'dotenv';
dotenv.config();

interface Player {
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
    direction: { x: number; y: number; z: number };
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
    playerTTL: number;
}



export class RedisStorage {
    private redis: Redis;
    private pubsub: Redis;
    private readonly EXPIRATION_OFFSET = 30; // Player expires 30 seconds after inventory - so we use the inventory event to store the player's high score and expire both records.

    constructor() {
        //console.log("env", process.env)
        const connString = process.env['REDIS_CONN_STRING']
        if (!connString) {
            throw new Error('REDIS_CONN_STRING environment variable is required');
        }
        this.redis = new Redis(connString);
        this.pubsub = new Redis(connString);
        this.redis.config('SET', 'notify-keyspace-events', 'Ex');
        //this.redis.config('GET', 'hz').then((result) => console.log("hz:", result));
        this.setupExpirationListener();

    }

    async setupExpirationListener() {
        try {
            await this.pubsub.subscribe('__keyevent@0__:expired');
            console.log('Subscribed to key expiration events');

            this.pubsub.on('message', async (channel, expiredKey) => {
                console.log("channel:", channel, "expiredKey:", expiredKey)
                if (channel === '__keyevent@0__:expired' && expiredKey.startsWith('player_inventory:')) {
                    const playerId = expiredKey.split(':')[1];
                    console.log(`>>>>>>>>>>>>>> Detected expiration of player:${playerId}`);
                    // fetch the player
                    const player = await this.getPlayer(playerId);
                    console.log("got player to be removed player:", player)
                    if (player) {
                        // add the player to the leaderboard
                        const lederboardentry = await this.addToLeaderboard({
                            playerId: player.playerId,
                            playerName: player.name,
                            score: player.gold,
                            achievedAt: new Date()
                        });
                        console.log("leaderboard entry for expired player:", lederboardentry)
                        // delete the player
                        await this.removePlayer(playerId);
                    }

                }
            });
        } catch (error) {
            console.error('Failed to set up expiration listener:', error);
        }
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
    async getActivePlayers(): Promise<Player[]> {
        const playerKeys = await this.redis.keys('player:*');
        const players = await Promise.all(playerKeys.map(async (key) => {
            const data = await this.redis.hgetall(key);
            return this.deserializePlayer(data);
        }));
        return players;
    }

    async getPlayer(id: string): Promise<Player | undefined> {
        //console.log("getting player data:", id)
        const data = await this.redis.hgetall(`player:${id}`);
        //console.log("got player data:", data)
        if (!data || Object.keys(data).length === 0) {
            return undefined;
        }
        return this.deserializePlayer(data);
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
        // const id = uuidv4();
        const id = player.id;
        const newPlayer = { ...player };
        //console.log("newPlayer:", newPlayer)
        // Get the playerTTL from SHIP_STATS based on ship type
        const shipStats = SHIP_STATS[newPlayer.shipType];
        if (!shipStats) {
            throw new Error(`Invalid ship type: ${newPlayer.shipType}`);
        }
        newPlayer.playerTTL = shipStats.playerTTL;
        // console.log("shipStats:", shipStats)
        // console.log("newPlayer.playerTTL:", newPlayer.playerTTL, this.PLAYER_TTL)
        // console.log("type of newPlayer.playerTTL:", typeof newPlayer.playerTTL, typeof this.PLAYER_TTL)
        // Start a transaction to ensure atomicity
        const multi = this.redis.multi();
        multi.hmset(`player:${id}`, this.serializePlayer(newPlayer));
        multi.expire(`player:${id}`, newPlayer.playerTTL + this.EXPIRATION_OFFSET);
        multi.set(`player_inventory:${id}`, JSON.stringify([]));
        multi.expire(`player_inventory:${id}`, newPlayer.playerTTL);
        //multi.sadd('player_names', id);
        multi.set(`active_name:${newPlayer.name}`, `${id}`);
        multi.expire(`active_name:${newPlayer.name}`, newPlayer.playerTTL);
        await multi.exec();

        return newPlayer;
    }

    async updatePlayerState(player: any): Promise<void> {
        // First get the current player record to get their TTL
        const currentPlayer = await this.getPlayer(player.id);
        if (!currentPlayer) {
            console.error(`Player ${player.id} not found`);
            return;
        }
        let player_to_update = { ...player };
        player_to_update.playerTTL = currentPlayer.playerTTL;

        const multi = this.redis.multi();
        multi.hmset(`player:${player.id}`, this.serializePlayer(player_to_update));
        multi.expire(`player:${player.id}`, currentPlayer.playerTTL);
        multi.expire(`player_inventory:${player.id}`, currentPlayer.playerTTL);
        multi.expire(`active_name:${player.name}`, currentPlayer.playerTTL);
        await multi.exec();
    }

    async updatePlayerGold(id: string, gold: number): Promise<void> {
        console.log("updating player gold:", id, gold);
        const currentPlayer = await this.getPlayer(id);
        if (!currentPlayer) {
            throw new Error(`Player ${id} not found`);
        }
        await this.redis.hset(`player:${id}`, 'gold', gold.toString());
        await this.redis.expire(`player:${id}`, currentPlayer.playerTTL + this.EXPIRATION_OFFSET);
    }


    // Modified setPlayerActive
    async setPlayerActive(id: string, isActive: boolean): Promise<void> {
        const player = await this.getPlayer(id);
        if (!player) {
            throw new Error(`Player ${id} not found`);
        }

        player.isActive = isActive;
        const player_name = player.name;

        const multi = this.redis.multi();
        multi.hmset(`player:${id}`, this.serializePlayer(player));
        multi.set(`active_name:${player_name}`, `${id}`);
        if (isActive) {
            multi.expire(`player:${id}`, player.playerTTL + this.EXPIRATION_OFFSET);
            multi.expire(`player_inventory:${id}`, player.playerTTL);
            multi.expire(`active_name:${player_name}`, player.playerTTL);
        }
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
        // First get the current player record to get their TTL
        const currentPlayer = await this.getPlayer(playerId);
        if (!currentPlayer) {
            throw new Error(`Player ${playerId} not found`);
        }

        const data = await this.redis.get(`player_inventory:${playerId}`);
        const multi = this.redis.multi();
        multi.expire(`player_inventory:${playerId}`, currentPlayer.playerTTL);
        multi.expire(`player:${playerId}`, currentPlayer.playerTTL);
        await multi.exec();
        this.setPlayerActive(playerId, true);
        return data ? JSON.parse(data) : [];
    }

    async updatePlayerInventory(playerId: string, goodId: number, quantity: number): Promise<void> {
        console.log("update player inventory called with playerid, goodId, quantity:", playerId, goodId, quantity);

        // First get the current player record to get their TTL
        const currentPlayer = await this.getPlayer(playerId);
        if (!currentPlayer) {
            throw new Error(`Player ${playerId} not found`);
        }

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

        // Calculate total cargo units
        const totalCargoUnits = inventory.reduce((sum, item) => sum + item.quantity, 0);

        const multi = this.redis.multi();
        multi.set(`player_inventory:${playerId}`, JSON.stringify(inventory));
        multi.expire(`player_inventory:${playerId}`, currentPlayer.playerTTL);
        multi.expire(`player:${playerId}`, currentPlayer.playerTTL);
        multi.hset(`player:${playerId}`, 'cargoUsed', totalCargoUnits.toString());
        this.setPlayerActive(playerId, true);
        await multi.exec();
    }

    async isNameActive(name: string): Promise<boolean> {
        // TODO : does this need to have a different assertion? the value is a string of the playerId- does "=== 1" work?
        return (await this.redis.exists(`active_name:${name}`)) === 1;
    }

    async getActiveNames(): Promise<Set<string>> {
        const keys = await this.redis.keys('active_name:*');
        const names = await Promise.all(keys.map(key => this.redis.get(key)));
        return new Set(names.filter(name => name !== null));
    }

    async addActiveName(name: string, playerId: string): Promise<void> {
        // First get the current player record to get their TTL
        const currentPlayer = await this.getPlayer(playerId);
        if (!currentPlayer) {
            throw new Error(`Player ${playerId} not found`);
        }

        const multi = this.redis.multi();
        multi.set(`active_name:${name}`, `${playerId}`);
        multi.expire(`active_name:${name}`, currentPlayer.playerTTL);
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
            playerId: player.playerId,
            name: player.name,
            shipType: player.shipType,
            x: player.x.toString(),
            y: player.y.toString(),
            z: player.z.toString(),
            rotationY: player.rotationY.toString(),
            maxSpeed: player.maxSpeed.toString(),
            directionX: player.direction.x.toString(),
            directionY: player.direction.y.toString(),
            directionZ: player.direction.z.toString(),
            hp: player.hp.toString(),
            maxHp: player.maxHp.toString(),
            gold: player.gold.toString(),
            cargoCapacity: player.cargoCapacity.toString(),
            cargoUsed: player.cargoUsed.toString(),
            repairCost: player.repairCost.toString(),
            reloadTime: player.reloadTime.toString(),
            damage: player.damage.toString(),
            cannonCount: player.cannonCount.toString(),
            lastSeen: player.lastSeen.toString(),
            dead: player.dead.toString(),
            playerTTL: player.playerTTL.toString()
        };

        return serialized;
    }

    private deserializePlayer(data: Record<string, string>): Player {
        // Validate required fields
        if (!data.id || !data.playerId || !data.name || !data.shipType) {
            throw new Error('Missing required player fields in Redis data');
        }

        const player: Player = {
            id: data.id,
            playerId: data.playerId,
            name: data.name,
            shipType: data.shipType,
            x: parseFloat(data.x) || 0,
            y: parseFloat(data.y) || 0,
            z: parseFloat(data.z) || 0,
            rotationY: parseFloat(data.rotationY) || 0,
            speed: 0, // Default value
            maxSpeed: parseFloat(data.maxSpeed) || 0,
            direction: {
                x: parseFloat(data.directionX) || 0,
                y: parseFloat(data.directionY) || 0,
                z: parseFloat(data.directionZ) || 0,
            },
            hp: parseInt(data.hp) || 0,
            maxHp: parseInt(data.maxHp) || 0,
            gold: parseInt(data.gold) || 0,
            cargoCapacity: parseInt(data.cargoCapacity) || 0,
            cargoUsed: parseInt(data.cargoUsed) || 0,
            repairCost: parseInt(data.repairCost) || 0,
            firing: false, // Default value
            canFire: true, // Default value
            lastFired: 0, // Default value
            reloadTime: parseInt(data.reloadTime) || 0,
            damage: parseInt(data.damage) || 0,
            cannonCount: parseInt(data.cannonCount) || 0,
            sunk: false, // Default value
            connected: false, // Default value
            isActive: true, // Default value
            lastSeen: parseInt(data.lastSeen) || Date.now(),
            dead: data.dead === 'true',
            playerTTL: parseInt(data.playerTTL) || 0
        };

        // Validate numeric fields
        if (
            isNaN(player.x) ||
            isNaN(player.y) ||
            isNaN(player.z) ||
            isNaN(player.rotationY) ||
            isNaN(player.maxSpeed) ||
            isNaN(player.direction.x) ||
            isNaN(player.direction.y) ||
            isNaN(player.direction.z) ||
            isNaN(player.hp) ||
            isNaN(player.maxHp) ||
            isNaN(player.gold) ||
            isNaN(player.cargoCapacity) ||
            isNaN(player.cargoUsed) ||
            isNaN(player.repairCost) ||
            isNaN(player.reloadTime) ||
            isNaN(player.damage) ||
            isNaN(player.cannonCount) ||
            isNaN(player.lastSeen) ||
            isNaN(player.playerTTL)
        ) {
            throw new Error('Invalid numeric fields in deserialized player');
        }

        return player;
    }

    private deserializeShipType(data: any): ShipType {
        //console.log("deserializing ship type:", data.isPaid)
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
            isPaid: data.isPaid
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

    async removePlayer(playerId: string): Promise<void> {
        // First get the player record to get their name
        const player = await this.getPlayer(playerId);
        if (!player) {
            throw new Error(`Player ${playerId} not found`);
        }

        const multi = this.redis.multi();
        // Delete the player record
        multi.del(`player:${playerId}`);
        // Delete the inventory record
        multi.del(`player_inventory:${playerId}`);
        // Delete the active name record using the player's name
        multi.del(`active_name:${player.name}`);
        await multi.exec();
    }
}

// Export a singleton instance
export const redisStorage = new RedisStorage(); 