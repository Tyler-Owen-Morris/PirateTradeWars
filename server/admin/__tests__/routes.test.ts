// Admin HTTP routes on a plain Express app with fake game deps (no Redis, no world loop, no game server).
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { registerAdminRoutes, ADMIN_COOKIE, type AdminDeps } from "../routes";
import { makePasswordHash } from "../auth";
import { DailyStats, type StatsStore } from "../stats";
import type { AdminPlayerRow } from "@shared/adminApi";

const PASSWORD = "a long admin passphrase";
const HASH = makePasswordHash(PASSWORD);
const SECRET = "ef".repeat(32);

const row: AdminPlayerRow = {
  id: "p1", name: "Salty Jo", shipType: "sloop", ship: "Sloop", nextShip: "Brigantine", status: "sea", where: "Off Havana",
  lat: 23, lon: -83, hp: 18, maxHp: 50, gold: 260, cargoUsed: 0, cargoCapacity: 20, source: "TikTok", onlineSince: 0,
};

function memStore(): StatsStore & { data: Map<string, Record<string, number>> } {
  const data = new Map<string, Record<string, number>>();
  return {
    data,
    async incrDailyStat(day, kind, field) {
      const k = `${day}:${kind}`;
      const r = data.get(k) ?? {};
      r[field] = (r[field] ?? 0) + 1;
      data.set(k, r);
    },
    async getDailyStat(day, kind) {
      return { ...(data.get(`${day}:${kind}`) ?? {}) };
    },
  };
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function boot(env: NodeJS.ProcessEnv = { ADMIN_PASSWORD_HASH: HASH, ADMIN_SESSION_SECRET: SECRET }, over: Partial<AdminDeps> = {}) {
  const app = express();
  app.use(express.json());
  const act = vi.fn(async (req: any) => ({ ok: true as const, row: { ...row, gold: row.gold + (req.amount ?? 0) }, text: `Gave Salty Jo +${req.amount} gold` }));
  const store = memStore();
  const deps: AdminDeps = {
    env,
    snapshot: () => ({ captains: [row], npcShips: 3, npcRecords: 214, tickAvgMs: 3.1, tickMaxMs: 9 }),
    act,
    stats: new DailyStats(store, "UTC", Date.now, 0),
    ...over,
  };
  const info = registerAdminRoutes(app, deps);
  app.use("*", (_req, res) => res.status(200).send("<!doctype html>spa")); // the SPA catch-all
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req = (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    req(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { info, act, store, req, post };
}

async function login(t: Awaited<ReturnType<typeof boot>>): Promise<string> {
  const r = await t.post("/api/admin/login", { password: PASSWORD });
  expect(r.status).toBe(200);
  const set = r.headers.get("set-cookie")!;
  return set.split(";")[0]; // "ptw_admin=<token>"
}

describe("admin routes", () => {
  it("are disabled (404 everywhere) without ADMIN_PASSWORD_HASH, or with a bad secret", async () => {
    for (const env of [{}, { ADMIN_PASSWORD_HASH: HASH }, { ADMIN_PASSWORD_HASH: HASH, ADMIN_SESSION_SECRET: "short" }, { ADMIN_PASSWORD_HASH: "junk", ADMIN_SESSION_SECRET: SECRET }]) {
      const t = await boot(env as any);
      expect(t.info.enabled).toBe(false);
      expect((await t.req("/api/admin/state")).status).toBe(404);
      expect((await t.req("/api/admin/session")).status).toBe(404);
      expect((await t.post("/api/admin/login", { password: PASSWORD })).status).toBe(404);
      server!.close();
      server = null;
    }
  });

  it("refuse without a valid cookie", async () => {
    const t = await boot();
    expect(t.info.enabled).toBe(true);
    for (const path of ["/api/admin/state", "/api/admin/session"]) {
      const r = await t.req(path);
      expect(r.status).toBe(401);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect((await t.post("/api/admin/action", { playerId: "p1", action: "repairFull" })).status).toBe(401);
    expect((await t.req("/api/admin/state", { headers: { Cookie: `${ADMIN_COOKIE}=v1.9999999999999.${"a".repeat(32)}.${"b".repeat(64)}` } })).status).toBe(401);
    expect(t.act).not.toHaveBeenCalled();
  });

  it("log in sets an HttpOnly SameSite=Strict cookie that opens state; logout revokes it", async () => {
    const t = await boot();
    const r = await t.post("/api/admin/login", { password: PASSWORD });
    expect(r.status).toBe(200);
    const set = r.headers.get("set-cookie")!;
    expect(set).toMatch(new RegExp(`^${ADMIN_COOKIE}=v1\\.`));
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/api/admin");
    expect(set).toContain("Max-Age=43200");
    expect(set).not.toContain("Secure"); // not production
    const cookie = set.split(";")[0];
    const s = await t.req("/api/admin/state", { headers: { Cookie: cookie } });
    expect(s.status).toBe(200);
    const body = await s.json();
    expect(body.captains[0].name).toBe("Salty Jo");
    expect(body).toMatchObject({ npcShips: 3, npcRecords: 214, tickAvgMs: 3.1, log: [] });
    expect(body.today).toMatchObject({ newCaptains: 0, socialVisits: 0 });
    const out = await t.post("/api/admin/logout", {}, { Cookie: cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await t.req("/api/admin/state", { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("sets Secure in production", async () => {
    const t = await boot({ ADMIN_PASSWORD_HASH: HASH, ADMIN_SESSION_SECRET: SECRET, NODE_ENV: "production", ADMIN_TRUSTED_PROXY_HOPS: "0" });
    const r = await t.post("/api/admin/login", { password: PASSWORD });
    expect(r.headers.get("set-cookie")).toContain("Secure");
  });

  it("wrong password: 401 with tries left, then locked (429) even for the right one", async () => {
    const t = await boot();
    for (let i = 4; i >= 0; i--) {
      const r = await t.post("/api/admin/login", { password: "nope" });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "wrong", remaining: i });
    }
    const locked = await t.post("/api/admin/login", { password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "locked", scope: "ip" });
  });

  it("POSTs need JSON and a same-host Origin (CSRF guard)", async () => {
    const t = await boot();
    const form = await t.req("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `password=${PASSWORD}` });
    expect(form.status).toBe(415);
    const text = await t.req("/api/admin/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ password: PASSWORD }) });
    expect(text.status).toBe(415);
    const cross = await t.post("/api/admin/login", { password: PASSWORD }, { Origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const cookie = await login(t);
    const crossAct = await t.post("/api/admin/action", { playerId: "p1", action: "gold", amount: 5 }, { Cookie: cookie, Origin: "https://evil.example" });
    expect(crossAct.status).toBe(403);
    expect(t.act).not.toHaveBeenCalled();
  });

  it("validates actions before touching the game, and logs successful ones", async () => {
    const t = await boot();
    const cookie = await login(t);
    for (const body of [{ playerId: "p1", action: "gold", amount: 0 }, { playerId: "p1", action: "gold", amount: 2_000_000 }, { playerId: "", action: "repairFull" }, { playerId: "npc:1", action: "repairFull" }, { playerId: "p1", action: "explode" }]) {
      const r = await t.post("/api/admin/action", body, { Cookie: cookie });
      expect(r.status).toBe(400);
    }
    expect(t.act).not.toHaveBeenCalled();
    const ok = await t.post("/api/admin/action", { playerId: "p1", action: "gold", amount: 100 }, { Cookie: cookie });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ ok: true, text: "Gave Salty Jo +100 gold", row: { gold: 360 } });
    expect(body.log).toHaveLength(1);
    const state = await (await t.req("/api/admin/state", { headers: { Cookie: cookie } })).json();
    expect(state.log[0].text).toBe("Gave Salty Jo +100 gold");
  });

  it("passes refusals through (409)", async () => {
    const t = await boot(undefined, { act: async () => ({ ok: false, status: 409, error: "That captain is no longer online" }) });
    const cookie = await login(t);
    const r = await t.post("/api/admin/action", { playerId: "p1", action: "upgrade" }, { Cookie: cookie });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ message: "That captain is no longer online" });
  });

  it("unknown /api/admin paths 404 instead of falling through to the SPA", async () => {
    const t = await boot();
    const r = await t.req("/api/admin/nope");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("application/json");
    const page = await t.req("/admin");
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
  });
});

describe("POST /api/visit", () => {
  it("counts sanitized sources and rate limits per IP", async () => {
    const t = await boot();
    expect((await t.post("/api/visit", { source: "tiktok" })).status).toBe(204);
    expect((await t.post("/api/visit", { source: "<img src=x>" })).status).toBe(204);
    expect((await t.post("/api/visit", { source: 42 })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 10));
    const all = Object.assign({}, ...Array.from(t.store.data.entries()).filter(([k]) => k.endsWith(":visits")).map(([, v]) => v));
    expect(all).toEqual({ TikTok: 1, imgsrcx: 1, Direct: 1 });
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await t.post("/api/visit", { source: "Direct" })).status;
    expect(last).toBe(429);
    expect((await t.req("/api/visit", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status).toBe(415);
  });

  it("works while admin is disabled", async () => {
    const t = await boot({});
    expect((await t.post("/api/visit", { source: "YouTube" })).status).toBe(204);
  });
});
