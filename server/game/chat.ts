/**
 * Global chat (docs/netcode/PROTOCOL.md "Global chat"). Pure and I/O-free: no Redis, no sockets.
 *
 * The socket handler calls `ChatService.submit(sender, text)` from the WebSocket MESSAGE path (never
 * from `World.step()` / the tick) with text already normalized by `parseClientMessage`
 * (`sanitizeChatText`: control chars stripped, trimmed, <= MAX_CHAT_LENGTH). This module adds the
 * server-side policy:
 *  - a per-player token bucket (burst CHAT_BURST, refill CHAT_REFILL_PER_SEC), keyed by player id so a
 *    reconnect does not refill it; a throttled sender gets at most one polite notice per
 *    CHAT_NOTICE_COOLDOWN_MS;
 *  - `collapseRepeats` (runs of > 3 identical chars become 3);
 *  - `maskProfanity`: a small built-in word list, masked with asterisks (leet-tolerant);
 *  - an in-memory ring buffer of the last CHAT_HISTORY_SIZE lines, replayed on (re)join.
 * Nothing is persisted: a server restart clears the chat history.
 */
import { CHAT_HISTORY_SIZE, type ChatMessage } from "@shared/protocol";

/** Token bucket size: this many lines may be sent back to back. */
export const CHAT_BURST = 5;
/** Sustained rate: tokens regained per second. */
export const CHAT_REFILL_PER_SEC = 1;
/** A throttled player gets at most one "slow down" notice this often. */
export const CHAT_NOTICE_COOLDOWN_MS = 3000;
/** Runs of the same character longer than this are cut to this length. */
export const MAX_REPEAT_RUN = 3;
/** Rate-limit buckets are pruned when the map grows past this (only full, idle buckets go). */
const BUCKET_PRUNE_AT = 2000;

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

/**
 * The built-in mask list. Kept deliberately small: common profanity and slurs. `prefix` entries also
 * match longer words that start with them ("fucking"); the others match whole words only, to avoid
 * masking innocent words that contain them ("class", "Scunthorpe", "spice"). Pirate words such as
 * "bastard", "damn", "hell", "bloody" and "cock" (the pistol) are allowed.
 */
const MASK_WORDS: Array<{ w: string; prefix?: boolean }> = [
  { w: "fuck", prefix: true },
  { w: "motherfuck", prefix: true },
  { w: "shit", prefix: true },
  { w: "bullshit", prefix: true },
  { w: "cunt", prefix: true },
  { w: "bitch", prefix: true },
  { w: "asshole" },
  { w: "assholes" },
  { w: "dickhead" },
  { w: "pussy" },
  { w: "whore" },
  { w: "slut" },
  { w: "nigger", prefix: true },
  { w: "nigga", prefix: true },
  { w: "faggot", prefix: true },
  { w: "fag" },
  { w: "fags" },
  { w: "retard", prefix: true },
  { w: "kike" },
  { w: "kikes" },
  { w: "spic" },
  { w: "spics" },
  { w: "chink" },
  { w: "chinks" },
  { w: "tranny" },
  { w: "trannies" },
  { w: "rape" },
  { w: "rapist" },
];

/** Same-length leet folding, so match indices map 1:1 onto the original text. ("!" and "|" are left
 *  alone: they are usually punctuation, and folding them would mask "shit!" as five stars.) */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t" };
function foldChar(ch: string): string {
  const lc = ch.toLowerCase();
  return LEET[lc] ?? lc;
}

/** One regex over the folded text: each letter may repeat ("fuuck"), optional prefix tail. */
const MASK_RE = new RegExp(
  "(?<![a-z])(?:" +
    MASK_WORDS.map(({ w, prefix }) => w.split("").map((c) => `${c}+`).join("") + (prefix ? "[a-z]*" : "")).join("|") +
    ")(?![a-z])",
  "g",
);

/**
 * Replace listed words with asterisks of the same length. Case-insensitive and tolerant of common
 * leet digits/symbols ("sh1t", "f@g"). Non-BMP characters are folded as themselves.
 */
export function maskProfanity(text: string): string {
  // Fold per UTF-16 unit so indices stay aligned with `text`.
  let folded = "";
  for (let i = 0; i < text.length; i++) {
    const f = foldChar(text[i]);
    folded += f.length === 1 ? f : text[i];
  }
  let out = "";
  let last = 0;
  MASK_RE.lastIndex = 0;
  for (let m = MASK_RE.exec(folded); m; m = MASK_RE.exec(folded)) {
    out += text.slice(last, m.index) + "*".repeat(m[0].length);
    last = m.index + m[0].length;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** Full server-side text policy on already-sanitized text: collapse repeats, then mask. */
export function cleanChatText(text: string): string {
  return maskProfanity(collapseRepeats(text));
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export interface ChatSender {
  /** Player id (rate-limit key). */
  id: string;
  /** Ship name from the server's player record (never from the client). */
  name: string;
}

export type ChatSubmitResult =
  | { ok: true; line: ChatMessage }
  | { ok: false; reason: "throttled"; notice: ChatMessage | null };

export interface ChatServiceOptions {
  now?: () => number;
  historySize?: number;
  burst?: number;
  refillPerSec?: number;
}

export class ChatService {
  private readonly now: () => number;
  private readonly historySize: number;
  private readonly burst: number;
  private readonly refillPerSec: number;
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly lastNotice = new Map<string, number>();
  private readonly ring: ChatMessage[] = [];
  private nextId = 1;

  constructor(opts: ChatServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.historySize = opts.historySize ?? CHAT_HISTORY_SIZE;
    this.burst = opts.burst ?? CHAT_BURST;
    this.refillPerSec = opts.refillPerSec ?? CHAT_REFILL_PER_SEC;
  }

  /**
   * Rate-limit, clean and record one line. On success the caller broadcasts `line`; when throttled the
   * caller sends `notice` (if not null) to the sender only. `text` must already be sanitized.
   */
  submit(sender: ChatSender, text: string): ChatSubmitResult {
    const now = this.now();
    let bucket = this.buckets.get(sender.id);
    if (!bucket) {
      if (this.buckets.size >= BUCKET_PRUNE_AT) this.prune(now);
      bucket = new TokenBucket(this.burst, this.refillPerSec, now);
      this.buckets.set(sender.id, bucket);
    }
    if (!bucket.tryTake(now)) {
      const last = this.lastNotice.get(sender.id);
      if (last !== undefined && now - last < CHAT_NOTICE_COOLDOWN_MS) return { ok: false, reason: "throttled", notice: null };
      this.lastNotice.set(sender.id, now);
      return {
        ok: false,
        reason: "throttled",
        notice: this.systemLine("Easy there, matey! You're sending messages too fast. Wait a moment and try again.", false),
      };
    }
    const line: ChatMessage = { t: "chat", id: this.nextId++, from: sender.name, text: cleanChatText(text), ts: now };
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

  /** Number of tracked rate-limit buckets (tests / diagnostics). */
  get bucketCount(): number {
    return this.buckets.size;
  }

  private record(line: ChatMessage): void {
    this.ring.push(line);
    if (this.ring.length > this.historySize) this.ring.splice(0, this.ring.length - this.historySize);
  }

  /** Forget full (idle) buckets and stale notice stamps. */
  private prune(now: number): void {
    this.buckets.forEach((b, id) => {
      if (b.isFull(now)) this.buckets.delete(id);
    });
    this.lastNotice.forEach((t, id) => {
      if (now - t >= CHAT_NOTICE_COOLDOWN_MS) this.lastNotice.delete(id);
    });
  }
}
