/**
 * Admin HTTP API (`/api/admin/*`) and the public landing beacon (`POST /api/visit`).
 * Contract and security notes: docs/admin/README.md. Everything game-side is injected (`AdminDeps`), so
 * the routes are tested with a plain Express app and fakes (server/admin/__tests__/routes.test.ts);
 * the live wiring is server/admin/live.ts.
 *
 * - Disabled entirely (every /api/admin path 404s) unless ADMIN_PASSWORD_HASH parses and
 *   ADMIN_SESSION_SECRET is ≥ 32 bytes of hex.
 * - Every /api/admin response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
 * - POSTs need `Content-Type: application/json` and, when an Origin header is sent, a same-host Origin
 *   (CSRF guard on top of the SameSite=Strict cookie).
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sanitizeCampaign, sanitizeSource } from "@shared/source";
import {
  LoginLimiter,
  SessionSigner,
  SESSION_TTL_MS,
  clientIp,
  parsePasswordHash,
  trustedProxyHops,
  validSessionSecret,
  verifyPassword,
  type ParsedHash,
} from "./auth";
import { parseAdminAction, type AdminActionRequest, type AdminPlayerRow } from "./state";
import { DailyStats, VisitLimiter, summarizeToday } from "./stats";
import type { AdminLogLine, AdminStateResponse } from "@shared/adminApi";

export const ADMIN_COOKIE = "ptw_admin";
export const ADMIN_LOG_SIZE = 50;
/** Password checks allowed at once (scrypt N=16384 r=8 uses 16 MB each). */
export const MAX_CONCURRENT_VERIFY = 2;

export interface AdminWorldSnapshot {
  captains: AdminPlayerRow[];
  npcShips: number;
  /** NPC population records (director rails + docked + active), when the NPC system runs. */
  npcRecords: number | null;
  tickAvgMs: number;
  tickMaxMs: number;
}

export type AdminActResult = { ok: true; row: AdminPlayerRow; text: string; warning?: string } | { ok: false; status: number; error: string };

export interface AdminDeps {
  env?: NodeJS.ProcessEnv;
  snapshot(): AdminWorldSnapshot;
  act(req: AdminActionRequest): Promise<AdminActResult>;
  stats: DailyStats;
  now?: () => number;
}

export type { AdminLogLine, AdminStateResponse } from "@shared/adminApi";

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches may omit it; SameSite=Strict still applies
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerAdminRoutes(app: Express, deps: AdminDeps): { enabled: boolean } {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const hashLine = env.ADMIN_PASSWORD_HASH;
  const secret = env.ADMIN_SESSION_SECRET;
  const parsed: ParsedHash | null = parsePasswordHash(hashLine);
  const enabled = !!parsed && validSessionSecret(secret);
  if (!enabled) {
    if (hashLine) console.warn("[admin] disabled: ADMIN_PASSWORD_HASH is malformed or ADMIN_SESSION_SECRET is missing/short (need >= 32 bytes hex)");
    else console.log("[admin] disabled (ADMIN_PASSWORD_HASH not set)");
  }
  const production = env.NODE_ENV === "production";
  const hops = trustedProxyHops(env);
  const ipOf = (req: Request) => clientIp(req.headers["x-forwarded-for"], req.socket.remoteAddress, hops);
  const signer = enabled ? new SessionSigner(secret!, hashLine!, now) : null;
  const limiter = new LoginLimiter(undefined, now);
  const visitLimiter = new VisitLimiter(undefined, undefined, now);
  const log: AdminLogLine[] = [];
  let verifying = 0;

  const cookieAttrs = (maxAgeSec: number) =>
    `Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${production ? "; Secure" : ""}`;

  // The /admin page itself: never indexed. (The SPA catch-all serves it.)
  app.use("/admin", (_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // ---- public landing beacon ----
  app.post("/api/visit", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).end();
    if (!visitLimiter.allow(ipOf(req))) return res.status(429).end();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = sanitizeSource(body.source);
    sanitizeCampaign(body.campaign); // validated only; campaigns go to Segment with the player, not counters
    deps.stats.count("visits", source);
    res.status(204).end();
  });

  // ---- admin ----
  app.use("/api/admin", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!enabled) return res.status(404).json({ error: "not_found" });
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (!req.is("application/json")) return res.status(415).json({ error: "json_required" });
      if (!sameOrigin(req)) return res.status(403).json({ error: "bad_origin" });
    }
    next();
  });

  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    if (!signer!.verify(readCookie(req.headers.cookie, ADMIN_COOKIE))) return res.status(401).json({ error: "signed_out" });
    next();
  };

  app.post("/api/admin/login", async (req, res) => {
    const ip = ipOf(req);
    const gate = limiter.check(ip);
    if (!gate.ok) {
      console.log(`[admin] login locked ip=${ip} scope=${gate.scope}`);
      return res.status(429).json({ error: "locked", scope: gate.scope, retryAfterSec: Math.ceil(gate.retryAfterMs / 1000) });
    }
    // Charge the try BEFORE the (async) scrypt, so a parallel burst can't slip past the limit, and cap
    // concurrent verifications (each scrypt holds 16 MB): extra tries are refused, still charged.
    const remaining = limiter.fail(ip);
    if (verifying >= MAX_CONCURRENT_VERIFY) {
      console.log(`[admin] login busy ip=${ip}`);
      return res.status(429).json({ error: "busy", retryAfterSec: 2 });
    }
    const password = (req.body ?? {}).password;
    let ok = false;
    verifying++;
    try {
      ok = await verifyPassword(password, parsed!);
    } catch (err) {
      console.error("[admin] login verify error:", err);
    } finally {
      verifying--;
    }
    if (!ok) {
      console.log(`[admin] login fail ip=${ip} remaining=${remaining}`);
      return res.status(401).json({ error: "wrong", remaining });
    }
    limiter.succeed(ip); // clears this IP and refunds the pre-charged global try
    console.log(`[admin] login ok ip=${ip}`);
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${signer!.issue()}; ${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000))}`);
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", (req, res) => {
    signer!.revoke(readCookie(req.headers.cookie, ADMIN_COOKIE));
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; ${cookieAttrs(0)}`);
    console.log(`[admin] logout ip=${ipOf(req)}`);
    res.json({ ok: true });
  });

  app.get("/api/admin/session", requireSession, (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/admin/state", requireSession, async (_req, res) => {
    try {
      const today = summarizeToday(await deps.stats.today());
      const body: AdminStateResponse = { now: now(), ...deps.snapshot(), today, log };
      res.json(body);
    } catch (err) {
      console.error("[admin] state failed:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.post("/api/admin/action", requireSession, async (req, res) => {
    const p = parseAdminAction(req.body);
    if (!p.ok) return res.status(400).json({ error: "bad_request", message: p.error });
    try {
      const r = await deps.act(p.value);
      if (!r.ok) return res.status(r.status).json({ error: "refused", message: r.error });
      log.unshift({ at: now(), text: r.text });
      if (log.length > ADMIN_LOG_SIZE) log.length = ADMIN_LOG_SIZE;
      console.log(`[admin] action ${p.value.action}${p.value.amount ? ` amount=${p.value.amount}` : ""} player=${p.value.playerId} ip=${ipOf(req)}: ${r.text}`);
      res.json({ ok: true, row: r.row, text: r.text, ...(r.warning ? { warning: r.warning } : {}), log });
    } catch (err) {
      console.error("[admin] action failed:", err);
      res.status(500).json({ error: "server_error", message: "Server error" });
    }
  });

  // Unknown admin paths must not fall through to the SPA's index.html.
  app.all("/api/admin/*", (_req, res) => res.status(404).json({ error: "not_found" }));

  return { enabled };
}
