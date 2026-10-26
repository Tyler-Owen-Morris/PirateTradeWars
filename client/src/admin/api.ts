/**
 * Thin fetch wrapper for the admin API (docs/admin/README.md "API"). The session lives in an HttpOnly
 * cookie the page never sees; every POST is JSON (the server's CSRF guard requires it).
 */
import type { AdminActionName, AdminActionResponse, AdminStateResponse } from "@shared/adminApi";

export type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: any };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* empty body */
  }
  return res.ok ? { ok: true, status: res.status, body: parsed as T } : { ok: false, status: res.status, body: parsed };
}

export const adminApi = {
  session: () => call<{ ok: true }>("GET", "/api/admin/session"),
  login: (password: string) => call<{ ok: true }>("POST", "/api/admin/login", { password }),
  logout: () => call<{ ok: true }>("POST", "/api/admin/logout", {}),
  state: () => call<AdminStateResponse>("GET", "/api/admin/state"),
  action: (playerId: string, action: AdminActionName, amount?: number) =>
    call<AdminActionResponse>("POST", "/api/admin/action", amount === undefined ? { playerId, action } : { playerId, action, amount }),
};
