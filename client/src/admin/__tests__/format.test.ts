import { describe, expect, it } from "vitest";
import { formatDuration, hpColor, mapPos, matchesFilter, parseGold } from "../format";
import { classifyLanding } from "@/lib/source";

describe("admin page helpers", () => {
  it("parseGold", () => {
    expect(parseGold("2500", 1_000_000)).toEqual({ ok: true, amount: 2500 });
    expect(parseGold(" 12,000 ", 1_000_000)).toEqual({ ok: true, amount: 12000 });
    for (const bad of ["", "abc", "-5", "1.5", "0", "1000001", "1e5"]) expect(parseGold(bad, 1_000_000).ok).toBe(false);
  });

  it("formatDuration", () => {
    expect(formatDuration(4 * 60_000 + 59_000)).toBe("4m");
    expect(formatDuration(130 * 60_000)).toBe("2h 10m");
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(-5)).toBe("0m");
  });

  it("mapPos is equirectangular", () => {
    expect(mapPos(0, 0)).toEqual({ left: "50.00%", top: "50.00%" });
    expect(mapPos(90, -180)).toEqual({ left: "0.00%", top: "0.00%" });
    expect(mapPos(-45, 90)).toEqual({ left: "75.00%", top: "75.00%" });
  });

  it("filters and hull colour", () => {
    const r = { status: "port", source: "TikTok" } as any;
    expect(matchesFilter(r, "all")).toBe(true);
    expect(matchesFilter(r, "port")).toBe(true);
    expect(matchesFilter(r, "sea")).toBe(false);
    expect(matchesFilter(r, "social")).toBe(true);
    expect(matchesFilter({ ...r, source: "Search" }, "social")).toBe(false);
    expect(hpColor(50, 50)).toBe("#6fd08c");
    expect(hpColor(10, 50)).toBe("#ff8a6b");
  });
});

describe("landing source", () => {
  it("utm_source / ref / referrer / direct", () => {
    expect(classifyLanding("https://piratetradewars.com/?utm_source=tiktok&utm_campaign=Trailer1", "")).toEqual({ source: "TikTok", campaign: "trailer1" });
    expect(classifyLanding("https://piratetradewars.com/?ref=yt", "https://www.google.com/")).toEqual({ source: "YouTube" });
    expect(classifyLanding("https://piratetradewars.com/", "https://t.co/xyz")).toEqual({ source: "X" });
    expect(classifyLanding("https://piratetradewars.com/", "https://piratetradewars.com/admin")).toEqual({ source: "Direct" });
    expect(classifyLanding("https://piratetradewars.com/", "")).toEqual({ source: "Direct" });
  });
});
