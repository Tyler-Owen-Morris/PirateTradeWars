#!/usr/bin/env node
// Trailer capture driver. Drives a LOCALLY RUNNING dev game (npm run dev, vite dev server) to each shot in
// scripts/trailer/shots.mjs and records it. Docs: docs/trailer/NOTES.md. UNTESTED against a live game: it
// was written while the PC was not allowed to boot the server, so expect a tuning pass on first use.
//
//   node scripts/trailer/capture.mjs --list
//   node scripts/trailer/capture.mjs --shot havana-approach --aspect 16x9 --preview     # 3 PNGs: check framing
//   node scripts/trailer/capture.mjs --shot havana-approach --aspect 16x9               # frames mode -> PNG sequence
//   node scripts/trailer/capture.mjs --shot sail-run --aspect 16x9                      # realtime -> mp4 via gdigrab
//   node scripts/trailer/capture.mjs --all --aspect 9x16
//
// Options: --base http://localhost:5000  --out <dir> (default <repo>/capture, git-ignored)  --fps 30
//          --name TrailerCaptain  --swiftshader (software GL, slow, no GPU needed)  --no-expansion (skip needs:expansion)
//
// Needs: the game on --base started with `NODE_ENV=development DEV_START_GOLD=10000000 npm run dev` (see CLAUDE.md
// gotchas: local Redis in Docker, STRIPE_SECRET_KEY=sk_test_dummy) and, for teleports/NPC spawns, the QA-only
// patch docs/world/qa/scripts/devtp.patch applied (uncommitted!) with PTW_DEV_TELEPORT=1.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SHOTS, byId } from "./shots.mjs";
import { loadPlaywright, FFMPEG as FFMPEG_DEFAULT } from "./lib.mjs";

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
const NAME = opt("name", "Trailer Captain");
const FFMPEG = FFMPEG_DEFAULT;
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
  };
};

// ---- game helpers ----
const C = 400000, H = 200000;
function makeHelpers(page, ports) {
  const byKey = Object.fromEntries(ports.map((p) => [p.key ?? p.id, p]));
  const at = (lat, lon) => [((lon + 180) / 360) * C, ((90 - lat) / 180) * H];
  const dockNear = (key, dist) => {
    const p = byKey[key];
    if (!p) throw new Error("unknown port " + key + ": " + Object.keys(byKey).join(","));
    const mx = Math.max(0.01, Math.cos(((90 - p.dock.z / H * 180) * Math.PI) / 180));
    let ux = (p.dock.x - p.x) * mx, uz = p.dock.z - p.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l; // seaward
    return [p.dock.x + (ux * dist) / mx, p.dock.z + uz * dist];
  };
  return {
    page,
    sleep,
    viewport: SIZE,
    at,
    dockNear,
    firstPort: (keys) => keys.find((k) => byKey[k]) ?? (() => { throw new Error("none of " + keys + " exist: expansion not merged?"); })(),
    tp: async (x, z, r = 0) => {
      await page.evaluate(([x, z, r]) => window.__net.send({ t: "devtp", x, z, r }), [x, z, r]);
      await sleep(1500);
    },
    me: () => page.evaluate(() => { const c = window.__net.predictor.cur; return { x: c.x, z: c.z, r: c.rotationY }; }),
    keys: {
      hold: async (ks, ms) => { for (const k of ks) await page.keyboard.down(k); await sleep(ms); for (const k of ks) await page.keyboard.up(k); },
      tap: async (k) => { await page.keyboard.down(k); await sleep(120); await page.keyboard.up(k); },
    },
  };
}

async function join(browser, shot, { frames }) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("pageerror:", String(e).slice(0, 200)));
  if (frames) await page.addInitScript(CLOCK_INIT);
  await page.goto(`${BASE}/?trailer=1`);
  await page.waitForSelector("#playerName", { timeout: 60000 });
  await page.fill("#playerName", NAME);
  await page.click(`[data-testid="cypress-${shot.ship}-card"]`);
  await page.click('[data-testid="cypress-start-game-button"]');
  await page.waitForSelector('[data-testid="cypress-player-name"]', { timeout: 60000 });
  await page.waitForFunction(async () => (await import("/src/lib/net/index.ts")).net.predictor.initialized, null, { timeout: 30000 });
  await page.evaluate(async () => { window.__net = (await import("/src/lib/net/index.ts")).net; });
  await page.waitForFunction(() => !!window.__trailer, null, { timeout: 30000 });
  const ports = await page.evaluate(() => fetch("/api/ports").then((r) => r.json()));
  return { ctx, page, ports };
}

// ---- frames mode ----
async function captureFrames(browser, shot, preview) {
  const { ctx, page, ports } = await join(browser, shot, { frames: true });
  const h = makeHelpers(page, ports);
  await shot.setup(h);
  await page.evaluate((p) => { window.__trailer.hud(false); window.__trailer.setPath(p); window.__trailer.seek(0); }, shot.path);
  // Let tiles / towns stream in on the REAL clock, then freeze time.
  await sleep(4000);
  await page.evaluate(() => window.__clock.freeze());
  const dtMs = 1000 / FPS;
  const step = async (t) => {
    await page.evaluate(([t, dt]) => { window.__trailer.seek(t); window.__clock.step(dt); }, [t, dtMs]);
  };
  for (let i = 0; i < FPS; i++) await step(0); // 1 s of warm-up frames at t=0 (shaders, tile builds, camera smoothing)
  const dir = path.join(OUT, ASPECT, shot.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const total = Math.round(shot.dur * FPS);
  const marks = preview ? new Set([0, Math.floor(total / 2), total - 1]) : null;
  for (let f = 0; f < total; f++) {
    if (marks && !marks.has(f)) continue;
    await step(f / FPS);
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, "0")}.png`), type: "png" });
    if (f % FPS === 0) console.log(`  ${shot.id}: ${f}/${total}`);
  }
  await ctx.close();
  console.log(`frames -> ${dir}  (encode: edit.sh does ffmpeg -framerate ${FPS} -i %05d.png)`);
}

// ---- realtime mode: headed kiosk window + ffmpeg gdigrab of the desktop ----
async function captureRealtime(shot, preview) {
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-size=${SIZE.width},${SIZE.height}`, "--window-position=0,0", "--kiosk", "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"],
  });
  const { ctx, page, ports } = await join(browser, shot, { frames: false });
  const h = makeHelpers(page, ports);
  await shot.setup(h);
  await page.evaluate(() => window.__trailer.hud(false));
  if (shot.id === "trade-screen" || shot.id === "world-map" || shot.id === "leaderboard") await page.evaluate(() => window.__trailer.hud(true));
  await sleep(3000);
  if (preview) {
    fs.mkdirSync(path.join(OUT, ASPECT), { recursive: true });
    await page.screenshot({ path: path.join(OUT, ASPECT, `${shot.id}-preview.png`) });
    await browser.close();
    return;
  }
  fs.mkdirSync(path.join(OUT, ASPECT), { recursive: true });
  const file = path.join(OUT, ASPECT, `${shot.id}.mp4`);
  // NOTE: a real 9:16 window does not fit a landscape monitor. For ASPECT=9x16 the realtime shots are recorded
  // 16:9 (monitor size) and cropped in edit.sh (centre column). Set the monitor to 1920x1080 @100% scaling.
  const ff = spawn(FFMPEG, ["-y", "-f", "gdigrab", "-framerate", "60", "-draw_mouse", "0", "-video_size", "1920x1080", "-i", "desktop",
    "-t", String(shot.dur + 1), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", file], { stdio: "ignore" });
  await sleep(1200); // ffmpeg start-up
  await shot.run(h);
  await new Promise((r) => ff.on("exit", r));
  await browser.close();
  console.log(`realtime -> ${file}`);
}

// ---- main ----
const wanted = opt("all", false) ? SHOTS : [byId(opt("shot", ""))].filter(Boolean);
if (!wanted.length) { console.error("usage: --list | --shot <id> | --all  [--aspect 16x9|9x16] [--preview]"); process.exit(1); }
const preview = !!opt("preview", false);
const gl = opt("swiftshader", false) ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
for (const shot of wanted) {
  if (shot.needs === "expansion" && opt("no-expansion", false)) { console.log(`skip ${shot.id} (needs expansion)`); continue; }
  console.log(`== ${shot.id} (${shot.mode}, ${ASPECT}${preview ? ", preview" : ""})`);
  try {
    if (shot.mode === "frames") {
      const browser = await chromium.launch({ headless: true, args: gl });
      try { await captureFrames(browser, shot, preview); } finally { await browser.close(); }
    } else await captureRealtime(shot, preview);
  } catch (e) {
    console.error(`FAILED ${shot.id}:`, e.message);
  }
}
