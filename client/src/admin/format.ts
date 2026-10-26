/** Formatting + presentation helpers for the admin page (pure; unit tested in __tests__/format.test.ts). */
import type { AdminPlayerRow, AdminStatus } from "@shared/adminApi";
import { isSocialSource } from "@shared/source";

export const STATUS: Record<AdminStatus, { label: string; color: string }> = {
  sea: { label: "At sea", color: "#7db4ef" },
  port: { label: "In port", color: "#e0b45a" },
  combat: { label: "In combat", color: "#ff8a6b" },
  idle: { label: "Idle", color: "#c9c3b6" },
};

export type FilterKey = "all" | "sea" | "port" | "combat" | "social";
export const FILTERS: Array<[FilterKey, string]> = [
  ["all", "All"],
  ["sea", "At sea"],
  ["port", "In port"],
  ["combat", "In combat"],
  ["social", "From social"],
];

export function matchesFilter(r: AdminPlayerRow, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "social") return isSocialSource(r.source);
  return r.status === f;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

/** "4m", "34m", "2h 10m". */
export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "21:42" in the viewer's local time. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function hpColor(hp: number, max: number): string {
  const f = max > 0 ? hp / max : 0;
  return f > 0.6 ? "#6fd08c" : f > 0.3 ? "#e0b45a" : "#ff8a6b";
}

/** Equirectangular map position (percent of width/height) of a lat/lon. */
export function mapPos(lat: number, lon: number): { left: string; top: string } {
  return { left: `${(((lon + 180) / 360) * 100).toFixed(2)}%`, top: `${(((90 - lat) / 180) * 100).toFixed(2)}%` };
}

/** Parse the custom gold box: a whole number 1..max, else an error message. */
export function parseGold(raw: string, max: number): { ok: true; amount: number } | { ok: false; error: string } {
  const t = raw.trim().replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(t)) return { ok: false, error: "Enter a whole number of gold." };
  const n = Number(t);
  if (n < 1 || n > max) return { ok: false, error: `Gold must be from 1 to ${fmt(max)}.` };
  return { ok: true, amount: n };
}
