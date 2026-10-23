import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { type User, type Player as SharedPlayer, type ShipType, type Good, type PortGood, type PlayerInventory, type Leaderboard } from '@shared/schema';
import { portQueue } from './game/trade'; // port goods writes share the trade path's per-port queue
import { PlayerState } from '@/types';
import { SHIP_STATS } from '@shared/gameConstants';
import { parseStanding, type StandingState } from '@shared/protocol';
import type { GamePort } from '@shared/world/ports';
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
                if (channel === '__keyevent@0__:expired' && expiredKey.startsWith('player:')) {
                    const playerId = expiredKey.split(':')[1];
                    console.log(`>>>>>>>>>>>>>> Detected expiration of player:${playerId}`);
                    const scoreData = await this.redis.hgetall(`player_score:${playerId}`);
                    if (scoreData && scoreData.name && scoreData.gold && parseInt(scoreData.gold) > 0) {
                        const leaderboardEntry = await this.addToLeaderboard({
                            playerId,
                            playerName: scoreData.name,
                            score: parseInt(scoreData.gold),
                            achievedAt: new Date()
                        });
                        console.log("leaderboard entry for expired player:", leaderboardEntry);
                        await this.redis.del(`player_score:${playerId}`);
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
        multi.expire(`player:${id}`, newPlayer.playerTTL);
        multi.set(`player_inventory:${id}`, JSON.stringify([]));
        multi.expire(`player_inventory:${id}`, newPlayer.playerTTL);
        //multi.sadd('player_names', id);
        multi.set(`active_name:${newPlayer.name}`, `${id}`);
        multi.expire(`active_name:${newPlayer.name}`, newPlayer.playerTTL);
        multi.hmset(`player_score:${id}`, {
            name: newPlayer.name,
            gold: newPlayer.gold.toString()
        });
        multi.expire(`player_score:${id}`, newPlayer.playerTTL + 24 * 60 * 60);
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
        multi.hmset(`player_score:${player.id}`, {
            name: player.name,
            gold: player.gold.toString()
        });
        multi.expire(`player_score:${player.id}`, currentPlayer.playerTTL + 24 * 60 * 60);
        await multi.exec();
    }

    async updatePlayerGold(id: string, gold: number): Promise<void> {
        console.log("updating player gold:", id, gold);
        const currentPlayer = await this.getPlayer(id);
        if (!currentPlayer) {
            throw new Error(`Player ${id} not found`);
        }
        const multi = this.redis.multi();
        multi.hset(`player:${id}`, 'gold', gold.toString());
        multi.expire(`player:${id}`, currentPlayer.playerTTL);
        multi.hset(`player_score:${id}`, 'gold', gold.toString());
        multi.expire(`player_score:${id}`, currentPlayer.playerTTL + 24 * 60 * 60);
        await multi.exec();
    }

    /** NPC2: write only the player's faction standing (after npcRepChange effects). No-op when the
     *  record does not exist (expired, or the player sank). Leaves TTLs alone. */
    async updatePlayerStanding(id: string, standing: StandingState): Promise<void> {
        const key = `player:${id}`;
        const ttl = await this.redis.ttl(key); // −2 = missing; −1 = no TTL (keep it that way)
        if (ttl === -2) return;
        const multi = this.redis.multi();
        multi.hset(key, 'standing', JSON.stringify(standing));
        if (ttl > 0) multi.expire(key, ttl); // if it expired meanwhile, don't leave a TTL-less stub
        await multi.exec();
    }

    // reserve a name from a stripe checkout begin
    async reserveName(name: string, tempPlayerId: string, ttlSeconds: number = 300): Promise<void> {
        const multi = this.redis.multi();
        multi.set(`active_name:${name}`, tempPlayerId);
        multi.expire(`active_name:${name}`, ttlSeconds);
        await multi.exec();
    }

    async getActiveNamePlayerId(name: string): Promise<string | null> {
        const playerId = await this.redis.get(`active_name:${name}`);
        return playerId || null;
    }

    // Reset TTL for player, inventory, and name records.
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
            multi.expire(`player:${id}`, player.playerTTL);
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

    // Port operations (card W4). The `ports` hash maps id -> JSON GamePort (shared/world/ports.ts);
    // `portsVersion` holds the ports.json content hash it was seeded from (server/game/ports.ts).
    async getPorts(): Promise<GamePort[]> {
        const ports = await this.redis.hgetall('ports');
        const result: GamePort[] = [];
        for (const data of Object.values(ports)) {
            if (data) result.push(this.deserializePort(JSON.parse(data as string)));
        }
        return result.sort((a, b) => a.id - b.id);
    }

    async getPort(id: number): Promise<GamePort | undefined> {
        const data = await this.redis.hget('ports', id.toString());
        if (!data) return undefined;
        return this.deserializePort(JSON.parse(data));
    }

    async getPortsVersion(): Promise<string | null> {
        return this.redis.get('portsVersion');
    }

    /** Replace every port (and drop every old and new port's goods) and store the new version, in one transaction. */
    async replacePorts(ports: readonly GamePort[], version: string): Promise<void> {
        const oldIds = await this.redis.hkeys('ports');
        const ids = new Set<string>([...oldIds, ...ports.map((p) => String(p.id))]);
        const tx = this.redis.multi();
        ids.forEach((id) => tx.del(`port:${id}:goods`));
        tx.del('ports');
        for (const p of ports) tx.hset('ports', String(p.id), JSON.stringify(p));
        tx.set('port:next_id', String(ports.reduce((m, p) => Math.max(m, p.id), 0)));
        tx.set('portsVersion', version);
        await tx.exec();
    }

    // Port goods operations
    async getPortGoods(portId: number): Promise<PortGood[]> {
        const data = await this.redis.get(`port:${portId}:goods`);
        if (!data) return [];
        return JSON.parse(data);
    }

    async updatePortGoodPrice(portId: number, goodId: number, price: number): Promise<void> {
        return portQueue.run(`port:${portId}`, () => this.updatePortGoodPriceNow(portId, goodId, price));
    }
    private async updatePortGoodPriceNow(portId: number, goodId: number, price: number): Promise<void> {
        const portGoods = await this.getPortGoods(portId);
        const portGood = portGoods.find(pg => pg.goodId === goodId);
        if (portGood) {
            portGood.currentPrice = price;
            portGood.updatedAt = new Date();
            await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
        }
    }

    async updatePortGoodStock(portId: number, goodId: number, stock: number): Promise<void> {
        return portQueue.run(`port:${portId}`, () => this.updatePortGoodStockNow(portId, goodId, stock));
    }
    private async updatePortGoodStockNow(portId: number, goodId: number, stock: number): Promise<void> {
        const portGoods = await this.getPortGoods(portId);
        const portGood = portGoods.find(pg => pg.goodId === goodId);
        if (portGood) {
            portGood.stock = stock;
            portGood.updatedAt = new Date();
            await this.redis.set(`port:${portId}:goods`, JSON.stringify(portGoods));
        }
    }

    async createPortGood(portGood: Omit<PortGood, 'id'>): Promise<PortGood> {
        return portQueue.run(`port:${portGood.portId}`, () => this.createPortGoodNow(portGood));
    }
    private async createPortGoodNow(portGood: Omit<PortGood, 'id'>): Promise<PortGood> {
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

    /**
     * Trading (2026-10-23): write a player's whole inventory (rows keep `avgPaid`), cargoUsed and gold in
     * one transaction. Only called from the serialized trade path (server/game/trade.ts).
     */
    async saveTrade(playerId: string, inventory: { goodId: number; quantity: number; avgPaid?: number }[], gold: number): Promise<void> {
        const currentPlayer = await this.getPlayer(playerId);
        if (!currentPlayer) throw new Error(`Player ${playerId} not found`);
        const rows = inventory.filter((r) => r.quantity > 0).map((r) => (r.avgPaid === undefined
            ? { playerId, goodId: r.goodId, quantity: r.quantity }
            : { playerId, goodId: r.goodId, quantity: r.quantity, avgPaid: r.avgPaid }));
        const cargo = rows.reduce((a, r) => a + r.quantity, 0);
        const ttl = currentPlayer.playerTTL;
        const multi = this.redis.multi();
        multi.set(`player_inventory:${playerId}`, JSON.stringify(rows));
        multi.expire(`player_inventory:${playerId}`, ttl);
        multi.hset(`player:${playerId}`, 'cargoUsed', cargo.toString());
        multi.hset(`player:${playerId}`, 'gold', gold.toString());
        multi.expire(`player:${playerId}`, ttl);
        multi.hset(`player_score:${playerId}`, 'gold', gold.toString());
        multi.expire(`player_score:${playerId}`, ttl + 24 * 60 * 60);
        this.setPlayerActive(playerId, true);
        await multi.exec();
    }

    /** Trading: replace a port's goods (after a trade changed stock). Callers hold the port's queue. */
    async setPortGoods(portId: number, goods: PortGood[]): Promise<void> {
        await this.redis.set(`port:${portId}:goods`, JSON.stringify(goods));
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
            playerTTL: player.playerTTL.toString(),
            // Coordinate-system version (shared/world/geo.ts WORLD_VERSION); restorePlayer relocates
            // records without it (old 10000x10000 torus positions). W4 owns the full migration.
            worldVersion: String((player as any).worldVersion ?? '')
        };
        // NPC2: faction standing (JSON). Omitted when absent so a write never clears a stored one.
        if ((player as any).standing) serialized.standing = JSON.stringify((player as any).standing);

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

        // Optional: absent on records written before the wrapping-Earth world (World.restorePlayer relocates those).
        if (data.worldVersion) (player as any).worldVersion = parseInt(data.worldVersion);
        // NPC2: faction standing (optional; malformed JSON is ignored).
        const standing = data.standing ? parseStanding(data.standing) : null;
        if (standing) (player as any).standing = standing;

        return player;
    }

    private deserializePort(data: any): GamePort {
        // Records seeded before card W4 (no dock) fall back to the town position for the dock/spawn.
        const x = Number(data.x) || 0;
        const z = Number(data.z) || 0;
        return {
            id: Number(data.id),
            key: data.key ?? String(data.id),
            name: data.name,
            nation: data.nation,
            region: data.region,
            lat: Number(data.lat) || 0,
            lon: Number(data.lon) || 0,
            x,
            y: 0,
            z,
            dock: data.dock ? { x: Number(data.dock.x), z: Number(data.dock.z) } : { x, z },
            spawn: data.spawn ? { x: Number(data.spawn.x), z: Number(data.spawn.z) } : { x, z },
            safeRadius: Number(data.safeRadius) || 0,
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
        multi.del(`player_score:${playerId}`);
        await multi.exec();
    }
}

// Export a singleton instance
export const redisStorage = new RedisStorage(); 