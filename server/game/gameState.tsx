/**
 * Game-state wiring layer: owns the single in-memory `World` (server/game/world.ts), drives it with
 * the drift-free 20 Hz `FixedStepLoop`, fans each tick out to connected sockets (per-client
 * interest-filtered messages built by the world), and runs the world's side effects (Redis,
 * leaderboard, Segment) fire-and-forget OUTSIDE the tick. See docs/netcode/PROTOCOL.md §5–§6 and
 * server/SERVER_CONTEXT.md "Netcode (server)".
 *
 * Nothing in the tick awaits: `runTick()` is synchronous; every async side effect goes through
 * `background()`, which logs failures and never rethrows into the loop.
 */
import { redisStorage } from "../redisStorage";
import { v4 as uuidv4 } from "uuid";
import { GOODS, DEFAULT_PORTS } from "@shared/gameConstants";
import { trackEvent, shutdownSegment } from "../segmentClient";
import { World, TICK_MS, type WorldEffect, type WorldPlayer } from "./world";
import { FixedStepLoop } from "./loop";

export type { PlayerState, WorldPlayer } from "./world";
export { GRACE_PERIOD, GOLD_COLLECTION_RADIUS, GOLD_OBJECT_LIFETIME } from "./world";

export const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const MAX_PLAYERS = 1000;
/** Skip a client's per-tick snapshot (never its events) while its socket buffer is above this. */
export const MAX_BUFFERED_BYTES = 512 * 1024;

/** Minimal socket surface we need (keeps this module free of a runtime `ws` import). */
export interface ClientSocket {
  readyState: number;
  bufferedAmount?: number;
  send(data: string): void;
}

type LeaderboardRow = { id: number; playerId: string; playerName: string; score: number; achievedAt: Date };

const OPEN = 1;

/** Run an async side effect without awaiting it; log (never throw) on failure. */
export function background(label: string, work: () => Promise<unknown>): void {
  try {
    work().catch((err) => console.error(`[bg] ${label} failed:`, err));
  } catch (err) {
    console.error(`[bg] ${label} failed:`, err);
  }
}

class GameState {
  readonly world = new World();
  state: { leaderboard: LeaderboardRow[] } = { leaderboard: [] };
  private loop: FixedStepLoop;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private readonly sockets = new Map<string, ClientSocket>();
  private tickCount = 0;
  private tickTimeTotal = 0;

  constructor() {
    this.loop = new FixedStepLoop(() => this.runTick(), { stepMs: TICK_MS, maxCatchUp: 5 });
  }

  start() {
    if (!this.loop.running) {
      this.loop.start();
      console.log("Game tick started (20 Hz fixed step)");
    }
    if (!this.priceUpdateInterval) {
      this.priceUpdateInterval = setInterval(() => background("updatePrices", () => this.updatePrices()), PRICE_UPDATE_INTERVAL);
      console.log("Price updates started");
    }
  }

  stop() {
    this.loop.stop();
    if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval);
    this.priceUpdateInterval = null;
    console.log("Game stopped");
  }

  /** Player by id (live world object; mutations are visible to the next tick). */
  getPlayer(id: string): WorldPlayer | undefined {
    return this.world.getPlayer(id);
  }

  get playerCount(): number {
    return this.world.players.size;
  }

  /** Attach a socket to a player: starts its view (fresh known-set, seq tracking) and marks the
   *  player connected. Replaces any previous socket for the same player. */
  registerClient(playerId: string, ws: ClientSocket) {
    this.sockets.set(playerId, ws);
    this.world.setConnected(playerId, true);
    this.world.attachClient(playerId);
  }

  /** Detach a player's socket. If `ws` is given, only detaches when it is still the registered
   *  socket (a stale socket closing after a reconnect must not disconnect the new one). */
  removeClient(playerId: string, ws?: ClientSocket) {
    const current = this.sockets.get(playerId);
    if (ws && current !== ws) return;
    this.sockets.delete(playerId);
    this.world.detachClient(playerId);
    this.world.setConnected(playerId, false);
  }

  /** Name check against Redis, then create the player in the world. Null on name conflict. */
  async addPlayer(name: string, shipType: string, _ship: unknown, tempPlayerId?: string): Promise<WorldPlayer | null> {
    const reservedPlayerId = await redisStorage.getActiveNamePlayerId(name);
    if (reservedPlayerId && reservedPlayerId !== tempPlayerId) {
      console.log(`Name conflict: ${name} is reserved with ID ${reservedPlayerId}, but tempPlayerId is ${tempPlayerId}`);
      return null;
    }
    return this.world.createPlayer({ id: tempPlayerId || uuidv4(), name, shipType });
  }

  /** One fixed tick: step the world, send every attached client its messages, run effects. */
  private runTick() {
    const t0 = performance.now();
    this.world.step();

    this.sockets.forEach((ws, playerId) => {
      if (ws.readyState !== OPEN) return;
      // ent/gone + events first, snapshot `s` last.
      const frames = this.world.buildFrames(playerId);
      const congested = (ws.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES;
      const n = congested ? frames.length - 1 : frames.length;
      for (let i = 0; i < n; i++) {
        try {
          ws.send(frames[i]);
        } catch (err) {
          console.error(`Error sending to ${playerId}:`, err);
          break;
        }
      }
    });

    const effects = this.world.drainEffects();
    for (const e of effects) this.runEffect(e);

    this.tickTimeTotal += performance.now() - t0;
    if (++this.tickCount % (20 * 60) === 0) {
      console.log(
        `[tick] avg ${(this.tickTimeTotal / (20 * 60)).toFixed(2)} ms over 60 s, players=${this.world.players.size}, ` +
          `sockets=${this.sockets.size}, balls=${this.world.balls.length}, dropped=${this.loop.dropped}`,
      );
      this.tickTimeTotal = 0;
    }
  }

  private runEffect(e: WorldEffect) {
    switch (e.type) {
      case "playerSunk":
        background("playerSunk", async () => {
          await redisStorage.addToLeaderboard({
            playerId: e.playerId,
            playerName: e.name,
            score: e.gold,
            achievedAt: new Date(),
          });
          const raw = await redisStorage.getLeaderboard(10);
          this.state.leaderboard = raw.map((entry) => ({ ...entry, playerId: entry.playerId ?? "" }));
          console.log(`Player ${e.name} sunk with score ${e.gold}`);
          trackEvent(e.playerId, "Player Sunk", { score: e.gold, gold: e.gold, x: e.x, z: e.z });
          try {
            await redisStorage.removePlayer(e.playerId);
          } catch (err) {
            // Not necessarily an error: the record may already have expired (TTL).
            console.warn("Error removing player:", err);
          }
        });
        break;
      case "goldCollected":
        background("goldCollected", () => redisStorage.updatePlayerGold(e.playerId, e.newTotalGold));
        trackEvent(e.playerId, "Gold Collected", { goldAmount: e.gold, newTotalGold: e.newTotalGold, x: e.x, z: e.z });
        break;
      case "playerRemoved":
        if (e.reason === "disconnected") {
          console.log(`Removing disconnected player ${e.player.name} (${e.player.id})`);
          background("persist removed player", () => redisStorage.updatePlayerState(e.player));
        } else {
          console.log(`Removing dead player ${e.player.name} (${e.player.id})`);
          background("removeActiveName", () => redisStorage.removeActiveName(e.player.name));
        }
        break;
    }
  }

  /** Persist every in-world player (used on graceful shutdown). */
  async persistAll(): Promise<void> {
    const players = Array.from(this.world.players.values());
    const results = await Promise.allSettled(
      players.filter((p) => !p.sunk && !p.dead).map((p) => redisStorage.updatePlayerState({ ...p, lastSeen: Date.now() })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`Persisted ${results.length - failed}/${results.length} players${failed ? ` (${failed} failed)` : ""}`);
  }

  /** Graceful shutdown: stop the loop, persist players, flush Segment. Sockets are closed by the caller. */
  async shutdown(): Promise<void> {
    this.stop();
    await this.persistAll().catch((err) => console.error("persistAll failed:", err));
    await shutdownSegment().catch((err) => console.error("Segment flush failed:", err));
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

  async updateLeaderboard(leaderboard: LeaderboardRow[]) {
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
