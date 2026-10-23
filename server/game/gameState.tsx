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
import { GOODS } from "@shared/gameConstants";
import { seedPorts, ensurePortGoods, updatePortMarkets } from "./ports";
import { trackEvent, shutdownSegment } from "../segmentClient";
import { World, TICK_MS, isNpcId, type WorldEffect, type WorldPlayer } from "./world";
import { FixedStepLoop } from "./loop";
import { loadLandSync } from "./landLoader";
import { createLiveNpcSystem, npcsEnabled, type NpcSystem } from "./npc";
import { ChatService } from "./chat";

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
  /** The underlying net.Socket of a `ws` WebSocket (used to cork a tick's frames into one write). */
  _socket?: { cork?: () => void; uncork?: () => void };
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
  /** The one world. Land tiles are loaded synchronously here, before the loop can start. */
  readonly world = new World({ land: loadLandSync().field });
  state: { leaderboard: LeaderboardRow[] } = { leaderboard: [] };
  private loop: FixedStepLoop;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private readonly sockets = new Map<string, ClientSocket>();
  private tickCount = 0;
  private tickTimeTotal = 0;
  /** Longest single tick (ms) in the current 60 s log window. */
  private tickTimeMax = 0;

  /** NPC2: the live NPC system (lanes.json, port safe zones, ~300 NPCs, the World's land). ON by
   *  default; NPCS_ENABLED=0 turns it off. */
  readonly npcs: NpcSystem | null = npcsEnabled() ? createLiveNpcSystem(this.world).attach() : null;
  /** NPC2: players whose standing changed this tick (npcRepChange), written to Redis once each. */
  private readonly standingDirty = new Set<string>();
  /** Global chat: rate limits, text policy and the in-memory history (server/game/chat.ts). Used from
   *  the socket message path only, never from the tick. Not persisted. */
  readonly chat = new ChatService();

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

  /** True when `ws` is the socket currently attached for `playerId` (chat eligibility). */
  isRegisteredSocket(playerId: string, ws: ClientSocket): boolean {
    return this.sockets.get(playerId) === ws;
  }

  /**
   * Send one pre-serialized frame to every attached, open socket (global chat). Synchronous; called
   * from the socket message path, never from the tick. Returns the number of sockets written to.
   */
  broadcast(data: string): number {
    let n = 0;
    this.sockets.forEach((ws, playerId) => {
      if (ws.readyState !== OPEN) return;
      try {
        ws.send(data);
        n++;
      } catch (err) {
        console.error(`Error broadcasting to ${playerId}:`, err);
      }
    });
    return n;
  }

  /** Name check against Redis, then create the player in the world. Null on name conflict. */
  async addPlayer(name: string, shipType: string, _ship: unknown, tempPlayerId?: string): Promise<WorldPlayer | null> {
    const reservedPlayerId = await redisStorage.getActiveNamePlayerId(name);
    if (reservedPlayerId && reservedPlayerId !== tempPlayerId) {
      console.log(`Name conflict: ${name} is reserved with ID ${reservedPlayerId}, but tempPlayerId is ${tempPlayerId}`);
      return null;
    }
    return this.world.createPlayer({ id: tempPlayerId && !isNpcId(tempPlayerId) ? tempPlayerId : uuidv4() /* NPC1 */, name, shipType });
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
      // NPC2: cork the TCP socket so this tick's frames (ent/gone, every fire/hit event, the
      // snapshot) leave in ONE write instead of one syscall per WebSocket message. Same frames on the
      // wire; with NPC fights near crowded ports the per-message writes were ~30 % of server CPU.
      const sock = ws._socket;
      if (n > 1) sock?.cork?.();
      try {
        for (let i = 0; i < n; i++) {
          try {
            ws.send(frames[i]);
          } catch (err) {
            console.error(`Error sending to ${playerId}:`, err);
            break;
          }
        }
      } finally {
        if (n > 1) sock?.uncork?.();
      }
    });

    const effects = this.world.drainEffects();
    for (const e of effects) this.runEffect(e);
    this.flushStandings();

    const tickMs = performance.now() - t0;
    this.tickTimeTotal += tickMs;
    if (tickMs > this.tickTimeMax) this.tickTimeMax = tickMs;
    if (++this.tickCount % (20 * 60) === 0) {
      console.log(
        `[tick] avg ${(this.tickTimeTotal / (20 * 60)).toFixed(2)} ms (max ${this.tickTimeMax.toFixed(1)}) over 60 s, players=${this.world.players.size}, ` +
          `sockets=${this.sockets.size}, balls=${this.world.balls.length}, dropped=${this.loop.dropped}` +
          // Input queue totals since start (world.inputStats): held = starved ticks (late input, ship
          // held), overflow = inputs dropped by the queue cap, catchUp = 2-input ticks.
          `, input held=${this.world.inputStats.held} overflow=${this.world.inputStats.overflow} catchUp=${this.world.inputStats.catchUp}` +
          (this.npcs ? `, npcs=${this.npcs.stats.active}/${this.npcs.stats.records} (npc max ${this.npcs.stats.maxTickMs.toFixed(1)} ms)` : ""),
      );
      if (this.npcs) this.npcs.stats.maxTickMs = 0;
      this.tickTimeTotal = 0;
      this.tickTimeMax = 0;
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
      // NPC effects never touch the leaderboard. NPC2: rep changes are already applied to the
      // player's in-memory standing by the NPC system; persist it (once per player per tick).
      case "npcSunk":
        break;
      case "npcRepChange":
        this.standingDirty.add(e.playerId);
        break;
    }
  }

  /** NPC2: write changed standings to the player records (fire-and-forget, outside the tick). */
  private flushStandings() {
    if (this.standingDirty.size === 0) return;
    this.standingDirty.forEach((id) => {
      const p = this.world.getPlayer(id);
      if (!p || !p.standing || p.controller !== "player") return;
      const standing = { rep: { ...p.standing.rep }, notoriety: p.standing.notoriety, bounty: p.standing.bounty };
      background("updatePlayerStanding", () => redisStorage.updatePlayerStanding(id, standing));
    });
    this.standingDirty.clear();
  }

  /** Persist every in-world player (used on graceful shutdown). */
  async persistAll(): Promise<void> {
    const players = Array.from(this.world.players.values());
    const results = await Promise.allSettled(
      players.filter((p) => !p.sunk && !p.dead && p.controller !== "npc").map((p) => redisStorage.updatePlayerState({ ...p, lastSeen: Date.now() })),
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

  /** Periodic market move (regional prices + restock, server/game/ports.ts); creates missing goods. */
  async updatePrices() {
    try {
      await ensurePortGoods(redisStorage);
      await updatePortMarkets(redisStorage);
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
    // Ports come from shared/world/ports.json; re-seeded (with fresh goods) when portsVersion changes.
    await seedPorts(redisStorage);
    const goods = await redisStorage.getGoods();
    if (goods.length === 0) {
      for (const good of GOODS) await redisStorage.createGood(good);
      console.log("Goods initialized");
    }
    await ensurePortGoods(redisStorage);
    gameState.start();
  } catch (err) {
    console.error("Error initializing game state:", err);
  }
}
