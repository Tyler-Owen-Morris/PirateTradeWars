/**
 * Global chat (docs/netcode/PROTOCOL.md "Global chat"). Pure and I/O-free: no Redis, no sockets.
 *
 * The socket handler calls `ChatService.submit(sender, text)` from the WebSocket MESSAGE path (never
 * from `World.step()` / the tick) with text already normalized by `parseClientMessage`
 * (`sanitizeChatText`: control / zero-width / bidi chars stripped, trimmed, <= MAX_CHAT_LENGTH). This
 * module adds the server-side policy, in this order:
 *  1. mute check: a muted player's lines are refused (one private notice per CHAT_NOTICE_COOLDOWN_MS);
 *  2. a per-player token bucket (burst CHAT_BURST, refill CHAT_REFILL_PER_SEC); a throttled sender gets
 *     at most one polite notice per CHAT_NOTICE_COOLDOWN_MS;
 *  3. `collapseRepeats` (runs of > 3 identical chars become 3);
 *  4. moderation (`./chatFilter.ts` `moderateText`, kid-safe): mild profanity is masked with asterisks;
 *     slurs / hate, sexual content, threats and child-safety hits (links, emails, phone numbers, requests
 *     for age / location / off-site contact) DROP the whole line, and the sender alone gets
 *     CHAT_BLOCKED_NOTICE. Each drop is a strike: CHAT_STRIKES_TO_MUTE strikes within CHAT_STRIKE_WINDOW_MS
 *     mute the player for CHAT_MUTE_BASE_MS, doubling for each repeat mute up to CHAT_MUTE_MAX_MS (the
 *     doubling resets after CHAT_MUTE_LEVEL_RESET_MS without a mute). Drops are logged with player id,
 *     category and a truncated SHA-256 of the text, never the text itself;
 *  5. an in-memory ring buffer of the last CHAT_HISTORY_SIZE lines, replayed on (re)join.
 * Strikes, mutes and buckets are keyed by player id, so a reconnect does not clear them. Nothing is
 * persisted: a server restart clears the chat history, strikes and mutes.
 */
import { createHash } from "crypto";
import { CHAT_HISTORY_SIZE, type ChatMessage } from "@shared/protocol";
import { moderateText, type DropCategory } from "./chatFilter";

/** Token bucket size: this many lines may be sent back to back. */
export const CHAT_BURST = 5;
/** Sustained rate: tokens regained per second. */
export const CHAT_REFILL_PER_SEC = 1;
/** A throttled / muted player gets at most one notice this often. */
export const CHAT_NOTICE_COOLDOWN_MS = 3000;
/** Runs of the same character longer than this are cut to this length. */
export const MAX_REPEAT_RUN = 3;
/** Dropped lines within this window count towards a mute. */
export const CHAT_STRIKE_WINDOW_MS = 10 * 60_000;
/** This many dropped lines within CHAT_STRIKE_WINDOW_MS mute the player. */
export const CHAT_STRIKES_TO_MUTE = 3;
/** First mute length; each further mute doubles it. */
export const CHAT_MUTE_BASE_MS = 10 * 60_000;
/** Mutes never last longer than this. */
export const CHAT_MUTE_MAX_MS = 60 * 60_000;
/** After this long with no new mute, the next mute starts again at CHAT_MUTE_BASE_MS. */
export const CHAT_MUTE_LEVEL_RESET_MS = 24 * 60 * 60_000;
/** Private notice for a dropped line. */
export const CHAT_BLOCKED_NOTICE = "Mind your tongue, sailor — that message was not sent.";
/** Per-player maps are pruned when they grow past this (only idle entries go). */
const PRUNE_AT = 2000;

// ---------------------------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------------------------

/** Classic token bucket. `now` in ms. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly capacity: number = CHAT_BURST,
    readonly refillPerSec: number = CHAT_REFILL_PER_SEC,
    now = 0,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  private refill(now: number): void {
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
      this.last = now;
    }
  }

  /** Take one token if available. */
  tryTake(now: number): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** True when the bucket has refilled completely (safe to forget). */
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.capacity;
  }
}

// ---------------------------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------------------------

/** Cut runs of the same character (case-insensitive) longer than `max` down to `max`. */
export function collapseRepeats(text: string, max: number = MAX_REPEAT_RUN): string {
  let out = "";
  let prev = "";
  let run = 0;
  for (const ch of text) {
    const lc = ch.toLowerCase();
    run = lc === prev ? run + 1 : 1;
    prev = lc;
    if (run <= max) out += ch;
  }
  return out;
}

/** Full server-side text policy on already-sanitized text: collapse repeats, then moderate. */
export function cleanChatText(text: string): CleanResult {
  const collapsed = collapseRepeats(text);
  const res = moderateText(collapsed);
  return res.action === "allow" ? { action: "allow", text: collapsed } : res;
}

/** `cleanChatText` result: the text to broadcast (allow / mask) or a drop with its category. */
export type CleanResult = { action: "allow" | "mask"; text: string } | { action: "drop"; category: DropCategory };

/** First 12 hex chars of SHA-256(text): lets the owner count repeats without storing what was said. */
export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export interface ChatSender {
  /** Player id (rate-limit / strike / mute key). */
  id: string;
  /** Ship name from the server's player record (never from the client). */
  name: string;
}

export type ChatSubmitResult =
  | { ok: true; line: ChatMessage }
  | { ok: false; reason: "throttled"; notice: ChatMessage | null }
  | { ok: false; reason: "blocked"; category: DropCategory; notice: ChatMessage; mutedUntil?: number }
  | { ok: false; reason: "muted"; notice: ChatMessage | null; mutedUntil: number };

export interface ChatServiceOptions {
  now?: () => number;
  historySize?: number;
  burst?: number;
  refillPerSec?: number;
  /** Moderation log sink (default console.warn). Receives ids, categories and hashes only. */
  log?: (msg: string) => void;
}

interface MuteState {
  until: number;
  /** Mutes so far in the current escalation streak (1 = first mute). */
  level: number;
}

function minutesLeft(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export class ChatService {
  private readonly now: () => number;
  private readonly historySize: number;
  private readonly burst: number;
  private readonly refillPerSec: number;
  private readonly log: (msg: string) => void;
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly lastNotice = new Map<string, number>();
  private readonly strikes = new Map<string, number[]>();
  private readonly mutes = new Map<string, MuteState>();
  private readonly ring: ChatMessage[] = [];
  private nextId = 1;

  constructor(opts: ChatServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.historySize = opts.historySize ?? CHAT_HISTORY_SIZE;
    this.burst = opts.burst ?? CHAT_BURST;
    this.refillPerSec = opts.refillPerSec ?? CHAT_REFILL_PER_SEC;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /**
   * Mute-check, rate-limit, moderate and record one line. On success the caller broadcasts `line`;
   * otherwise the caller sends `notice` (if not null) to the sender only. `text` must already be sanitized.
   */
  submit(sender: ChatSender, text: string): ChatSubmitResult {
    const now = this.now();
    const mutedUntil = this.mutedUntil(sender.id, now);
    if (mutedUntil !== null) {
      return {
        ok: false,
        reason: "muted",
        mutedUntil,
        notice: this.rateLimitedNotice(sender.id, now, `You're muted from chat for another ${minutesLeft(mutedUntil - now)}.`),
      };
    }

    let bucket = this.buckets.get(sender.id);
    if (!bucket) {
      if (this.buckets.size >= PRUNE_AT) this.prune(now);
      bucket = new TokenBucket(this.burst, this.refillPerSec, now);
      this.buckets.set(sender.id, bucket);
    }
    if (!bucket.tryTake(now)) {
      return {
        ok: false,
        reason: "throttled",
        notice: this.rateLimitedNotice(sender.id, now, "Easy there, matey! You're sending messages too fast. Wait a moment and try again."),
      };
    }

    const res = cleanChatText(text);
    if (res.action === "drop") return this.drop(sender.id, res.category, text, now);

    const line: ChatMessage = { t: "chat", id: this.nextId++, from: sender.name, text: res.text, ts: now };
    this.record(line);
    return { ok: true, line };
  }

  /** A system line. `broadcast` lines get an id and go into the history; private notices use id 0. */
  systemLine(text: string, broadcast = true): ChatMessage {
    const line: ChatMessage = { t: "chat", id: broadcast ? this.nextId++ : 0, from: "", text, ts: this.now(), sys: 1 };
    if (broadcast) this.record(line);
    return line;
  }

  /** The last `historySize` broadcast lines, oldest first (a copy). */
  history(): ChatMessage[] {
    return this.ring.slice();
  }

  /** When the player's current mute ends (ms), or null if not muted. */
  mutedUntil(playerId: string, now: number = this.now()): number | null {
    const m = this.mutes.get(playerId);
    return m && now < m.until ? m.until : null;
  }

  /** Number of tracked rate-limit buckets (tests / diagnostics). */
  get bucketCount(): number {
    return this.buckets.size;
  }

  private drop(playerId: string, category: DropCategory, text: string, now: number): ChatSubmitResult {
    this.log(`[chat] dropped player=${playerId} category=${category} hash=${textHash(text)}`);
    const recent = (this.strikes.get(playerId) ?? []).filter((t) => now - t < CHAT_STRIKE_WINDOW_MS);
    recent.push(now);
    if (recent.length < CHAT_STRIKES_TO_MUTE) {
      this.strikes.set(playerId, recent);
      return { ok: false, reason: "blocked", category, notice: this.systemLine(CHAT_BLOCKED_NOTICE, false) };
    }
    // Mute: escalate unless the last mute ended long ago.
    this.strikes.delete(playerId);
    const prev = this.mutes.get(playerId);
    const level = prev && now - prev.until < CHAT_MUTE_LEVEL_RESET_MS ? prev.level + 1 : 1;
    const duration = Math.min(CHAT_MUTE_MAX_MS, CHAT_MUTE_BASE_MS * 2 ** (level - 1));
    const until = now + duration;
    this.mutes.set(playerId, { until, level });
    this.lastNotice.set(playerId, now);
    this.log(`[chat] muted player=${playerId} minutes=${Math.round(duration / 60_000)} level=${level}`);
    return {
      ok: false,
      reason: "blocked",
      category,
      mutedUntil: until,
      notice: this.systemLine(`${CHAT_BLOCKED_NOTICE} You're muted from chat for ${minutesLeft(duration)}.`, false),
    };
  }

  /** A private notice, at most one per CHAT_NOTICE_COOLDOWN_MS per player (null when suppressed). */
  private rateLimitedNotice(playerId: string, now: number, text: string): ChatMessage | null {
    const last = this.lastNotice.get(playerId);
    if (last !== undefined && now - last < CHAT_NOTICE_COOLDOWN_MS) return null;
    this.lastNotice.set(playerId, now);
    return this.systemLine(text, false);
  }

  private record(line: ChatMessage): void {
    this.ring.push(line);
    if (this.ring.length > this.historySize) this.ring.splice(0, this.ring.length - this.historySize);
  }

  /** Forget full (idle) buckets, stale notice stamps and strikes, and mutes past their escalation reset. */
  private prune(now: number): void {
    this.buckets.forEach((b, id) => {
      if (b.isFull(now)) this.buckets.delete(id);
    });
    this.lastNotice.forEach((t, id) => {
      if (now - t >= CHAT_NOTICE_COOLDOWN_MS) this.lastNotice.delete(id);
    });
    this.strikes.forEach((ts, id) => {
      if (ts.every((t) => now - t >= CHAT_STRIKE_WINDOW_MS)) this.strikes.delete(id);
    });
    this.mutes.forEach((m, id) => {
      if (now - m.until >= CHAT_MUTE_LEVEL_RESET_MS) this.mutes.delete(id);
    });
  }
}
