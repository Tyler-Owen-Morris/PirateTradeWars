/**
 * Admin auth primitives (docs/admin/README.md "Security"). Pure Node crypto, no Express, no Redis.
 *
 * - Password hash: `scrypt:<saltHex>:<hashHex>` where hash = scrypt(password, salt, 64, N=16384, r=8, p=1)
 *   and salt is 16 random bytes. Set as the `ADMIN_PASSWORD_HASH` env var (`npm run admin:hash -- <pw>`).
 *   Verification is async (`crypto.scrypt` runs on the libuv pool, so a login never blocks the 20 Hz tick)
 *   and compares with `timingSafeEqual`.
 * - Session token (cookie value): `v1.<expMs>.<nonceHex>.<macHex>`, mac = HMAC-SHA256 over `v1.<exp>.<nonce>`
 *   keyed with HMAC(ADMIN_SESSION_SECRET, ADMIN_PASSWORD_HASH). Binding the key to the password hash means
 *   rotating the password (or the secret) invalidates every existing session.
 * - Login limiter: 5 failed tries per IP per 15 min, and 30 failed tries in total per 15 min locks sign-in for
 *   everyone (so rotating IPs can't brute force). In memory: a restart clears it.
 * - Client IP: the first hop the proxies in front of us vouch for (see `clientIp`).
 */
import crypto from "crypto";

export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
export const SCRYPT_KEYLEN = 64;
export const SALT_BYTES = 16;
/** Session lifetime: 12 h. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** ADMIN_SESSION_SECRET must be hex of at least this many bytes. */
export const MIN_SECRET_BYTES = 32;

export interface ParsedHash {
  salt: Buffer;
  hash: Buffer;
}

/** Parse `scrypt:<saltHex>:<hashHex>` (16-byte salt, 64-byte hash). Null when malformed. */
export function parsePasswordHash(line: string | undefined | null): ParsedHash | null {
  if (typeof line !== "string") return null;
  const parts = line.trim().split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return null;
  const [, saltHex, hashHex] = parts;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return null;
  if (saltHex.length !== SALT_BYTES * 2 || hashHex.length !== SCRYPT_KEYLEN * 2) return null;
  return { salt: Buffer.from(saltHex, "hex"), hash: Buffer.from(hashHex, "hex") };
}

/** Make a hash line for `password` (sync: only used by the CLI script and tests). */
export function makePasswordHash(password: string, salt: Buffer = crypto.randomBytes(SALT_BYTES)): string {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Constant-time check of `password` against a parsed hash. Passwords over 1 KB are refused outright. */
export async function verifyPassword(password: unknown, parsed: ParsedHash): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return false;
  const key = await scryptAsync(password, parsed.salt);
  return key.length === parsed.hash.length && crypto.timingSafeEqual(key, parsed.hash);
}

/** True when `secret` is hex of at least MIN_SECRET_BYTES bytes. */
export function validSessionSecret(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && /^[0-9a-f]+$/i.test(secret.trim()) && secret.trim().length >= MIN_SECRET_BYTES * 2;
}

/** Signs and checks session tokens. Revoked nonces (logout) are remembered until they expire. */
export class SessionSigner {
  private readonly key: Buffer;
  private readonly revoked = new Map<string, number>();

  constructor(secretHex: string, passwordHashLine: string, private readonly now: () => number = Date.now) {
    this.key = crypto.createHmac("sha256", Buffer.from(secretHex.trim(), "hex")).update(passwordHashLine.trim()).digest();
  }

  private mac(body: string): string {
    return crypto.createHmac("sha256", this.key).update(body).digest("hex");
  }

  issue(ttlMs: number = SESSION_TTL_MS): string {
    const exp = this.now() + ttlMs;
    const body = `v1.${exp}.${crypto.randomBytes(16).toString("hex")}`;
    return `${body}.${this.mac(body)}`;
  }

  /** Valid = well formed, untampered (constant-time MAC check), unexpired and not revoked. */
  verify(token: string | undefined | null): boolean {
    const parsed = this.parse(token);
    return !!parsed && parsed.exp > this.now() && !this.revoked.has(parsed.nonce);
  }

  /** Logout: the token stops working even though its signature is still valid. */
  revoke(token: string | undefined | null): void {
    const parsed = this.parse(token);
    if (!parsed) return;
    const now = this.now();
    this.revoked.forEach((exp, nonce) => {
      if (exp <= now) this.revoked.delete(nonce);
    });
    this.revoked.set(parsed.nonce, parsed.exp);
  }

  private parse(token: string | undefined | null): { exp: number; nonce: string } | null {
    if (typeof token !== "string" || token.length > 200) return null;
    const m = /^v1\.(\d{1,15})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
    if (!m) return null;
    const expected = Buffer.from(this.mac(`v1.${m[1]}.${m[2]}`), "hex");
    const given = Buffer.from(m[3], "hex");
    if (!crypto.timingSafeEqual(expected, given)) return null;
    return { exp: Number(m[1]), nonce: m[2] };
  }
}

// ---------------------------------------------------------------------------------------------
// Login rate limiter
// ---------------------------------------------------------------------------------------------

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS_PER_IP = 5;
export const LOGIN_MAX_FAILS_GLOBAL = 30;

export type LoginGate = { ok: true } | { ok: false; scope: "ip" | "global"; retryAfterMs: number };

/**
 * Sliding-window failure counter. `check(ip)` before verifying a password; `fail(ip)` after a wrong
 * one; `succeed(ip)` clears that IP's failures. While an IP (or everyone) is locked, even the right
 * password is refused, so a locked attacker learns nothing.
 */
export class LoginLimiter {
  private readonly byIp = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly opts = { windowMs: LOGIN_WINDOW_MS, perIp: LOGIN_MAX_FAILS_PER_IP, global: LOGIN_MAX_FAILS_GLOBAL },
    private readonly now: () => number = Date.now,
  ) {}

  private prune(list: number[], now: number): number[] {
    const cutoff = now - this.opts.windowMs;
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i++;
    return i ? list.slice(i) : list;
  }

  check(ip: string): LoginGate {
    const now = this.now();
    this.global = this.prune(this.global, now);
    if (this.global.length >= this.opts.global) {
      return { ok: false, scope: "global", retryAfterMs: this.global[this.global.length - this.opts.global] + this.opts.windowMs - now };
    }
    const list = this.prune(this.byIp.get(ip) ?? [], now);
    if (list.length) this.byIp.set(ip, list);
    else this.byIp.delete(ip);
    if (list.length >= this.opts.perIp) {
      return { ok: false, scope: "ip", retryAfterMs: list[list.length - this.opts.perIp] + this.opts.windowMs - now };
    }
    return { ok: true };
  }

  /** Record a failure; returns the tries this IP has left in the window. */
  fail(ip: string): number {
    const now = this.now();
    const list = this.prune(this.byIp.get(ip) ?? [], now);
    list.push(now);
    this.byIp.set(ip, list);
    this.global = this.prune(this.global, now);
    this.global.push(now);
    // Bound memory under an IP-rotation flood: forget the oldest IPs past 10k entries.
    if (this.byIp.size > 10_000) {
      const first = this.byIp.keys().next().value;
      if (first !== undefined) this.byIp.delete(first);
    }
    return Math.max(0, this.opts.perIp - list.length);
  }

  succeed(ip: string): void {
    this.byIp.delete(ip);
  }
}

// ---------------------------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------------------------

/**
 * The client's IP behind `hops` trusted reverse proxies. Production is browser -> ALB -> nginx -> node:
 * the ALB appends the client IP to X-Forwarded-For and nginx appends the ALB's IP, so the socket peer is
 * nginx and the client is the entry `hops` = 2 from the right of [...XFF, socketPeer]. Entries further
 * left are client-supplied and never trusted. `hops` = 0 means the socket peer (local dev).
 * We read the header ourselves instead of Express `trust proxy` (not set in this app) so nothing else
 * changes behaviour.
 */
export function clientIp(xff: string | string[] | undefined, socketPeer: string | undefined, hops: number): string {
  const header = Array.isArray(xff) ? xff.join(",") : xff ?? "";
  const chain = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  chain.push(socketPeer ?? "unknown");
  const idx = Math.max(0, chain.length - 1 - Math.max(0, Math.floor(hops)));
  return normalizeIp(chain[idx]);
}

function normalizeIp(ip: string): string {
  const v = ip.trim().slice(0, 64);
  return v.startsWith("::ffff:") ? v.slice(7) : v;
}

/** Proxy hops in front of node: ADMIN_TRUSTED_PROXY_HOPS, else 2 in production (ALB + nginx), else 0. */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ADMIN_TRUSTED_PROXY_HOPS;
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw))) return Math.max(0, Math.floor(Number(raw)));
  return env.NODE_ENV === "production" ? 2 : 0;
}
