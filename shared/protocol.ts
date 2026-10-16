/**
 * Wire protocol for the `/game-ws` WebSocket (see docs/netcode/PROTOCOL.md §3, §4, §6).
 *
 * Pure types + tiny helpers shared by server and client. No imports from `client/` or `server/`.
 * JSON text frames. New messages use the key `t` for their type; legacy messages the UI already
 * relies on keep `type` (backward compat, PROTOCOL §3).
 *
 * Units: positions in world units, rotation in radians, velocity in units per 1/60 s
 * (negative = forward), times in milliseconds unless the name says otherwise.
 */

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Ships within this wrapped distance (world units) of a client are sent in its snapshots. */
export const INTEREST_RADIUS = 2000;
/** Gold objects within this wrapped distance (world units) are sent (every GOLD_SNAPSHOT_EVERY ticks). */
export const GOLD_INTEREST_RADIUS = 1000;
/** Gold rows are included in the snapshot only every Nth tick. */
export const GOLD_SNAPSHOT_EVERY = 10;
/** Spatial hash grid cell size, world units. */
export const GRID_CELL = 500;
/** Remote entities are rendered this far (ms) behind the estimated server time. */
export const INTERP_DELAY_MS = 100;
/** Max remote extrapolation (ms) on interpolation-buffer underrun, then hold. */
export const MAX_EXTRAPOLATION_MS = 200;
/** Server keeps at most this many queued inputs per player (drops oldest). */
export const MAX_INPUT_QUEUE = 10;
/** If more than this many inputs are queued, the server consumes 2 per tick (catch-up). */
export const INPUT_CATCHUP_THRESHOLD = 3;
/** Client sends `ping` this often (ms). */
export const PING_INTERVAL_MS = 2000;
/** Server ws-level heartbeat ping interval (ms); 2 missed pongs → terminate. */
export const HEARTBEAT_INTERVAL_MS = 15000;
/** Client snaps (instead of smoothing) its own ship when prediction error exceeds this (units). */
export const SNAP_ERROR_DISTANCE = 150;
/** Max player name length accepted by parseClientMessage. */
export const MAX_NAME_LENGTH = 32;
/** Max length of id-like strings (player ids, ship types) accepted by parseClientMessage. */
export const MAX_ID_LENGTH = 128;
/** Max quantity accepted in one trade message. */
export const MAX_TRADE_QUANTITY = 100000;
/** Input sequence numbers are integers in [0, MAX_SEQ]. */
export const MAX_SEQ = 0x7fffffff;

/** Entity flag bits (EntityRow[6]). */
export const FLAG_SUNK = 1;
export const FLAG_DISCONNECTED = 2;
export const FLAG_FIRING = 4;
export const EntityFlags = Object.freeze({ SUNK: FLAG_SUNK, DISCONNECTED: FLAG_DISCONNECTED, FIRING: FLAG_FIRING });

// ---------------------------------------------------------------------------------------------
// Rounding helpers (keep snapshots small; x/z 1 decimal, rotation 3 decimals)
// ---------------------------------------------------------------------------------------------

/** Round to `decimals` decimal places. */
export function roundTo(v: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}
/** Round a position coordinate for the wire (1 decimal). */
export const roundPos = (v: number): number => roundTo(v, 1);
/** Round a rotation (radians) for the wire (3 decimals). */
export const roundRot = (v: number): number => roundTo(v, 3);
/** Round a velocity (units per 1/60 s) for the wire (2 decimals). */
export const roundVel = (v: number): number => roundTo(v, 2);

// ---------------------------------------------------------------------------------------------
// Client → server (PROTOCOL §4)
// ---------------------------------------------------------------------------------------------

/** Join with a new ship. Legacy shape (uses `type`). */
export interface ConnectMessage {
  type: "connect";
  name: string;
  shipType: string;
  tempPlayerId?: string;
}
/** Re-join with a stored player id. Legacy shape (uses `type`). */
export interface ReconnectMessage {
  type: "reconnect";
  id: string;
  name: string;
  tempPlayerId?: string;
}
/** One client sim step of intent (20/s). `s` = monotonically increasing sequence number.
 *  th: 1 = W ahead, −1 = S reverse; ru: 1 = left, −1 = right; f: 1 = fire. */
export interface InputMessage {
  t: "input";
  s: number;
  th: -1 | 0 | 1;
  ru: -1 | 0 | 1;
  f: 0 | 1;
}
/** RTT / clock probe; `c` = client time in ms (echoed back in `pong`). */
export interface PingMessage {
  t: "ping";
  c: number;
}
export interface TradeMessage {
  type: "trade";
  portId: number;
  action: "buy" | "sell";
  goodId: number;
  quantity: number;
}
export interface UpgradeShipMessage {
  type: "upgradeShip";
  portId: number;
}
export interface RepairShipMessage {
  type: "repairShip";
  portId: number;
}
export interface ScuttleMessage {
  type: "scuttle";
}

export type ClientMessage =
  | ConnectMessage
  | ReconnectMessage
  | InputMessage
  | PingMessage
  | TradeMessage
  | UpgradeShipMessage
  | RepairShipMessage
  | ScuttleMessage;

/** The discriminator of a ClientMessage, whichever key (`t` or `type`) it uses. */
export type ClientMessageKind =
  | "connect" | "reconnect" | "input" | "ping" | "trade" | "upgradeShip" | "repairShip" | "scuttle";
export function clientMessageKind(m: ClientMessage): ClientMessageKind {
  return "t" in m ? m.t : m.type;
}

// ---------------------------------------------------------------------------------------------
// Server → client (PROTOCOL §6, plus kept legacy messages §3)
// ---------------------------------------------------------------------------------------------

/** Full private state of the receiving player (only ever sent to that player). */
export interface SelfState {
  /** Own entity id, so the client can recognise its own `fire` events. (Addition to §6.) */
  eid?: number;
  x: number;
  z: number;
  /** rotationY, radians */
  r: number;
  /** velocity, units per 1/60 s (negative = forward) */
  v: number;
  hp: number;
  maxHp: number;
  gold: number;
  cargoUsed: number;
  cargoCapacity: number;
  sunk: boolean;
  canFire: boolean;
  /** ms until the cannons are reloaded (0 = ready) */
  reloadMs: number;
  shipType: string;
}

/** Another visible ship: [eid, x, z, rotationY, velocity, hp, flags]. */
export type EntityRow = [eid: number, x: number, z: number, r: number, v: number, hp: number, flags: number];
/** A gold object in range: [id, x, z, goldAmount]. */
export type GoldRow = [id: string, x: number, z: number, gold: number];
/** One cannonball of a `fire` event: [ballId, x, z, dx, dz] (spawn point + unit direction). */
export type BallRow = [id: number, x: number, z: number, dx: number, dz: number];

/** Unpacked form of an EntityRow. */
export interface EntityState {
  eid: number;
  x: number;
  z: number;
  r: number;
  v: number;
  hp: number;
  flags: number;
}

/** Per-tick snapshot. */
export interface SnapshotMessage {
  t: "s";
  /** server tick number */
  k: number;
  /** server time (ms, Date.now()) when the snapshot was built */
  st: number;
  /** last input seq the server processed for this client (for reconciliation) */
  a: number;
  me: SelfState;
  e: EntityRow[];
  /** only every GOLD_SNAPSHOT_EVERY-th tick */
  g?: GoldRow[];
}
/** Entity metadata, sent when an entity enters view (and when it changes). */
export interface EntMessage {
  t: "ent";
  eid: number;
  id: string;
  name: string;
  shipType: string;
  maxHp: number;
  /** NPC1 (WORLD_SPEC §8): present (=1) only for AI ships. */
  npc?: 1;
  /** NPC1: faction id of an NPC (e.g. "spain", "pirates"); see server/game/npc/factions.ts. */
  faction?: string;
  /** NPC1: nameplate title of an NPC (e.g. "Spanish Navy"). */
  title?: string;
}
/** Max length of an `ent` faction/title string accepted by parseEntNpcMeta. */
export const MAX_NPC_LABEL_LENGTH = 64;
/**
 * NPC1: read the optional NPC fields of an `ent` message defensively (client side). Returns null for
 * a player ship; otherwise `{faction, title}` with malformed or over-long strings dropped.
 */
export function parseEntNpcMeta(m: unknown): { faction?: string; title?: string } | null {
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  if (o.npc !== 1) return null;
  const out: { faction?: string; title?: string } = {};
  if (typeof o.faction === "string" && o.faction.length > 0 && o.faction.length <= MAX_NPC_LABEL_LENGTH) out.faction = o.faction;
  if (typeof o.title === "string" && o.title.length > 0 && o.title.length <= MAX_NPC_LABEL_LENGTH) out.title = o.title;
  return out;
}
/** Entity left this client's view. */
export interface GoneMessage {
  t: "gone";
  eid: number;
}
/** A broadside was fired. `spd` = units per 1/60 s, `life` = ms. Clients simulate the balls. */
export interface FireMessage {
  t: "fire";
  eid: number;
  k: number;
  balls: BallRow[];
  spd: number;
  life: number;
}
/** A ball hit a ship. `hp` = target's hp after the hit. */
export interface HitMessage {
  t: "hit";
  target: number | "me";
  ball: number;
  hp: number;
}
/** A ship sank. `"me"` when the receiver's own ship sank. */
export interface SunkMessage {
  t: "sunk";
  eid: number | "me";
}
/** Sent to the collector only. */
export interface GoldCollectedMessage {
  t: "goldCollected";
  gold: number;
  newTotalGold: number;
}
/** Reply to `ping`: `c` echoes the client time, `st` is server time (ms). */
export interface PongMessage {
  t: "pong";
  c: number;
  st: number;
}

// ---- Legacy messages (keep `type`; world dumps players/cannonBalls/goldObjects are removed) ----

export interface WelcomeMessage {
  type: "welcome";
  message: string;
  timestamp: number;
}
/** `ship` is the SHIP_STATS entry for the player's ship type. */
export interface ConnectedMessage {
  type: "connected";
  playerId: string;
  name: string;
  ship: Record<string, unknown>;
  gold: number;
  timestamp: number;
}
export interface ReconnectedMessage {
  type: "reconnected";
  playerId: string;
  name: string;
  ship: Record<string, unknown>;
  gold: number;
  timestamp: number;
}
export interface TradeSuccessMessage {
  type: "tradeSuccess";
  action: "buy" | "sell";
  good: number;
  quantity: number;
  price: number;
  totalCost?: number;
  totalEarnings?: number;
  gold: number;
  inventory: unknown[];
  timestamp: number;
}
export interface UpgradeSuccessMessage {
  type: "upgradeSuccess";
  newShipType: string;
  gold: number;
  timestamp: number;
}
export interface RepairSuccessMessage {
  type: "repairSuccess";
  gold: number;
  hp: number;
  timestamp: number;
}
export interface GameEndMessage {
  type: "gameEnd";
  reason: string;
  score: number;
  message: string;
  leaderboard: unknown[];
  timestamp: number;
}
export interface ErrorMessage {
  type: "error" | "nameError";
  message: string;
  timestamp: number;
}

export type ServerMessage =
  | SnapshotMessage
  | EntMessage
  | GoneMessage
  | FireMessage
  | HitMessage
  | SunkMessage
  | GoldCollectedMessage
  | PongMessage
  | WelcomeMessage
  | ConnectedMessage
  | ReconnectedMessage
  | TradeSuccessMessage
  | UpgradeSuccessMessage
  | RepairSuccessMessage
  | GameEndMessage
  | ErrorMessage;

// ---------------------------------------------------------------------------------------------
// Entity row packing
// ---------------------------------------------------------------------------------------------

/** Build a wire EntityRow, rounding x/z to 1 decimal, r to 3, v to 2; hp and flags as integers. */
export function packEntityRow(s: EntityState): EntityRow {
  return [s.eid, roundPos(s.x), roundPos(s.z), roundRot(s.r), roundVel(s.v), Math.round(s.hp), s.flags | 0];
}

/** Inverse of packEntityRow (values are the rounded wire values). */
export function unpackEntityRow(row: EntityRow): EntityState {
  return { eid: row[0], x: row[1], z: row[2], r: row[3], v: row[4], hp: row[5], flags: row[6] };
}

/** Compose a flags bitfield. */
export function makeFlags(sunk: boolean, disconnected: boolean, firing: boolean): number {
  return (sunk ? FLAG_SUNK : 0) | (disconnected ? FLAG_DISCONNECTED : 0) | (firing ? FLAG_FIRING : 0);
}

/** Test a flag bit. */
export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Untrusted input parsing (server side)
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function unit(v: unknown): -1 | 0 | 1 {
  const n = typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}
function shortString(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}
function optShortString(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  return shortString(v, max);
}
function posInt(v: unknown): number | null {
  if (!isFiniteNum(v)) return null;
  const n = Math.floor(v);
  return n >= 0 && n <= MAX_SEQ ? n : null;
}

/** Type guard for an already-validated InputMessage shape. */
export function isInputMessage(m: unknown): m is InputMessage {
  return (
    isObj(m) &&
    m.t === "input" &&
    posInt(m.s) === m.s &&
    (m.th === -1 || m.th === 0 || m.th === 1) &&
    (m.ru === -1 || m.ru === 0 || m.ru === 1) &&
    (m.f === 0 || m.f === 1)
  );
}

/**
 * Validate and normalize an untrusted client frame (a raw JSON string, Buffer-decoded string, or
 * an already-parsed value). Returns a well-formed ClientMessage or `null` if it must be ignored.
 * Clamps rather than rejects where safe: input th/ru are clamped to {-1,0,1}, f to {0,1} and
 * the seq is floored to an integer. Names are trimmed and limited to MAX_NAME_LENGTH. Accepts the
 * discriminator under either `t` or `type`. Unknown fields are dropped.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 4096) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(data)) return null;
  const kind = typeof data.t === "string" ? data.t : typeof data.type === "string" ? data.type : null;

  switch (kind) {
    case "input": {
      const s = posInt(data.s);
      if (s === null) return null;
      return { t: "input", s, th: unit(data.th), ru: unit(data.ru), f: unit(data.f) === 1 ? 1 : 0 };
    }
    case "ping": {
      if (!isFiniteNum(data.c)) return null;
      return { t: "ping", c: data.c };
    }
    case "connect": {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      const shipType = shortString(data.shipType, MAX_ID_LENGTH);
      const tempPlayerId = optShortString(data.tempPlayerId, MAX_ID_LENGTH);
      if (!name || name.length > MAX_NAME_LENGTH || !shipType || tempPlayerId === null) return null;
      const m: ConnectMessage = { type: "connect", name, shipType };
      if (tempPlayerId !== undefined) m.tempPlayerId = tempPlayerId;
      return m;
    }
    case "reconnect": {
      const id = shortString(data.id, MAX_ID_LENGTH);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      const tempPlayerId = optShortString(data.tempPlayerId, MAX_ID_LENGTH);
      if (!id || !name || name.length > MAX_NAME_LENGTH || tempPlayerId === null) return null;
      const m: ReconnectMessage = { type: "reconnect", id, name };
      if (tempPlayerId !== undefined) m.tempPlayerId = tempPlayerId;
      return m;
    }
    case "trade": {
      const portId = posInt(data.portId);
      const goodId = posInt(data.goodId);
      const quantity = posInt(data.quantity);
      if (portId === null || goodId === null || quantity === null) return null;
      if (data.action !== "buy" && data.action !== "sell") return null;
      if (quantity < 1 || quantity > MAX_TRADE_QUANTITY) return null;
      return { type: "trade", portId, action: data.action, goodId, quantity };
    }
    case "upgradeShip":
    case "repairShip": {
      const portId = posInt(data.portId);
      if (portId === null) return null;
      return { type: kind, portId };
    }
    case "scuttle":
      return { type: "scuttle" };
    default:
      return null;
  }
}
