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
import { FIRE_ALL, FIRE_MASK, type BroadsideSide, type FireFlags } from "./physics";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Ships within this METRIC distance (world units, geo.ts metricDistSq) of a client are sent in its snapshots. */
export const INTEREST_RADIUS = 2000;
/** Gold objects within this METRIC distance (world units) are sent (every GOLD_SNAPSHOT_EVERY ticks). */
export const GOLD_INTEREST_RADIUS = 1000;
/** Gold rows are included in the snapshot only every Nth tick. */
export const GOLD_SNAPSHOT_EVERY = 10;
/** Spatial hash grid cell size, coordinate units (the grid is sparse; see server/game/world.ts). */
export const GRID_CELL = 500;
/** Remote entities are rendered this far (ms) behind the estimated server time. */
export const INTERP_DELAY_MS = 100;
/** Max remote extrapolation (ms) on interpolation-buffer underrun, then hold. */
export const MAX_EXTRAPOLATION_MS = 200;
/**
 * Server keeps at most this many queued inputs per player (drops oldest). 40 = 2 s of input: a
 * late burst after an uplink stall of up to ~2 s is simulated in full (catch-up), so the own ship
 * gets no correction. Was 10 (500 ms), which turned every longer stall into a backward jump.
 */
export const MAX_INPUT_QUEUE = 40;
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
/** Global chat: max characters (code points) of one chat line after sanitizing (longer text is cut). */
export const MAX_CHAT_LENGTH = 200;
/** Global chat: how many recent lines the server keeps in memory and replays on (re)join. */
export const CHAT_HISTORY_SIZE = 30;

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
 *  th: 1 = W ahead, −1 = S reverse; ru: 1 = left, −1 = right.
 *  f: fire bit flags (shared/physics.ts): 1 = FIRE_ALL (fire every loaded side; the legacy `f:1`
 *  of old clients), 2 = FIRE_PORT (left, Q), 4 = FIRE_STARBOARD (right, E); 0 = not firing. */
export interface InputMessage {
  t: "input";
  s: number;
  th: -1 | 0 | 1;
  ru: -1 | 0 | 1;
  f: FireFlags;
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
/** Global chat: send one line to everyone. `text` is sanitized by parseClientMessage (sanitizeChatText). */
export interface ChatSendMessage {
  t: "chat";
  text: string;
}

export type ClientMessage =
  | ConnectMessage
  | ReconnectMessage
  | InputMessage
  | PingMessage
  | TradeMessage
  | UpgradeShipMessage
  | RepairShipMessage
  | ScuttleMessage
  | ChatSendMessage;

/** The discriminator of a ClientMessage, whichever key (`t` or `type`) it uses. */
export type ClientMessageKind =
  | "connect" | "reconnect" | "input" | "ping" | "trade" | "upgradeShip" | "repairShip" | "scuttle" | "chat";
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
  /** At least one battery (port or starboard) is loaded. */
  canFire: boolean;
  /** ms until the FIRST battery is reloaded (0 = at least one ready) = min of the two below. */
  reloadMs: number;
  /** Broadsides (2026-10-23): ms until the port (left) battery is reloaded (0 = ready). Optional so
   *  old servers / test fixtures without it still parse; old clients ignore it. */
  reloadPortMs?: number;
  /** ms until the starboard (right) battery is reloaded (0 = ready). */
  reloadStarboardMs?: number;
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
  /** Broadsides (2026-10-23): which battery fired. One `fire` event per side volley. Old servers
   *  (always starboard) omit it; old clients ignore it (the ball rows already carry the geometry). */
  side?: BroadsideSide;
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
/**
 * A cannonball hit land (WORLD_SPEC §4.3) and was removed at (x, z). Sent to clients within
 * INTEREST_RADIUS (metric) of the splash point. `land: 1` = it hit land/ice (clients may render
 * dust). `ball` = id of the removed ball (from its `fire` row) so clients stop drawing it; treat
 * it like `hit.ball`.
 */
export interface SplashMessage {
  t: "splash";
  x: number;
  z: number;
  land: 1;
  ball: number;
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
/**
 * NPC2: a player's standing with the NPC factions (persisted with the player record in Redis).
 * `rep[faction]` −100…100 (missing = the faction's default for new players, see
 * server/game/npc/factions.ts DEFAULT_PLAYER_REP), `notoriety` 0…100 (decays over time),
 * `bounty` ≥ 0 gold.
 */
export interface StandingState {
  rep: Partial<Record<string, number>>;
  notoriety: number;
  bounty: number;
}
/** NPC2: the receiver's own standing. Sent on (re)attach and whenever it changes (low rate). */
export interface StandingMessage extends StandingState {
  t: "standing";
}
/** Faction ids accepted in a standing (WORLD_SPEC §8). */
export const STANDING_FACTIONS = ["england", "spain", "france", "portugal", "netherlands", "pirates", "merchants_guild"] as const;
/**
 * NPC2: validate a standing from Redis or the wire. Unknown factions and non-numbers are dropped,
 * values clamped (rep ±100, notoriety 0…100, bounty ≥ 0, all rounded to 0.1). Null if not an object.
 */
export function parseStanding(v: unknown): StandingState | null {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x)) * 10) / 10 : undefined;
  const rep: Partial<Record<string, number>> = {};
  if (typeof o.rep === "object" && o.rep !== null) {
    for (const f of STANDING_FACTIONS) {
      const r = num((o.rep as Record<string, unknown>)[f], -100, 100);
      if (r !== undefined) rep[f] = r;
    }
  }
  return { rep, notoriety: num(o.notoriety, 0, 100) ?? 0, bounty: num(o.bounty, 0, 1e9) ?? 0 };
}
/**
 * Global chat line (server -> client). Broadcast to every attached player, or (sys notices such as
 * the rate-limit warning) sent to one player only.
 * - `id`   server sequence number (> 0, increasing) for broadcast lines; 0 for private system notices.
 * - `from` the sender's ship name from the SERVER's player record ("" for system lines).
 * - `text` sanitized + profanity-masked plain text. Clients must render it as text, never as HTML.
 * - `ts`   server time (ms, Date.now()) when the line was accepted.
 * - `sys`  1 = system line (join notices, throttle warnings); absent for player lines.
 */
export interface ChatMessage {
  t: "chat";
  id: number;
  from: string;
  text: string;
  ts: number;
  sys?: 1;
}
/** Global chat: the last CHAT_HISTORY_SIZE broadcast lines, oldest first; sent on connect/reconnect. */
export interface ChatHistoryMessage {
  t: "chatHistory";
  lines: ChatMessage[];
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
  | SplashMessage
  | GoldCollectedMessage
  | StandingMessage
  | ChatMessage
  | ChatHistoryMessage
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
/** Input fire flags: booleans → 1 (legacy), numbers floored and masked to FIRE_MASK, anything
 *  else / negative / non-finite → 0. Old clients send `f: 0 | 1`, which maps to itself. */
export function fireFlags(v: unknown): FireFlags {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  // Any positive value used to mean "fire" (unit() clamp). Keep that: a positive value with no
  // known bit (0.5, 8, ...) is FIRE_ALL; otherwise keep the known bits.
  const bits = Math.floor(v) & FIRE_MASK;
  return bits === 0 ? FIRE_ALL : bits;
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

// Control chars (C0, DEL, C1), zero-width chars and bidi overrides/isolates (which can reorder or
// hide text) are removed from chat text. Tabs/newlines become spaces first.
// eslint-disable-next-line no-control-regex
const CHAT_STRIP_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CHAT_SPACE_RE = /\s+/g;

/**
 * Global chat: normalize untrusted chat text. Strips control / zero-width / bidi-override chars,
 * collapses whitespace runs to one space, trims, and cuts to MAX_CHAT_LENGTH code points (never
 * splitting a surrogate pair). Returns null when nothing is left (or the input is not a string).
 * Used by parseClientMessage (server) and parseChatLine (client), so both sides agree.
 */
export function sanitizeChatText(v: unknown, max: number = MAX_CHAT_LENGTH): string | null {
  if (typeof v !== "string") return null;
  const cleaned = v.replace(CHAT_SPACE_RE, " ").replace(CHAT_STRIP_RE, "").replace(/ {2,}/g, " ").trim();
  if (!cleaned) return null;
  const cps = Array.from(cleaned);
  const out = cps.length > max ? cps.slice(0, max).join("").trimEnd() : cleaned;
  return out || null;
}

/**
 * Global chat (client side): validate one server chat line defensively. Returns null if malformed.
 * Text and name are re-sanitized (the client never trusts the wire), names cut to MAX_NAME_LENGTH.
 */
export function parseChatLine(v: unknown): ChatMessage | null {
  if (!isObj(v)) return null;
  if (v.t !== undefined && v.t !== "chat") return null;
  const text = sanitizeChatText(v.text);
  if (!text) return null;
  const id = isFiniteNum(v.id) && v.id >= 0 ? Math.floor(v.id) : 0;
  const ts = isFiniteNum(v.ts) ? v.ts : 0;
  const from = typeof v.from === "string" ? sanitizeChatText(v.from, MAX_NAME_LENGTH) ?? "" : "";
  const m: ChatMessage = { t: "chat", id, from, text, ts };
  if (v.sys === 1 || v.sys === true) m.sys = 1;
  return m;
}

/** Type guard for an already-validated InputMessage shape. */
export function isInputMessage(m: unknown): m is InputMessage {
  return (
    isObj(m) &&
    m.t === "input" &&
    posInt(m.s) === m.s &&
    (m.th === -1 || m.th === 0 || m.th === 1) &&
    (m.ru === -1 || m.ru === 0 || m.ru === 1) &&
    typeof m.f === "number" && Number.isInteger(m.f) && m.f >= 0 && m.f <= FIRE_MASK
  );
}

/**
 * Validate and normalize an untrusted client frame (a raw JSON string, Buffer-decoded string, or
 * an already-parsed value). Returns a well-formed ClientMessage or `null` if it must be ignored.
 * Clamps rather than rejects where safe: input th/ru are clamped to {-1,0,1}, f to fire bits 0..7 and
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
      return { t: "input", s, th: unit(data.th), ru: unit(data.ru), f: fireFlags(data.f) };
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
    case "chat": {
      // Raw text over 4x the cap is rejected outright (the frame cap is 4096 anyway).
      if (typeof data.text !== "string" || data.text.length > MAX_CHAT_LENGTH * 4) return null;
      const text = sanitizeChatText(data.text);
      if (!text) return null;
      return { t: "chat", text };
    }
    default:
      return null;
  }
}
