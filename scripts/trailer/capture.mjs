#!/usr/bin/env node
// Trailer capture driver. Drives a LOCALLY RUNNING dev game to each shot in scripts/trailer/shots.mjs and records
// ONLY THE PAGE (never the desktop: Theo may be using the PC). Docs: docs/trailer/NOTES.md ("Trailer 1 run log").
//
//   node scripts/trailer/capture.mjs --list
//   node scripts/trailer/capture.mjs --base http://localhost:5150 --shot havana-approach --aspect 16x9 --preview   # 3 PNGs
//   node scripts/trailer/capture.mjs --base http://localhost:5150 --shot havana-approach --aspect 16x9             # frames
//   node scripts/trailer/capture.mjs --base http://localhost:5150 --shot sail-run --aspect 16x9                    # realtime
//   node scripts/trailer/capture.mjs --all --aspect 9x16
//
// Options: --base http://localhost:5000  --out <dir> (default <repo>/capture, git-ignored)  --fps 30
//          --name "Trailer Captain"  --swiftshader (software GL)  --no-expansion (skip needs:expansion)  --headed
//
// Both modes run HEADLESS Chromium on the GPU (ANGLE D3D11; checked 2026-10-25: "ANGLE (NVIDIA GeForce RTX 3060
// Direct3D11)" headless), at the exact output size (1920x1080 or 1080x1920), so nothing is cropped or upscaled.
//   frames   : virtual clock, one screenshot per 1/fps step. Output <out>/<aspect>/<id>/00000.png..
//   realtime : real clock, CDP Page.startScreencast (JPEG q95) while the shot's run(h) plays; the variable-rate
//              frames are resampled to constant fps. Output <out>/<aspect>/<id>/00000.jpg..  (+ frames.json timings)
// edit.mjs reads either kind of folder.
//
// Needs: the game on --base started in dev mode (CLAUDE.md gotchas: Docker Redis on a private DB, dummy Stripe keys,
// SHIPS_FREE=true so any ship can be picked) and, for teleports/NPC spawns, docs/world/qa/scripts/devtp.patch applied
// (UNCOMMITTED) with PTW_DEV_TELEPORT=1.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SHOTS, byId } from "./shots.mjs";
import { loadPlaywright } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

// ---- args ----
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const BASE = opt("base", "http://localhost:5000");
const OUT = path.resolve(opt("out", path.join(repo, "capture")));
const FPS = Number(opt("fps", 30));
const ASPECT = opt("aspect", "16x9");
const SIZE = ASPECT === "9x16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const NAME = opt("name", null);
// Invented names only (a name already at sea cannot join twice, so each run picks one at random).
const FIRST = ["Calico", "Black Bart", "Red Ned", "Mad Mary", "Long Tom", "Salty Bess", "Gentle Jonas", "One-Eyed Ezra", "Iron Anne", "Silver Silas", "Dread Molly", "Captain Kit"];
const LAST = ["Rowe", "Hale", "Blackwake", "Flint", "Tarrow", "Crowe", "Vane", "Marlowe", "Quill", "Bonny", "Stroud", "Penhallow"];
// Ships persist in Redis for hours and a name at sea cannot join twice, so every join draws a fresh invented name.
const captain = () => `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (opt("list", false)) {
  for (const s of SHOTS) console.log(`${s.id.padEnd(18)} ${s.mode.padEnd(8)} ${String(s.dur).padStart(4)}s  ${s.needs ? "[needs " + s.needs + "] " : ""}${s.note}`);
  process.exit(0);
}

const { chromium } = loadPlaywright();

// ---- virtual clock (frames mode). Installed before any page script runs. ----
const CLOCK_INIT = () => {
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now;
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  let virtual = false;
  let vnow = 0;
  let dateBase = 0;
  let nextId = 1;
  let queue = new Map();
  performance.now = () => (virtual ? vnow : realNow());
  Date.now = () => (virtual ? dateBase + vnow : realDateNow());
  window.requestAnimationFrame = (cb) => {
    if (!virtual) return realRaf(cb);
    const id = nextId++;
    queue.set(id, cb);
    return -id; // negative = ours
  };
  window.cancelAnimationFrame = (id) => (id < 0 ? queue.delete(-id) : realCaf(id));
  window.__clock = {
    /** Freeze: from now on time only moves through step(). */
    freeze() {
      vnow = realNow();
      dateBase = realDateNow() - vnow;
      virtual = true;
    },
    /** Advance `ms` of virtual time and run every pending rAF callback once (the game renders inside). */
    step(ms) {
      vnow += ms;
      const q = queue;
      queue = new Map();
      for (const cb of q.values()) cb(vnow);
    },
    pending: () => queue.size,
    /** Back to the real clock (so the page can talk to the server normally again, e.g. to retire the ship). */
    unfreeze() {
      virtual = false;
      const q = queue;
      queue = new Map();
      for (const cb of q.values()) realRaf(cb);
    },
  };
};

// ---- game helpers ----
const C = 400000, H = 200000;
function makeHelpers(page, ports) {
  const byKey = Object.fromEntries(ports.map((p) => [p.key ?? p.id, p]));
  const at = (lat, lon) => [((lon + 180) / 360) * C, ((90 - lat) / 180) * H];
  const dockNear = (key, dist, sideDeg = 0) => {
    const p = byKey[key];
    if (!p) throw new Error("unknown port " + key + ": " + Object.keys(byKey).join(","));
    const mx = Math.max(0.01, Math.cos(((90 - p.dock.z / H * 180) * Math.PI) / 180));
    let ux = (p.dock.x - p.x) * mx, uz = p.dock.z - p.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l; // seaward
    const a = (sideDeg * Math.PI) / 180;
    const rx = ux * Math.cos(a) - uz * Math.sin(a), rz = ux * Math.sin(a) + uz * Math.cos(a);
    return [p.dock.x + (rx * dist) / mx, p.dock.z + rz * dist];
  };
  return {
    page,
    sleep,
    viewport: SIZE,
    aspect: ASPECT,
    at,
    dockNear,
    port: (key) => byKey[key],
    firstPort: (keys) => keys.find((k) => byKey[k]) ?? (() => { throw new Error("none of " + keys + " exist"); })(),
    tp: async (x, z, r = 0, v = 0) => {
      await page.evaluate(([x, z, r, v]) => window.__net.send({ t: "devtp", x, z, r, v }), [x, z, r, v]);
      await sleep(1500);
      const got = await page.evaluate(() => { const c = window.__net.predictor.cur; return { x: c.x, z: c.z, r: c.rotationY }; });
      const off = Math.hypot(got.x - x, got.z - z);
      if (off > 30 || process.env.TRAILER_DEBUG) console.log(`  tp asked (${x.toFixed(0)}, ${z.toFixed(0)}) got (${got.x.toFixed(0)}, ${got.z.toFixed(0)}) off ${off.toFixed(0)}`);
    },
    npc: (o) => page.evaluate((o) => window.__net.send({ t: "devnpc", ...o }), o),
    me: () => page.evaluate(() => { const c = window.__net.predictor.cur; return { x: c.x, z: c.z, r: c.rotationY }; }),
    keys: {
      hold: async (ks, ms) => { for (const k of ks) await page.keyboard.down(k); await sleep(ms); for (const k of ks) await page.keyboard.up(k); },
      down: async (k) => page.keyboard.down(k),
      up: async (k) => page.keyboard.up(k),
      tap: async (k) => { await page.keyboard.down(k); await sleep(120); await page.keyboard.up(k); },
    },
  };
}

async function join(browser, shot, { frames }) {
  // NOTE: keep deviceScaleFactor 1. CDP screencast frames come at CSS-pixel size, so a dpr > 1 viewport would come
  // out smaller than the target frame. To enlarge a UI panel use shot.css (e.g. CSS zoom on the panel) instead.
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("pageerror:", String(e).slice(0, 200)));
  if (frames) await page.addInitScript(CLOCK_INIT);
  // shot.plates: true = all nameplates, "others" = all but your own, default = none (cinematic)
  await page.goto(`${BASE}/?trailer=1&plates=${shot.plates === true ? "all" : shot.plates === "others" ? "others" : "0"}`);
  await page.waitForSelector("#playerName", { timeout: 90000 });
  await page.fill("#playerName", shot.name ?? (typeof NAME === "string" ? NAME : captain()));
  if (shot.css) await page.addStyleTag({ content: shot.css });
  if (shot.lobby) { await sleep(1500); return { ctx, page, ports: [] }; } // ship-selection screen shots: do not join
  await page.click(`[data-testid="cypress-${shot.ship}-card"]`);
  await page.click('[data-testid="cypress-start-game-button"]');
  await page.waitForSelector('[data-testid="cypress-player-name"]', { timeout: 60000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(OUT, `join-failed-${shot.id}.png`) }).catch(() => {});
    throw e;
  });
  await page.waitForFunction(async () => (await import("/src/lib/net/index.ts")).net.predictor.initialized, null, { timeout: 30000 });
  await page.evaluate(async () => { window.__net = (await import("/src/lib/net/index.ts")).net; });
  await page.waitForFunction(() => !!window.__trailer, null, { timeout: 30000 });
  const ports = await page.evaluate(() => fetch("/api/ports").then((r) => r.json()));
  return { ctx, page, ports };
}

// Ships persist at sea for hours after a disconnect (galleon 4 h), so every shot RETIRES (scuttles) its ship when
// done; otherwise the next shots are full of ghost ships. The HUD may be hidden, DOM clicks still work.
async function retire(page) {
  try {
    await page.evaluate(() => document.querySelector('[data-testid="cypress-scuttle-ship-request-button"]')?.click());
    await sleep(400);
    await page.evaluate(() => document.querySelector('[data-testid="cypress-scuttle-ship-confirm-button"]')?.click());
    await sleep(1200);
  } catch {}
}

const shotDir = (shot) => {
  const dir = path.join(OUT, ASPECT, shot.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// ---- frames mode ----
async function captureFrames(browser, shot, preview) {
  const { ctx, page, ports } = await join(browser, shot, { frames: true });
  const h = makeHelpers(page, ports);
  await shot.setup(h);
  const pth = typeof shot.path === "function" ? await shot.path(h) : shot.path;
  await page.evaluate(([p, hud]) => { window.__trailer.hud(hud); window.__trailer.setPath(p); window.__trailer.seek(0); }, [pth, !!shot.hud]);
  // Let tiles / towns stream in on the REAL clock, then freeze time.
  await sleep(shot.settleMs ?? 5000);
  await page.evaluate(() => window.__clock.freeze());
  const dtMs = 1000 / FPS;
  const step = async (t) => {
    await page.evaluate(([t, dt]) => { window.__trailer.seek(t); window.__clock.step(dt); }, [t, dtMs]);
  };
  for (let i = 0; i < FPS; i++) await step(0); // 1 s of warm-up frames at t=0 (shaders, tile builds, camera smoothing)
  const dir = shotDir(shot);
  const total = Math.round(shot.dur * FPS);
  const marks = preview ? new Set([0, Math.floor(total / 2), total - 1]) : null;
  for (let f = 0; f < total; f++) {
    await step(f / FPS);
    if (marks && !marks.has(f)) continue;
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, "0")}.png`), type: "png" });
    if (f % FPS === 0) console.log(`  ${shot.id}: ${f}/${total}`);
  }
  await page.evaluate(() => window.__clock.unfreeze());
  await retire(page);
  await ctx.close();
  console.log(`frames -> ${dir}`);
}

// ---- realtime mode: page-only CDP screencast, resampled to constant fps ----
async function captureRealtime(browser, shot, preview) {
  const { ctx, page, ports } = await join(browser, shot, { frames: false });
  const h = makeHelpers(page, ports);
  await shot.setup(h);
  if (!shot.lobby) await page.evaluate((hud) => window.__trailer.hud(hud), !!shot.hud);
  // Optional camera path in realtime: posed at t=0 now, played (real time) when the run starts. The path can
  // anchor on the own ship with rot:"ship" for a close chase/orbit that follows the ship as it sails.
  const pth = typeof shot.path === "function" ? await shot.path(h) : shot.path;
  if (pth) await page.evaluate((p) => { window.__trailer.setPath(p); window.__trailer.seek(0); }, pth);
  if (shot.pre) await shot.pre(h); // e.g. get under way before the recording starts
  await sleep(shot.settleMs ?? 3000);
  const dir = shotDir(shot);
  const raw = path.join(dir, "raw");
  fs.mkdirSync(raw);
  const cdp = await ctx.newCDPSession(page);
  const got = []; // { ts, file }
  let recording = !preview;
  cdp.on("Page.screencastFrame", async (f) => {
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (!recording) return;
    const file = path.join(raw, `${String(got.length).padStart(5, "0")}.jpg`);
    got.push({ ts: f.metadata.timestamp, file });
    fs.writeFile(file, Buffer.from(f.data, "base64"), () => {});
  });
  if (!preview) await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  const marks = [];
  h.mark = async (label) => {
    if (preview) await page.screenshot({ path: path.join(dir, `preview-${String(marks.length).padStart(2, "0")}-${label}.png`) });
    marks.push({ label, t: Date.now() / 1000 - t0 });
  };
  if (preview) await h.mark("start");
  if (pth) page.evaluate(() => window.__trailer.play()).catch(() => {});
  await shot.run(h);
  if (preview) await h.mark("end");
  if (!preview) await cdp.send("Page.stopScreencast");
  await sleep(500);
  await retire(page);
  await ctx.close();
  if (preview) { fs.rmSync(raw, { recursive: true, force: true }); console.log(`preview -> ${dir}`); return; }
  // resample to constant fps: output frame k shows the newest captured frame at or before t0 + k/fps
  const start = got[0]?.ts ?? t0;
  const end = got[got.length - 1]?.ts ?? t0;
  const n = Math.floor((end - start) * FPS);
  let j = 0, dups = 0;
  for (let k = 0; k < n; k++) {
    const t = start + k / FPS;
    let jj = j;
    while (jj + 1 < got.length && got[jj + 1].ts <= t) jj++;
    if (jj === j && k > 0) dups++;
    j = jj;
    fs.copyFileSync(got[j].file, path.join(dir, `${String(k).padStart(5, "0")}.jpg`));
  }
  const gaps = got.slice(1).map((g, i) => g.ts - got[i].ts);
  const stats = { captured: got.length, seconds: +(end - start).toFixed(2), capFps: +(got.length / (end - start)).toFixed(1),
    maxGapMs: Math.round(Math.max(0, ...gaps) * 1000), gapsOver50ms: gaps.filter((g) => g > 0.05).length, gapsOver100ms: gaps.filter((g) => g > 0.1).length, outFrames: n, repeatedOutFrames: dups, marks: marks.map((m) => ({ ...m, t: +(m.t - (start - t0)).toFixed(2) })) };
  fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify(stats, null, 1));
  fs.rmSync(raw, { recursive: true, force: true });
  console.log(`realtime -> ${dir}  ${JSON.stringify(stats)}`);
}

// ---- main ----
const wanted = opt("all", false) ? SHOTS : String(opt("shot", "")).split(",").map(byId).filter(Boolean);
if (!wanted.length) { console.error("usage: --list | --shot <id>[,<id>] | --all  [--aspect 16x9|9x16] [--preview]"); process.exit(1); }
const preview = !!opt("preview", false);
const gl = opt("swiftshader", false) ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: !opt("headed", false), args: [...gl, "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
try {
  for (const shot of wanted) {
    if (shot.needs === "expansion" && opt("no-expansion", false)) { console.log(`skip ${shot.id} (needs expansion)`); continue; }
    console.log(`== ${shot.id} (${shot.mode}, ${ASPECT}${preview ? ", preview" : ""})`);
    try {
      if (shot.mode === "frames") await captureFrames(browser, shot, preview);
      else await captureRealtime(browser, shot, preview);
    } catch (e) {
      console.error(`FAILED ${shot.id}:`, e.message);
    }
  }
} finally {
  await browser.close();
}
