/**
 * Where this visitor came from (admin dashboard, docs/admin/README.md "Where players come from").
 *
 * On the first page load of a browser session `captureLandingSource()` reads `utm_source` (or `?ref=`)
 * and `utm_campaign`, else classifies `document.referrer` (shared/source.ts), stores the result in
 * sessionStorage and sends one `POST /api/visit` beacon. Later loads in the same session (reloads, the
 * game reconnecting) reuse the stored value and send nothing. `landingSource()` is what the websocket
 * `connect`/`reconnect` messages carry. Storage can be blocked (private mode): then it still works for
 * this page load, it just isn't remembered.
 */
import { classifySource, sanitizeCampaign, sanitizeSource } from "@shared/source";

const SOURCE_KEY = "ptw_source";
const VISIT_KEY = "ptw_visit_sent";

export interface LandingSource {
  source: string;
  campaign?: string;
}

let current: LandingSource | null = null;

function readStored(): LandingSource | null {
  try {
    const raw = sessionStorage.getItem(SOURCE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.source !== "string") return null;
    const out: LandingSource = { source: sanitizeSource(v.source) };
    const c = sanitizeCampaign(v.campaign);
    if (c) out.campaign = c;
    return out;
  } catch {
    return null;
  }
}

/** Classify this page load (pure apart from reading location/referrer). */
export function classifyLanding(href: string, referrer: string): LandingSource {
  let utm: string | null = null;
  let campaign: string | undefined;
  let host = "";
  try {
    const url = new URL(href);
    host = url.hostname;
    utm = url.searchParams.get("utm_source") || url.searchParams.get("ref");
    campaign = sanitizeCampaign(url.searchParams.get("utm_campaign") ?? undefined);
  } catch {
    /* keep defaults */
  }
  const out: LandingSource = { source: classifySource({ utm, referrer, selfHost: host }) };
  if (campaign) out.campaign = campaign;
  return out;
}

/** Call once at startup (game pages only, not /admin). Idempotent. */
export function captureLandingSource(): LandingSource {
  if (current) return current;
  current = readStored() ?? classifyLanding(window.location.href, document.referrer);
  try {
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(current));
  } catch {
    /* storage blocked */
  }
  let alreadySent = false;
  try {
    alreadySent = sessionStorage.getItem(VISIT_KEY) === "1";
    if (!alreadySent) sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    /* storage blocked: send for this load */
  }
  if (!alreadySent) {
    fetch("/api/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
      keepalive: true,
    }).catch(() => {
      /* analytics only */
    });
  }
  return current;
}

/** The session's source for the websocket connect/reconnect message ("Direct" before capture). */
export function landingSource(): LandingSource {
  return current ?? readStored() ?? { source: "Direct" };
}
