/**
 * Pure, Redis-free authoritative simulation core (docs/netcode/PROTOCOL.md §5, §6).
 *
 * Owns every in-memory entity of the shared world: players (ships), cannonballs and gold objects.
 * One call to `World.step()` advances the world by exactly one fixed tick (TICK_DT = 50 ms). The
 * step is synchronous and never touches I/O: anything that must reach Redis, the leaderboard or
 * Segment is pushed onto `effects` (drained by the wiring layer in `gameState.tsx`, which runs them
 * fire-and-forget), and anything clients must hear about is pushed onto the per-tick `events` list,
 * which `buildMessages(playerId)` turns into that client's wire messages (interest-filtered).
 *
 * Time: the world keeps its own simulation clock `timeMs = tick * 50`. Reload, cannonball lifetime,
 * gold lifetime and the disconnect grace period are all measured in simulation time, so tests can
 * drive the world with plain `step()` calls. `wallClock` (default Date.now) is only used for the
 * `st` snapshot field and the persisted `lastSeen`.
 *
 * World geometry (docs/world/WORLD_SPEC.md): x wraps at WORLD_C, z is closed by polar ice; every
 * gameplay distance is METRIC (geo.ts metricDistSq). The world holds a `LandQuery` (default: open
 * ocean + polar ice; the server passes the real SDF field from landLoader.ts) and hands it to
 * `stepShip` (no-damage coast collision). Balls that hit land are removed with a `splash` event.
 *
 * Imports only `shared/` (pure) — safe to unit test without Redis or sockets.
 */
import {
  BALL_LIFETIME_MS,
  BALL_SPEED,
  NEUTRAL_INPUT,
  SHIP_HIT_RADIUS,
  TICK_DT,
  ballHitsLand,
  segmentHitsCircle,
  shipPhysicsStats,
  spawnBroadside,
  stepBall,
  stepShip,
  type ShipInput,
  type ShipPhysicsStats,
} from "@shared/physics";
import {
  MIN_METRIC_X,
  WORLD_C,
  WORLD_H,
  WORLD_VERSION,
  clampZ,
  metricDelta,
  metricDistSq,
  metricX,
  wrap,
  xOfLon,
  zOfLat,
} from "@shared/world/geo";
import { ALWAYS_WATER_TEST_FIELD, type LandQuery } from "@shared/world/land";
import { STARTER_PORTS, type GamePort } from "@shared/world/ports";
import {
  GOLD_INTEREST_RADIUS,
  GOLD_SNAPSHOT_EVERY,
  GRID_CELL,
  INPUT_CATCHUP_THRESHOLD,
  INTEREST_RADIUS,
  MAX_INPUT_QUEUE,
  makeFlags,
  packEntityRow,
  roundPos,
  type BallRow,
  type EntityRow,
  type GoldRow,
  type InputMessage,
  type ServerMessage,
  type SnapshotMessage,
} from "@shared/protocol";
import { SHIP_STATS, SHIP_TYPES } from "@shared/gameConstants";

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

/** Milliseconds per simulation tick (50). */
export const TICK_MS = TICK_DT * 1000;
/** A disconnected player stays in the world (coasting, flagged DISCONNECTED) this long (ms). */
export const GRACE_PERIOD = 60000;
/** Ships within this distance of a gold object pick it up (world units). */
export const GOLD_COLLECTION_RADIUS = 50;
/** Gold objects disappear after this long (ms). */
export const GOLD_OBJECT_LIFETIME = 60 * 1000;
/** A `dead` player is removed (and its active name released) after this long (ms). */
export const DEAD_REMOVAL_MS = 15 * 1000;
/** The FIRING entity flag stays set for this many ticks after a broadside (300 ms). */
export const FIRING_FLAG_TICKS = 6;
/** Spawn points must have at least this much water (metric distance to land), WORLD_SPEC §4.3. */
export const SPAWN_MIN_WATER = 60;
/** Default centre for a bare `spawnPoint()` call: the Caribbean, lat 18 / lon −75. Players spawn at
 *  starter ports instead (`starterSpawn`). */
export const DEFAULT_SPAWN_CENTER: Readonly<{ x: number; z: number }> = Object.freeze({ x: xOfLon(-75), z: zOfLat(18) });
/** Default spawn jitter: uniform in ±this metric distance on each axis around the centre. */
export const DEFAULT_SPAWN_JITTER = 5000;
/** Attempts before spawnPoint gives up and returns the best (deepest-water) candidate. */
export const SPAWN_ATTEMPTS = 64;
/** Port spawns (card W4): jitter around a port's `spawn` point (metric, per axis)… */
export const PORT_SPAWN_JITTER = 150;
/** …and the minimum land distance a jittered port spawn must have (WORLD_SPEC §5: spawn > 150). */
export const PORT_SPAWN_MIN_WATER = 150;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** The persisted/legacy player shape (what `redisStorage` serializes). `speed` is the signed
 *  velocity in units per 1/60 s (negative = forward); `direction` is the heading vector derived
 *  from rotationY (kept for Redis). `lastFired` is in simulation ms. */
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
  /** Coordinate-system version the position is in (geo.ts WORLD_VERSION); missing = old torus. */
  worldVersion?: number;
}

/** A player inside the world: the persisted shape plus netcode bookkeeping. */
export interface WorldPlayer extends PlayerState {
  /** Small integer entity id, stable for this player's life in the world (never reused). */
  eid: number;
  /** Pending inputs, oldest first, at most MAX_INPUT_QUEUE. */
  inputQueue: InputMessage[];
  /** Highest seq accepted into the queue on the current connection (−1 = none). */
  highestSeq: number;
  /** Last seq consumed by the simulation (−1 = none yet on this connection). Sent as `a`. */
  lastSeq: number;
  /** Last consumed input (reused with f:0 when the queue runs dry). */
  lastInput: ShipInput;
  physics: ShipPhysicsStats;
  /** Tick of the last broadside (for the FIRING flag). */
  firedAtTick: number;
  /** Simulation ms when the player disconnected (grace period start). */
  disconnectedAtMs: number;
  /** Simulation ms when the player became `dead`. */
  deadAtMs: number;
  /** Bumped whenever ent metadata (name, shipType, maxHp) changes → re-sent to viewers. */
  metaVersion: number;
  /** Per-tick cache of this ship's wire row (see World.rowOf). */
  rowTick: number;
  row: EntityRow | null;
  rowJson: string;
  /** Scratch marker for the per-client visibility pass (see World.prepare). */
  seenStamp: number;
}

export interface CannonBall {
  id: number;
  ownerId: string;
  ownerEid: number;
  damage: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  spawnMs: number;
}

export interface GoldObject {
  id: string;
  x: number;
  y: number;
  z: number;
  gold: number;
  /** Simulation ms when dropped. */
  created: number;
}

/** Things clients must hear about this tick (filtered per client by buildMessages). */
export type WorldEvent =
  | { kind: "fire"; eid: number; balls: BallRow[] }
  | { kind: "hit"; targetEid: number; ownerEid: number; ball: number; hp: number }
  | { kind: "sunk"; eid: number }
  | { kind: "goldCollected"; playerId: string; gold: number; newTotalGold: number }
  | { kind: "splash"; ball: number; x: number; z: number };

/** Side effects for the wiring layer (Redis, leaderboard, Segment). Run outside the tick. */
export type WorldEffect =
  | { type: "playerSunk"; playerId: string; name: string; gold: number; x: number; z: number }
  | { type: "goldCollected"; playerId: string; gold: number; newTotalGold: number; x: number; z: number }
  | { type: "playerRemoved"; reason: "disconnected" | "dead"; player: PlayerState };

/** Per-client view state: which entities (eid → metaVersion) the client currently knows. */
export interface ClientView {
  known: Map<number, number>;
}

export interface WorldOptions {
  /** Land/ice for collision, ball splashes and spawn checks (default ALWAYS_WATER_TEST_FIELD:
   *  open ocean + polar ice). The server passes the SDF field from server/game/landLoader.ts. */
  land?: LandQuery;
  /** Random source for spawn positions (default Math.random). */
  rng?: () => number;
  /** Wall clock for `st` and `lastSeen` (default Date.now). */
  wallClock?: () => number;
}

export interface NewPlayerInit {
  id: string;
  name: string;
  shipType: string;
  x?: number;
  z?: number;
  rotationY?: number;
  gold?: number;
}

// ---------------------------------------------------------------------------------------------
// Spatial hash grid (sparse, x wraps, z clamped)
// ---------------------------------------------------------------------------------------------

/**
 * Sparse uniform grid in COORDINATE space (WORLD_SPEC §3): a Map of non-empty cells keyed
 * `cz * cols + cx`, cells `cellSize` coordinate units square (800 × 400 cells over the Earth at
 * the default 500). Rebuilt every tick (cell arrays are pooled). `query` takes a METRIC radius and
 * widens the x span by 1/metricX at the query edge nearest the pole, so it never misses a ship;
 * callers do the exact metric distance test.
 */
export class SpatialGrid<T extends { x: number; z: number }> {
  readonly cols: number;
  readonly rows: number;
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];

  constructor(readonly cellSize: number = GRID_CELL) {
    this.cols = Math.max(1, Math.ceil(WORLD_C / cellSize));
    this.rows = Math.max(1, Math.ceil(WORLD_H / cellSize));
  }

  /** Number of non-empty cells (diagnostics / tests). */
  get cellCount(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.forEach((arr) => {
      arr.length = 0;
      this.pool.push(arr);
    });
    this.cells.clear();
  }

  insert(item: T): void {
    const key = this.cellRow(item.z) * this.cols + this.cellCol(item.x);
    let arr = this.cells.get(key);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(key, arr);
    }
    arr.push(item);
  }

  private cellCol(x: number): number {
    return Math.min(this.cols - 1, Math.floor(wrap(x, WORLD_C) / this.cellSize));
  }

  private cellRow(z: number): number {
    const r = Math.floor(clampZ(z) / this.cellSize);
    return r >= this.rows ? this.rows - 1 : r;
  }

  /** Push every item in cells within metric `radius` of (x, z) into `out` (no duplicates, unfiltered). */
  query(x: number, z: number, radius: number, out: T[]): T[] {
    const z0 = clampZ(z - radius);
    const z1 = clampZ(z + radius);
    // metricX = sin(πz/H) is concave, so its minimum over [z0, z1] is at an end (nearest the pole).
    const mx = Math.max(MIN_METRIC_X, Math.min(metricX(z0), metricX(z1)));
    const rx = radius / mx;
    const r0 = this.cellRow(z0);
    const r1 = this.cellRow(z1);
    const xw = wrap(x, WORLD_C);
    let cFrom = Math.floor((xw - rx) / this.cellSize);
    let cTo = Math.floor((xw + rx) / this.cellSize);
    const full = cTo - cFrom + 1 >= this.cols;
    if (full) {
      cFrom = 0;
      cTo = this.cols - 1;
    }
    for (let r = r0; r <= r1; r++) {
      const base = r * this.cols;
      for (let c = cFrom; c <= cTo; c++) {
        const col = full ? c : ((c % this.cols) + this.cols) % this.cols;
        const cell = this.cells.get(base + col);
        if (cell) for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

export class World {
  /** x wraps at this (WORLD_C). Kept for older call sites. */
  readonly mapWidth = WORLD_C;
  /** z extent (WORLD_H); z does not wrap. */
  readonly mapHeight = WORLD_H;
  /** Land/ice used by the tick (collision, splashes, spawn checks). */
  readonly land: LandQuery;
  /** Completed ticks. */
  tick = 0;
  readonly players = new Map<string, WorldPlayer>();
  readonly byEid = new Map<number, WorldPlayer>();
  balls: CannonBall[] = [];
  gold: GoldObject[] = [];
  /** Events produced by the most recent step (cleared at the start of each step). */
  events: WorldEvent[] = [];
  /** Side effects not yet drained by the wiring layer. */
  effects: WorldEffect[] = [];
  readonly views = new Map<string, ClientView>();

  private nextEid = 1;
  private nextBallId = 1;
  private nextGoldId = 1;
  private readonly rng: () => number;
  private readonly wallClock: () => number;
  private readonly shipGrid: SpatialGrid<WorldPlayer>;
  private readonly scratch: WorldPlayer[] = [];
  /** Wall time captured at the end of the last step (snapshot `st`). */
  private stepWallMs = 0;
  /** Incremented per visibility pass; compared against WorldPlayer.seenStamp. */
  private viewStamp = 0;

  constructor(opts: WorldOptions = {}) {
    this.land = opts.land ?? ALWAYS_WATER_TEST_FIELD;
    this.rng = opts.rng ?? Math.random;
    this.wallClock = opts.wallClock ?? Date.now;
    this.shipGrid = new SpatialGrid<WorldPlayer>(GRID_CELL);
  }

  /**
   * A random water point near `center` (uniform jitter of ±`jitter` metric units per axis) with
   * land distance > `minWater`. Retries SPAWN_ATTEMPTS times; if none qualifies it returns the
   * deepest-water candidate seen, counting `center` itself (stepShip's push-out handles the rest).
   */
  spawnPoint(
    center: { x: number; z: number } = DEFAULT_SPAWN_CENTER,
    jitter: number = DEFAULT_SPAWN_JITTER,
    minWater: number = SPAWN_MIN_WATER,
  ): { x: number; z: number } {
    let bestX = wrap(center.x, WORLD_C);
    let bestZ = clampZ(center.z);
    let bestD = this.land.distance(bestX, bestZ);
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const z = clampZ(center.z + (this.rng() * 2 - 1) * jitter);
      const x = wrap(center.x + ((this.rng() * 2 - 1) * jitter) / metricX(z), WORLD_C);
      const d = this.land.distance(x, z);
      if (d > minWater) return { x, z };
      if (d > bestD) {
        bestX = x;
        bestZ = z;
        bestD = d;
      }
    }
    return { x: bestX, z: bestZ };
  }

  /**
   * Spawn at a port (card W4, WORLD_SPEC §4.3/§5): a random starter port unless `port` is given, a
   * point within PORT_SPAWN_JITTER of its `spawn` with land distance > PORT_SPAWN_MIN_WATER, and a
   * heading pointing out to sea (the land normal; away from the town where the field is flat).
   */
  starterSpawn(port?: GamePort): { x: number; z: number; rotationY: number; port: GamePort } {
    const p = port ?? STARTER_PORTS[Math.min(STARTER_PORTS.length - 1, Math.floor(this.rng() * STARTER_PORTS.length))];
    const s = this.spawnPoint(p.spawn, PORT_SPAWN_JITTER, PORT_SPAWN_MIN_WATER);
    return { x: s.x, z: s.z, rotationY: seawardRotation(this.land, s.x, s.z, p), port: p };
  }

  /** Simulation time in ms (tick * 50). */
  get timeMs(): number {
    return this.tick * TICK_MS;
  }

  // ---- players --------------------------------------------------------------------------

  /** Create a brand-new player with full stats for `shipType` (starterSpawn() unless x/z given). */
  createPlayer(init: NewPlayerInit): WorldPlayer {
    const stats = SHIP_STATS[init.shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
    const spawn = init.x === undefined || init.z === undefined ? this.starterSpawn() : null;
    const rotationY = init.rotationY ?? spawn?.rotationY ?? 0;
    const state: PlayerState = {
      id: init.id,
      playerId: init.id,
      name: init.name,
      shipType: init.shipType,
      x: spawn ? spawn.x : wrap(init.x!, WORLD_C),
      y: 0,
      z: spawn ? spawn.z : clampZ(init.z!),
      rotationY,
      speed: 0,
      maxSpeed: stats.speed,
      direction: { x: Math.sin(rotationY), y: 0, z: Math.cos(rotationY) },
      hp: stats.hullStrength,
      maxHp: stats.hullStrength,
      gold: init.gold ?? stats.startingGold,
      cargoCapacity: stats.cargoCapacity,
      cargoUsed: 0,
      repairCost: stats.repairCost,
      firing: false,
      canFire: true,
      lastFired: -1e12,
      reloadTime: stats.cannonReload * 1000,
      damage: stats.cannonDamage,
      cannonCount: stats.cannonCount,
      sunk: false,
      connected: true,
      isActive: true,
      lastSeen: this.wallClock(),
      dead: false,
      worldVersion: WORLD_VERSION,
    };
    return this.insert(state);
  }

  /**
   * Re-insert a player loaded from Redis (or any PlayerState-like record). Starts at rest.
   * Migration (card W4): records from the old torus (no/older `worldVersion`) or whose position is
   * on land are moved to a random starter port's spawn (starterSpawn), facing out to sea. Everything
   * else (gold, ship type and stats, hp, cargo) is kept as stored.
   */
  restorePlayer(p: Partial<PlayerState> & { id: string; name: string; shipType: string }): WorldPlayer {
    const stats = SHIP_STATS[p.shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP];
    let rotationY = p.rotationY ?? 0;
    let x = wrap(p.x ?? 0, WORLD_C);
    let z = clampZ(p.z ?? 0);
    if (needsRelocation(p, this.land)) {
      const s = this.starterSpawn();
      x = s.x;
      z = s.z;
      rotationY = s.rotationY;
    }
    const state: PlayerState = {
      id: p.id,
      playerId: p.playerId ?? p.id,
      name: p.name,
      shipType: p.shipType,
      x,
      y: 0,
      z,
      rotationY,
      speed: 0,
      maxSpeed: p.maxSpeed || stats.speed,
      direction: { x: Math.sin(rotationY), y: 0, z: Math.cos(rotationY) },
      hp: p.hp ?? stats.hullStrength,
      maxHp: p.maxHp || stats.hullStrength,
      gold: p.gold ?? 0,
      cargoCapacity: p.cargoCapacity || stats.cargoCapacity,
      cargoUsed: p.cargoUsed ?? 0,
      repairCost: p.repairCost || stats.repairCost,
      firing: false,
      canFire: true,
      lastFired: -1e12,
      reloadTime: p.reloadTime || stats.cannonReload * 1000,
      damage: p.damage || stats.cannonDamage,
      cannonCount: p.cannonCount || stats.cannonCount,
      sunk: p.sunk ?? false,
      connected: p.connected ?? false,
      isActive: p.isActive ?? true,
      lastSeen: p.lastSeen ?? this.wallClock(),
      dead: p.dead ?? false,
      worldVersion: WORLD_VERSION,
    };
    return this.insert(state);
  }

  private insert(state: PlayerState): WorldPlayer {
    const existing = this.players.get(state.id);
    if (existing) this.removePlayer(state.id);
    const p: WorldPlayer = {
      ...state,
      eid: this.nextEid++,
      inputQueue: [],
      highestSeq: -1,
      lastSeq: -1,
      lastInput: { ...NEUTRAL_INPUT },
      physics: { ...shipPhysicsStats(state.shipType), maxSpeed: state.maxSpeed },
      firedAtTick: -1e9,
      disconnectedAtMs: state.connected ? 0 : this.timeMs,
      deadAtMs: state.dead ? this.timeMs : 0,
      metaVersion: 1,
      rowTick: -1,
      row: null,
      rowJson: "",
      seenStamp: 0,
    };
    this.players.set(p.id, p);
    this.byEid.set(p.eid, p);
    return p;
  }

  getPlayer(id: string): WorldPlayer | undefined {
    return this.players.get(id);
  }

  /** Remove a player immediately (no effect emitted). Viewers get `gone` on their next build. */
  removePlayer(id: string): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    this.players.delete(id);
    this.byEid.delete(p.eid);
    this.views.delete(id);
    return true;
  }

  /** Mark connected / disconnected. Disconnecting clears the input queue (ship coasts to a stop)
   *  and starts the grace period; connecting cancels it. */
  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.lastSeen = this.wallClock();
    if (!connected) {
      p.disconnectedAtMs = this.timeMs;
      p.inputQueue.length = 0;
      p.lastInput = { ...NEUTRAL_INPUT };
    }
  }

  /** Change ship type (upgrade): refresh stats derived from SHIP_STATS and re-announce metadata. */
  setShipType(id: string, shipType: string): void {
    const p = this.players.get(id);
    const stats = SHIP_STATS[shipType];
    if (!p || !stats) return;
    p.shipType = shipType;
    p.maxHp = stats.hullStrength;
    p.hp = stats.hullStrength;
    p.cargoCapacity = stats.cargoCapacity;
    p.maxSpeed = stats.speed;
    p.reloadTime = stats.cannonReload * 1000;
    p.damage = stats.cannonDamage;
    p.cannonCount = stats.cannonCount;
    p.repairCost = stats.repairCost;
    p.physics = shipPhysicsStats(shipType);
    p.metaVersion++;
  }

  /** Bump a player's metadata version (call after changing name/shipType/maxHp by hand). */
  touchMeta(id: string): void {
    const p = this.players.get(id);
    if (p) p.metaVersion++;
  }

  // ---- inputs ---------------------------------------------------------------------------

  /** Queue one validated input. Ignores out-of-order/duplicate seqs and inputs from disconnected,
   *  sunk or dead players. Caps the queue at MAX_INPUT_QUEUE by dropping the oldest. */
  queueInput(id: string, input: InputMessage): boolean {
    const p = this.players.get(id);
    if (!p || !p.connected || p.dead) return false;
    if (input.s <= p.highestSeq) return false;
    p.highestSeq = input.s;
    p.inputQueue.push(input);
    while (p.inputQueue.length > MAX_INPUT_QUEUE) p.inputQueue.shift();
    return true;
  }

  // ---- client views ---------------------------------------------------------------------

  /** Start (or restart) a client's view of the world. Resets the known-entity set (everything is
   *  re-announced with `ent`) and the per-connection input sequence tracking. */
  attachClient(id: string): void {
    this.views.set(id, { known: new Map() });
    const p = this.players.get(id);
    if (p) {
      p.inputQueue.length = 0;
      p.highestSeq = -1;
      p.lastSeq = -1;
    }
  }

  detachClient(id: string): void {
    this.views.delete(id);
  }

  // ---- tick -----------------------------------------------------------------------------

  /** Advance exactly one fixed tick. Synchronous; never awaits; returns nothing. */
  step(): void {
    this.tick++;
    const now = this.timeMs;
    this.events = [];

    // 1. Removals (grace period / dead).
    this.players.forEach((p) => {
      if (p.dead && now - p.deadAtMs > DEAD_REMOVAL_MS) {
        this.removePlayer(p.id);
        this.effects.push({ type: "playerRemoved", reason: "dead", player: toPlayerState(p) });
      } else if (!p.connected && now - p.disconnectedAtMs > GRACE_PERIOD) {
        this.removePlayer(p.id);
        this.effects.push({ type: "playerRemoved", reason: "disconnected", player: toPlayerState(p) });
      }
    });

    // 2. Movement (consume inputs).
    const firers: WorldPlayer[] = [];
    this.players.forEach((p) => {
      if (p.sunk || p.dead) {
        if (p.inputQueue.length) {
          p.lastSeq = p.inputQueue[p.inputQueue.length - 1].s;
          p.inputQueue.length = 0;
        }
        p.speed = 0;
        return;
      }
      let wantsFire = false;
      if (!p.connected) {
        this.applyStep(p, NEUTRAL_INPUT);
      } else if (p.inputQueue.length === 0) {
        // Starved: repeat the last input without firing.
        this.applyStep(p, { th: p.lastInput.th, ru: p.lastInput.ru, f: 0 });
      } else {
        const n = p.inputQueue.length > INPUT_CATCHUP_THRESHOLD ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const inp = p.inputQueue.shift()!;
          p.lastSeq = inp.s;
          p.lastInput = { th: inp.th, ru: inp.ru, f: inp.f };
          if (inp.f === 1) wantsFire = true;
          this.applyStep(p, p.lastInput);
        }
      }
      if (wantsFire) firers.push(p);
    });

    // 3. Spatial grid (all ships that exist on the map).
    this.shipGrid.clear();
    this.players.forEach((p) => {
      if (!p.dead) this.shipGrid.insert(p);
    });

    // 4. Cannonballs: move, hit, expire.
    this.stepBalls(now);

    // 5. New broadsides (spawned after ball stepping: a ball fired at tick k sits at its spawn
    //    point at tick k, matching the client's analytic p0 + dir*speed*60*t).
    for (const p of firers) this.tryFire(p, now);

    // 6. Gold: expire + pickup.
    this.stepGold(now);

    // 7. Derived per-player flags.
    this.players.forEach((p) => {
      p.firing = this.tick - p.firedAtTick < FIRING_FLAG_TICKS;
      p.canFire = !p.sunk && !p.dead && now - p.lastFired >= p.reloadTime;
    });

    this.stepWallMs = this.wallClock();
  }

  private applyStep(p: WorldPlayer, input: ShipInput): void {
    const next = stepShip(
      { x: p.x, z: p.z, rotationY: p.rotationY, velocity: p.speed },
      input,
      p.physics,
      this.land,
    );
    p.x = next.x;
    p.z = next.z;
    p.rotationY = next.rotationY;
    p.speed = next.velocity;
    p.direction.x = Math.sin(next.rotationY);
    p.direction.z = Math.cos(next.rotationY);
  }

  private tryFire(p: WorldPlayer, now: number): void {
    if (p.sunk || p.dead || !p.connected) return;
    if (now - p.lastFired < p.reloadTime) return;
    p.lastFired = now;
    p.firedAtTick = this.tick;
    const spawns = spawnBroadside(p, p.cannonCount);
    const rows: BallRow[] = [];
    for (const s of spawns) {
      const ball: CannonBall = {
        id: this.nextBallId++,
        ownerId: p.id,
        ownerEid: p.eid,
        damage: p.damage,
        x: s.x,
        z: s.z,
        dx: s.dx,
        dz: s.dz,
        speed: s.speed ?? BALL_SPEED,
        spawnMs: now,
      };
      this.balls.push(ball);
      rows.push([ball.id, roundPos(s.x), roundPos(s.z), round4(s.dx), round4(s.dz)]);
    }
    this.events.push({ kind: "fire", eid: p.eid, balls: rows });
  }

  private stepBalls(now: number): void {
    const keep: CannonBall[] = [];
    const cand = this.scratch;
    for (const ball of this.balls) {
      const next = stepBall(ball, ball, TICK_DT);
      cand.length = 0;
      this.shipGrid.query(next.x, next.z, SHIP_HIT_RADIUS + ball.speed * 60 * TICK_DT, cand);
      let hit: WorldPlayer | null = null;
      for (const p of cand) {
        if (p.eid === ball.ownerEid || p.sunk || p.dead) continue;
        if (segmentHitsCircle(ball.x, ball.z, next.x, next.z, p.x, p.z, SHIP_HIT_RADIUS)) {
          hit = p;
          break;
        }
      }
      if (hit) {
        this.applyHit(hit, ball, now);
        continue;
      }
      // Land (incl. polar ice): check the midpoint too so a ball cannot skip a thin spit.
      const mid = stepBall(ball, ball, TICK_DT / 2);
      const landAt = ballHitsLand(this.land, mid.x, mid.z) ? mid : ballHitsLand(this.land, next.x, next.z) ? next : null;
      if (landAt) {
        this.events.push({ kind: "splash", ball: ball.id, x: landAt.x, z: landAt.z });
        continue;
      }
      ball.x = next.x;
      ball.z = next.z;
      if (now - ball.spawnMs >= BALL_LIFETIME_MS) continue;
      keep.push(ball);
    }
    this.balls = keep;
  }

  private applyHit(target: WorldPlayer, ball: CannonBall, now: number): void {
    const armor = (SHIP_STATS[target.shipType] ?? SHIP_STATS[SHIP_TYPES.SLOOP]).armor;
    const armorFactor = 1 - armor / 100;
    const damage = Math.round(ball.damage * armorFactor);
    target.hp = Math.max(0, target.hp - damage);
    this.events.push({ kind: "hit", targetEid: target.eid, ownerEid: ball.ownerEid, ball: ball.id, hp: target.hp });
    if (target.hp <= 0 && !target.sunk) {
      target.sunk = true;
      target.speed = 0;
      target.inputQueue.length = 0;
      this.events.push({ kind: "sunk", eid: target.eid });
      if (target.gold > 0) this.dropGold(target.x, target.z, target.gold, now);
      this.effects.push({
        type: "playerSunk",
        playerId: target.playerId,
        name: target.name,
        gold: target.gold,
        x: target.x,
        z: target.z,
      });
    }
  }

  /** Drop a gold object (used on sink; public for tests/tools). */
  dropGold(x: number, z: number, amount: number, now: number = this.timeMs): GoldObject {
    const g: GoldObject = { id: `gold-${this.nextGoldId++}`, x, y: 0, z, gold: amount, created: now };
    this.gold.push(g);
    return g;
  }

  private stepGold(now: number): void {
    if (this.gold.length === 0) return;
    const keep: GoldObject[] = [];
    const cand = this.scratch;
    const r2 = GOLD_COLLECTION_RADIUS * GOLD_COLLECTION_RADIUS;
    for (const g of this.gold) {
      if (now - g.created > GOLD_OBJECT_LIFETIME) continue;
      cand.length = 0;
      this.shipGrid.query(g.x, g.z, GOLD_COLLECTION_RADIUS, cand);
      let collector: WorldPlayer | null = null;
      for (const p of cand) {
        if (p.sunk || p.dead) continue;
        if (metricDistSq(p.x, p.z, g.x, g.z) < r2) {
          collector = p;
          break;
        }
      }
      if (!collector) {
        keep.push(g);
        continue;
      }
      collector.gold += g.gold;
      this.events.push({ kind: "goldCollected", playerId: collector.id, gold: g.gold, newTotalGold: collector.gold });
      this.effects.push({
        type: "goldCollected",
        playerId: collector.id,
        gold: g.gold,
        newTotalGold: collector.gold,
        x: g.x,
        z: g.z,
      });
    }
    this.gold = keep;
  }

  /** Take all pending side effects (the wiring layer runs them fire-and-forget). */
  drainEffects(): WorldEffect[] {
    const out = this.effects;
    this.effects = [];
    return out;
  }

  // ---- per-client messages --------------------------------------------------------------

  /** Ships (other than `self`) within `radius` of (x, z), excluding dead players. */
  visibleShips(self: WorldPlayer, radius: number = INTEREST_RADIUS): WorldPlayer[] {
    const cand = this.scratch;
    cand.length = 0;
    this.shipGrid.query(self.x, self.z, radius, cand);
    const r2 = radius * radius;
    const out: WorldPlayer[] = [];
    for (let i = 0; i < cand.length; i++) {
      const o = cand[i];
      // (the grid is rebuilt in step(); skip players removed since then)
      if (o === self || o.dead || this.byEid.get(o.eid) !== o) continue;
      // Inline metric distance (hot path): x is always wrapped into [0, C).
      const dz = o.z - self.z;
      if (dz * dz > r2) continue;
      let dx = Math.abs(o.x - self.x);
      if (dx > WORLD_C / 2) dx = WORLD_C - dx;
      dx *= metricX((o.z + self.z) / 2);
      if (dx * dx + dz * dz <= r2) out.push(o);
    }
    return out;
  }

  /** Shared part of buildMessages/buildFrames: view diff + events + snapshot head (no rows). */
  private prepare(id: string): { out: ServerMessage[]; visible: WorldPlayer[]; snap: Omit<SnapshotMessage, "e"> } | null {
    const p = this.players.get(id);
    const view = this.views.get(id);
    if (!p || !view) return null;
    const out: ServerMessage[] = [];

    // View diff.
    const visible = this.visibleShips(p);
    const stamp = ++this.viewStamp;
    for (const o of visible) {
      o.seenStamp = stamp;
      if (view.known.get(o.eid) !== o.metaVersion) {
        view.known.set(o.eid, o.metaVersion);
        out.push({ t: "ent", eid: o.eid, id: o.id, name: o.name, shipType: o.shipType, maxHp: o.maxHp });
      }
    }
    view.known.forEach((_v, eid) => {
      if (!this.seenWith(eid, stamp)) {
        view.known.delete(eid);
        out.push({ t: "gone", eid });
      }
    });

    // Events.
    for (const ev of this.events) {
      switch (ev.kind) {
        case "fire":
          if (ev.eid === p.eid || this.seenWith(ev.eid, stamp)) {
            out.push({ t: "fire", eid: ev.eid, k: this.tick, balls: ev.balls, spd: BALL_SPEED, life: BALL_LIFETIME_MS });
          }
          break;
        case "hit":
          if (ev.targetEid === p.eid) out.push({ t: "hit", target: "me", ball: ev.ball, hp: ev.hp });
          else if (this.seenWith(ev.targetEid, stamp) || ev.ownerEid === p.eid) {
            out.push({ t: "hit", target: ev.targetEid, ball: ev.ball, hp: ev.hp });
          }
          break;
        case "sunk":
          if (ev.eid === p.eid) out.push({ t: "sunk", eid: "me" });
          else if (this.seenWith(ev.eid, stamp)) out.push({ t: "sunk", eid: ev.eid });
          break;
        case "goldCollected":
          if (ev.playerId === p.id) out.push({ t: "goldCollected", gold: ev.gold, newTotalGold: ev.newTotalGold });
          break;
        case "splash":
          if (metricDistSq(p.x, p.z, ev.x, ev.z) <= INTEREST_RADIUS * INTEREST_RADIUS) {
            out.push({ t: "splash", x: roundPos(ev.x), z: roundPos(ev.z), land: 1, ball: ev.ball });
          }
          break;
      }
    }

    // Snapshot (without the entity rows; callers append them).
    const now = this.timeMs;
    const snap: Omit<SnapshotMessage, "e"> = {
      t: "s",
      k: this.tick,
      st: this.stepWallMs || this.wallClock(),
      a: p.lastSeq,
      me: {
        eid: p.eid,
        x: p.x,
        z: p.z,
        r: p.rotationY,
        v: p.speed,
        hp: p.hp,
        maxHp: p.maxHp,
        gold: p.gold,
        cargoUsed: p.cargoUsed,
        cargoCapacity: p.cargoCapacity,
        sunk: p.sunk,
        canFire: p.canFire,
        reloadMs: Math.max(0, Math.ceil(p.reloadTime - (now - p.lastFired))),
        shipType: p.shipType,
      },
    };
    if (this.tick % GOLD_SNAPSHOT_EVERY === 0) {
      const g: GoldRow[] = [];
      const r2 = GOLD_INTEREST_RADIUS * GOLD_INTEREST_RADIUS;
      for (const gold of this.gold) {
        if (metricDistSq(p.x, p.z, gold.x, gold.z) <= r2) {
          g.push([gold.id, roundPos(gold.x), roundPos(gold.z), gold.gold]);
        }
      }
      snap.g = g;
    }
    return { out, visible, snap };
  }

  /** Was entity `eid` marked visible in the view pass identified by `stamp`? */
  private seenWith(eid: number, stamp: number): boolean {
    const o = this.byEid.get(eid);
    return o !== undefined && o.seenStamp === stamp;
  }

  /** This tick's packed EntityRow for `o` (computed once per tick, shared by all viewers). */
  private rowOf(o: WorldPlayer): EntityRow {
    if (o.rowTick !== this.tick || !o.row) {
      o.row = packEntityRow({
        eid: o.eid,
        x: o.x,
        z: o.z,
        r: o.rotationY,
        v: o.speed,
        hp: o.hp,
        flags: makeFlags(o.sunk, !o.connected, o.firing),
      });
      o.rowJson = JSON.stringify(o.row);
      o.rowTick = this.tick;
    }
    return o.row;
  }

  /**
   * Build this client's messages for the tick just stepped, in send order:
   * `ent`/`gone` (view diff) → events it can see → snapshot `s`. Mutates the client's known set.
   * Never includes another player's gold/cargo/inventory. Returns [] if the client is not attached.
   * Call once per client per tick, right after `step()` (entity rows are cached per tick).
   */
  buildMessages(id: string): ServerMessage[] {
    const prep = this.prepare(id);
    if (!prep) return [];
    const e: EntityRow[] = new Array(prep.visible.length);
    for (let i = 0; i < prep.visible.length; i++) e[i] = this.rowOf(prep.visible[i]);
    prep.out.push({ ...prep.snap, e } as SnapshotMessage);
    return prep.out;
  }

  /**
   * Same as `buildMessages` but already serialized to JSON text frames (what the server sends).
   * The snapshot frame splices in each entity row's per-tick cached JSON instead of
   * re-stringifying the same row for every viewer. JSON.parse(frame) equals the buildMessages
   * object (the `e` key comes last).
   */
  buildFrames(id: string): string[] {
    const prep = this.prepare(id);
    if (!prep) return [];
    const frames: string[] = new Array(prep.out.length + 1);
    for (let i = 0; i < prep.out.length; i++) frames[i] = JSON.stringify(prep.out[i]);
    const parts: string[] = new Array(prep.visible.length);
    for (let i = 0; i < prep.visible.length; i++) {
      const o = prep.visible[i];
      this.rowOf(o);
      parts[i] = o.rowJson;
    }
    const head = JSON.stringify(prep.snap);
    frames[prep.out.length] = `${head.slice(0, -1)},"e":[${parts.join(",")}]}`;
    return frames;
  }
}

/** Plain persisted copy of a player (drops netcode bookkeeping). */
export function toPlayerState(p: WorldPlayer): PlayerState {
  return {
    id: p.id,
    playerId: p.playerId,
    name: p.name,
    shipType: p.shipType,
    x: p.x,
    y: p.y,
    z: p.z,
    rotationY: p.rotationY,
    speed: p.speed,
    maxSpeed: p.maxSpeed,
    direction: { x: p.direction.x, y: p.direction.y, z: p.direction.z },
    hp: p.hp,
    maxHp: p.maxHp,
    gold: p.gold,
    cargoCapacity: p.cargoCapacity,
    cargoUsed: p.cargoUsed,
    repairCost: p.repairCost,
    firing: p.firing,
    canFire: p.canFire,
    lastFired: p.lastFired,
    reloadTime: p.reloadTime,
    damage: p.damage,
    cannonCount: p.cannonCount,
    sunk: p.sunk,
    connected: p.connected,
    isActive: p.isActive,
    lastSeen: p.lastSeen,
    dead: p.dead,
    worldVersion: p.worldVersion ?? WORLD_VERSION,
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------------------------
// Spawn helpers (card W4)
// ---------------------------------------------------------------------------------------------

/** True if a stored record must be moved to a starter port: old coordinate system (no/other
 *  `worldVersion`) or a saved position on land (distance < 0). */
export function needsRelocation(p: { x?: number; z?: number; worldVersion?: number }, land: LandQuery): boolean {
  if (Number(p.worldVersion) !== WORLD_VERSION) return true;
  return land.distance(wrap(p.x ?? 0, WORLD_C), clampZ(p.z ?? 0)) < 0;
}

/**
 * rotationY whose forward direction points out to sea at (x, z): along the land normal (toward
 * deeper water). Where the field is flat (deep water, normal = 0) it points away from the port's
 * town instead. Forward motion is (−sin r, −cos r) in metric (x, z), so r = atan2(−dx, −dz).
 */
export function seawardRotation(land: LandQuery, x: number, z: number, port?: { x: number; z: number }): number {
  const n = land.normal(x, z);
  let dx = n.nx;
  let dz = n.nz;
  if (Math.hypot(dx, dz) < 0.5 && port) {
    const d = metricDelta(port.x, port.z, x, z);
    dx = d.dx;
    dz = d.dz;
  }
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(-dx, -dz);
}
