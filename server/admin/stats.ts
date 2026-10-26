/**
 * Daily traffic counters for the admin dashboard (docs/admin/README.md "Where players come from").
 *
 * Redis hashes `stats:<YYYY-MM-DD>:visits` and `stats:<YYYY-MM-DD>:captains` (field = source label,
 * value = count), each with a 90-day TTL. "Today" is the calendar day in ADMIN_TZ (default
 * America/Los_Angeles, Theo's time zone). Writes are fire-and-forget; reads for the 1 s dashboard poll
 * are cached for a few seconds. The store is injected so this is testable without Redis.
 */
import { isSocialSource, sanitizeSource } from "@shared/source";

export const STATS_TTL_SECONDS = 90 * 24 * 60 * 60;
export type StatKind = "visits" | "captains";

export interface StatsStore {
  incrDailyStat(day: string, kind: StatKind, field: string, ttlSeconds: number): Promise<void>;
  getDailyStat(day: string, kind: StatKind): Promise<Record<string, number>>;
}

export interface TodayCounts {
  day: string;
  timeZone: string;
  visits: Record<string, number>;
  captains: Record<string, number>;
}

export function adminTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const tz = (env.ADMIN_TZ ?? "").trim() || "America/Los_Angeles";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** YYYY-MM-DD of `ms` in `timeZone`. */
export function dayKey(ms: number, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export class DailyStats {
  private cache: { at: number; value: TodayCounts } | null = null;

  constructor(
    private readonly store: StatsStore,
    private readonly timeZone: string = adminTimeZone(),
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 3000,
  ) {}

  /** Count one event (fire-and-forget; also bumps the cached copy so the dashboard updates at once). */
  count(kind: StatKind, source: string): void {
    const field = sanitizeSource(source);
    const day = dayKey(this.now(), this.timeZone);
    if (this.cache && this.cache.value.day === day) {
      const bucket = this.cache.value[kind];
      bucket[field] = (bucket[field] ?? 0) + 1;
    }
    try {
      this.store.incrDailyStat(day, kind, field, STATS_TTL_SECONDS).catch((err) => console.error(`[admin] stats ${kind} failed:`, err));
    } catch (err) {
      console.error(`[admin] stats ${kind} failed:`, err); // never let a counter break a connect
    }
  }

  async today(): Promise<TodayCounts> {
    const now = this.now();
    const day = dayKey(now, this.timeZone);
    if (this.cache && this.cache.value.day === day && now - this.cache.at < this.cacheMs) return this.cache.value;
    const [visits, captains] = await Promise.all([this.store.getDailyStat(day, "visits"), this.store.getDailyStat(day, "captains")]);
    const value: TodayCounts = { day, timeZone: this.timeZone, visits, captains };
    this.cache = { at: now, value };
    return value;
  }
}

/**
 * `POST /api/visit` limiter: at most `max` beacons per IP per window (fixed window, in memory).
 * The client sends one per browser session, so 20/hour leaves room for a few tabs and reloads.
 */
export class VisitLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();

  constructor(private readonly max = 20, private readonly windowMs = 60 * 60 * 1000, private readonly now: () => number = Date.now) {}

  allow(ip: string): boolean {
    const now = this.now();
    const h = this.hits.get(ip);
    if (!h || now - h.start >= this.windowMs) {
      if (this.hits.size > 50_000) this.sweep(now);
      this.hits.set(ip, { start: now, n: 1 });
      return true;
    }
    if (h.n >= this.max) return false;
    h.n++;
    return true;
  }

  private sweep(now: number): void {
    this.hits.forEach((h, ip) => {
      if (now - h.start >= this.windowMs) this.hits.delete(ip);
    });
    // Still huge (a flood of fresh IPs): start over rather than grow without bound.
    if (this.hits.size > 50_000) this.hits.clear();
  }
}

export interface TodaySummary extends TodayCounts {
  /** New captains (connects, not reconnects) today, all sources. */
  newCaptains: number;
  /** New captains today whose source is a social network, and the per-network split (largest first). */
  socialCaptains: number;
  socialBreakdown: Array<{ source: string; captains: number; visits: number }>;
  /** Landing beacons today, all sources / social only. */
  visits: Record<string, number>;
  totalVisits: number;
  socialVisits: number;
}

const sum = (r: Record<string, number>, pick: (k: string) => boolean = () => true) =>
  Object.entries(r).reduce((n, [k, v]) => (pick(k) ? n + v : n), 0);

/** Totals for the dashboard tiles. */
export function summarizeToday(t: TodayCounts): TodaySummary {
  const networks = new Set<string>();
  for (const k of Object.keys(t.captains)) if (isSocialSource(k)) networks.add(k);
  for (const k of Object.keys(t.visits)) if (isSocialSource(k)) networks.add(k);
  const socialBreakdown = Array.from(networks)
    .map((source) => ({ source, captains: t.captains[source] ?? 0, visits: t.visits[source] ?? 0 }))
    .sort((a, b) => b.captains - a.captains || b.visits - a.visits || a.source.localeCompare(b.source));
  return {
    ...t,
    newCaptains: sum(t.captains),
    socialCaptains: sum(t.captains, isSocialSource),
    socialBreakdown,
    totalVisits: sum(t.visits),
    socialVisits: sum(t.visits, isSocialSource),
  };
}
