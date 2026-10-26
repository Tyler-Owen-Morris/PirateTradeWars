/**
 * Where a player came from (admin dashboard, docs/admin/README.md "Where players come from").
 *
 * The client classifies its landing page once per browser session (`client/src/lib/source.ts`):
 * `utm_source` (or `?ref=`) wins, else `document.referrer` is classified, else "Direct". The label
 * travels in the `POST /api/visit` beacon and the websocket `connect`/`reconnect` messages, and the
 * server re-sanitizes it with `sanitizeSource` (never trust the client's string).
 *
 * A source label is either one of the canonical names below or a lowercase domain-like token
 * (`[a-z0-9.-]`, at most MAX_SOURCE_LENGTH chars), e.g. "piratesforum.net". Anything else = "Direct".
 * Pure, no DOM: safe for the server and for vitest.
 */

export const MAX_SOURCE_LENGTH = 40;
export const MAX_CAMPAIGN_LENGTH = 40;

/** Canonical labels. The social networks are counted in the dashboard's "From social" tiles. */
export const SOCIAL_SOURCES = ["TikTok", "YouTube", "Facebook", "X", "Instagram", "Reddit"] as const;
export const CANONICAL_SOURCES = [...SOCIAL_SOURCES, "Search", "Discord", "Direct"] as const;
export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

const SOCIAL_SET = new Set<string>(SOCIAL_SOURCES);
const CANONICAL_BY_LOWER = new Map<string, string>(CANONICAL_SOURCES.map((s) => [s.toLowerCase(), s]));

/** Alias (utm value or host fragment, lowercase) -> canonical label. */
const ALIASES: Record<string, CanonicalSource> = {
  tiktok: "TikTok", tt: "TikTok", "tiktok.com": "TikTok",
  youtube: "YouTube", yt: "YouTube", youtu: "YouTube", "youtube.com": "YouTube", "youtu.be": "YouTube",
  facebook: "Facebook", fb: "Facebook", meta: "Facebook", "facebook.com": "Facebook", "fb.com": "Facebook",
  "fb.me": "Facebook", "m.facebook.com": "Facebook", "l.facebook.com": "Facebook", "lm.facebook.com": "Facebook",
  x: "X", twitter: "X", "x.com": "X", "twitter.com": "X", "t.co": "X",
  instagram: "Instagram", ig: "Instagram", insta: "Instagram", "instagram.com": "Instagram", "l.instagram.com": "Instagram",
  reddit: "Reddit", "reddit.com": "Reddit", "old.reddit.com": "Reddit", "out.reddit.com": "Reddit",
  google: "Search", bing: "Search", duckduckgo: "Search", yahoo: "Search", search: "Search", ecosia: "Search",
  discord: "Discord", "discord.com": "Discord", "discord.gg": "Discord", "discordapp.com": "Discord",
  direct: "Direct", none: "Direct",
};

/** Host suffix -> canonical label (checked after exact aliases). Order matters only for overlaps. */
const HOST_RULES: Array<[RegExp, CanonicalSource]> = [
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "Facebook"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "X"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "Reddit"],
  [/(^|\.)(discord\.com|discord\.gg|discordapp\.com)$/, "Discord"],
  // Search engines: google.<tld>, google.co.<cc>, bing, duckduckgo, yahoo, ecosia, brave search, yandex, baidu
  [/(^|\.)google\.[a-z.]+$/, "Search"],
  [/(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$/, "Search"],
];

/** True for the social-network labels (TikTok, YouTube, Facebook, X, Instagram, Reddit). */
export function isSocialSource(source: string | undefined | null): boolean {
  return !!source && SOCIAL_SET.has(source);
}

/** Lowercase a token and keep only [a-z0-9.-]; "" when nothing usable is left. */
function token(raw: string, max: number): string {
  return raw.trim().toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").replace(/^[.-]+|[.-]+$/g, "").slice(0, max);
}

/** Classify a hostname (no scheme/path) into a canonical label, or return the bare domain. */
export function classifyHost(host: string): string {
  const h = token(host, 253);
  if (!h) return "Direct";
  const alias = ALIASES[h];
  if (alias) return alias;
  for (const [re, label] of HOST_RULES) if (re.test(h)) return label;
  return h.slice(0, MAX_SOURCE_LENGTH);
}

/**
 * Classify the landing page. `utm` = utm_source (or ref) from the query string; `referrer` =
 * document.referrer; `selfHost` = our own host (a same-site referrer is not a source).
 */
export function classifySource(input: { utm?: string | null; referrer?: string | null; selfHost?: string | null }): string {
  if (input.utm && input.utm.trim()) return sanitizeSource(input.utm);
  const ref = (input.referrer ?? "").trim();
  if (!ref) return "Direct";
  let host = "";
  try {
    host = new URL(ref).hostname;
  } catch {
    return "Direct";
  }
  if (!host) return "Direct";
  const self = token(input.selfHost ?? "", 253);
  if (self && token(host, 253) === self) return "Direct";
  return classifyHost(host);
}

/**
 * Server-side (and client-side) sanitizer: map any string to a safe label. Canonical names (any
 * case) and aliases ("fb", "yt", "twitter", "t.co", "google"...) map to their canonical label;
 * other values become a lowercase domain-like token of at most MAX_SOURCE_LENGTH chars; non-strings,
 * empty or junk values become "Direct".
 */
export function sanitizeSource(raw: unknown): string {
  if (typeof raw !== "string") return "Direct";
  if (raw.length > 200) return "Direct";
  const canonical = CANONICAL_BY_LOWER.get(raw.trim().toLowerCase());
  if (canonical) return canonical;
  const t = token(raw, 253);
  if (!t) return "Direct";
  return classifyHost(t);
}

/** Campaign names (utm_campaign): lowercase [a-z0-9_.-], at most MAX_CAMPAIGN_LENGTH; undefined if empty/invalid. */
export function sanitizeCampaign(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 200) return undefined;
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, MAX_CAMPAIGN_LENGTH);
  return t || undefined;
}
