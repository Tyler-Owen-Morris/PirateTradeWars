import { describe, expect, it } from "vitest";
import { classifySource, isSocialSource, sanitizeCampaign, sanitizeSource } from "../source";
import { parseClientMessage } from "../protocol";

describe("classifySource", () => {
  const ref = (referrer: string) => classifySource({ referrer, selfHost: "piratetradewars.com" });

  it("prefers utm_source / ref over the referrer", () => {
    expect(classifySource({ utm: "tiktok", referrer: "https://www.google.com/" })).toBe("TikTok");
    expect(classifySource({ utm: "YT", referrer: "" })).toBe("YouTube");
    expect(classifySource({ utm: "fb" })).toBe("Facebook");
    expect(classifySource({ utm: "twitter" })).toBe("X");
    expect(classifySource({ utm: "ig" })).toBe("Instagram");
    expect(classifySource({ utm: "newsletter" })).toBe("newsletter");
  });

  it("classifies referrers", () => {
    expect(ref("https://www.tiktok.com/@ptw/video/1")).toBe("TikTok");
    expect(ref("https://m.youtube.com/watch?v=x")).toBe("YouTube");
    expect(ref("https://youtu.be/x")).toBe("YouTube");
    expect(ref("https://l.facebook.com/l.php?u=x")).toBe("Facebook");
    expect(ref("https://lm.facebook.com/")).toBe("Facebook");
    expect(ref("https://t.co/abc")).toBe("X");
    expect(ref("https://x.com/someone")).toBe("X");
    expect(ref("https://twitter.com/someone")).toBe("X");
    expect(ref("https://l.instagram.com/")).toBe("Instagram");
    expect(ref("https://old.reddit.com/r/webgames")).toBe("Reddit");
    expect(ref("https://www.google.com/")).toBe("Search");
    expect(ref("https://www.google.co.uk/")).toBe("Search");
    expect(ref("https://duckduckgo.com/")).toBe("Search");
    expect(ref("https://www.bing.com/search?q=pirates")).toBe("Search");
    expect(ref("https://www.crazygames.com/game/x")).toBe("crazygames.com");
  });

  it("no referrer, a bad one, or our own site = Direct", () => {
    expect(ref("")).toBe("Direct");
    expect(ref("not a url")).toBe("Direct");
    expect(ref("https://piratetradewars.com/")).toBe("Direct");
    expect(ref("https://www.piratetradewars.com/x")).toBe("Direct");
  });
});

describe("sanitizeSource", () => {
  it("keeps canonical labels and maps aliases", () => {
    for (const s of ["TikTok", "YouTube", "Facebook", "X", "Instagram", "Reddit", "Search", "Direct", "Discord"]) {
      expect(sanitizeSource(s)).toBe(s);
    }
    expect(sanitizeSource("tiktok")).toBe("TikTok");
    expect(sanitizeSource("TWITTER")).toBe("X");
    expect(sanitizeSource("google")).toBe("Search");
  });

  it("turns anything else into a short safe token, or Direct", () => {
    expect(sanitizeSource("<script>alert(1)</script>")).toBe("scriptalert1script");
    expect(sanitizeSource("Some Forum.NET")).toBe("someforum.net");
    expect(sanitizeSource("a".repeat(100))).toHaveLength(40);
    expect(sanitizeSource("x".repeat(500))).toBe("Direct");
    expect(sanitizeSource("")).toBe("Direct");
    expect(sanitizeSource("!!!")).toBe("Direct");
    expect(sanitizeSource(42)).toBe("Direct");
    expect(sanitizeSource(null)).toBe("Direct");
    expect(sanitizeSource({ a: 1 })).toBe("Direct");
  });

  it("isSocialSource", () => {
    expect(isSocialSource("TikTok")).toBe(true);
    expect(isSocialSource("X")).toBe(true);
    expect(isSocialSource("Search")).toBe(false);
    expect(isSocialSource("Direct")).toBe(false);
    expect(isSocialSource("tiktok")).toBe(false); // labels are canonical after sanitizing
  });

  it("sanitizeCampaign", () => {
    expect(sanitizeCampaign("Launch_Week-1")).toBe("launch_week-1");
    expect(sanitizeCampaign("<>")).toBeUndefined();
    expect(sanitizeCampaign(5)).toBeUndefined();
    expect(sanitizeCampaign("c".repeat(60))).toHaveLength(40);
  });
});

describe("connect/reconnect carry a sanitized source", () => {
  it("parses source and campaign", () => {
    const m = parseClientMessage(JSON.stringify({ type: "connect", name: "Salty Jo", shipType: "sloop", source: "tiktok", campaign: "Trailer 1" }));
    expect(m).toMatchObject({ type: "connect", source: "TikTok", campaign: "trailer1" });
    const r = parseClientMessage(JSON.stringify({ type: "reconnect", id: "abc", name: "Salty Jo", source: "<b>evil</b>" }));
    expect(r).toMatchObject({ type: "reconnect", source: "bevilb" });
  });

  it("old clients without a source still parse (no source field)", () => {
    const m = parseClientMessage(JSON.stringify({ type: "connect", name: "Salty Jo", shipType: "sloop" }));
    expect(m).toEqual({ type: "connect", name: "Salty Jo", shipType: "sloop" });
  });
});
