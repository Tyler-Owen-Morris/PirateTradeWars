import { describe, expect, it } from "vitest";
import { DailyStats, VisitLimiter, adminTimeZone, dayKey, summarizeToday, STATS_TTL_SECONDS, type StatsStore } from "../stats";

describe("daily stats", () => {
  it("day keys follow the admin time zone", () => {
    const t = Date.UTC(2026, 9, 26, 3, 0); // 03:00 UTC on Oct 26 = 20:00 Oct 25 in Los Angeles
    expect(dayKey(t, "UTC")).toBe("2026-10-26");
    expect(dayKey(t, "America/Los_Angeles")).toBe("2026-10-25");
    expect(adminTimeZone({})).toBe("America/Los_Angeles");
    expect(adminTimeZone({ ADMIN_TZ: "Not/AZone" })).toBe("UTC");
  });

  it("counts by sanitized source with a 90-day TTL, and the cached copy updates at once", async () => {
    const calls: any[] = [];
    const data: Record<string, Record<string, number>> = {};
    const store: StatsStore = {
      async incrDailyStat(day, kind, field, ttl) {
        calls.push([day, kind, field, ttl]);
        const r = (data[`${day}:${kind}`] ??= {});
        r[field] = (r[field] ?? 0) + 1;
      },
      async getDailyStat(day, kind) {
        return { ...(data[`${day}:${kind}`] ?? {}) };
      },
    };
    const now = Date.UTC(2026, 9, 25, 12);
    const s = new DailyStats(store, "UTC", () => now, 60_000);
    expect(await s.today()).toMatchObject({ day: "2026-10-25", visits: {}, captains: {} });
    s.count("captains", "tiktok");
    s.count("visits", "TikTok");
    s.count("visits", "evil<script>");
    expect(calls[0]).toEqual(["2026-10-25", "captains", "TikTok", STATS_TTL_SECONDS]);
    expect(STATS_TTL_SECONDS).toBe(90 * 86400);
    const t = await s.today(); // cached
    expect(t.captains).toEqual({ TikTok: 1 });
    expect(t.visits).toEqual({ TikTok: 1, evilscript: 1 });
  });

  it("a broken store never throws into the caller", () => {
    const s = new DailyStats({} as StatsStore, "UTC");
    expect(() => s.count("captains", "Direct")).not.toThrow();
  });

  it("summarizes the tiles", () => {
    const sum = summarizeToday({
      day: "2026-10-25",
      timeZone: "UTC",
      captains: { TikTok: 12, YouTube: 6, Facebook: 3, X: 2, Direct: 15, Search: 3 },
      visits: { TikTok: 30, YouTube: 20, Facebook: 7, X: 4, Instagram: 2, Direct: 50 },
    });
    expect(sum.newCaptains).toBe(41);
    expect(sum.socialCaptains).toBe(23);
    expect(sum.socialVisits).toBe(63);
    expect(sum.totalVisits).toBe(113);
    expect(sum.socialBreakdown.map((b) => b.source)).toEqual(["TikTok", "YouTube", "Facebook", "X", "Instagram"]);
    expect(sum.socialBreakdown[4]).toEqual({ source: "Instagram", captains: 0, visits: 2 });
  });
});

describe("visit limiter", () => {
  it("allows 20 per IP per hour", () => {
    let now = 0;
    const l = new VisitLimiter(20, 3_600_000, () => now);
    for (let i = 0; i < 20; i++) expect(l.allow("1.2.3.4")).toBe(true);
    expect(l.allow("1.2.3.4")).toBe(false);
    expect(l.allow("5.6.7.8")).toBe(true);
    now += 3_600_000;
    expect(l.allow("1.2.3.4")).toBe(true);
  });
});
