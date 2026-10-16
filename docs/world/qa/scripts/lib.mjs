import { createRequire } from 'module';
const require = createRequire('C:/Users/theow/Documents/GitHub Projects/PirateTradeWars/.claude/worktrees/agent-a36d07bc9afd46740/package.json');
export const { chromium } = require('playwright');
export const BASE = 'http://localhost:5601';
export const QA = 'C:/Users/theow/Documents/GitHub Projects/PirateTradeWars/.claude/worktrees/agent-a36d07bc9afd46740/docs/world/qa';
export const C = 400000, H = 200000;
export const lon = (x) => x / C * 360 - 180;
export const lat = (z) => 90 - z / H * 180;
export const xOf = (lo) => (lo + 180) / 360 * C;
export const zOf = (la) => (90 - la) / 180 * H;
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function launch() {
  return chromium.launch({ headless: true, args: process.env.SWS ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
}

export async function join(browser, name, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 300)));
  await page.goto(BASE + '/' + query);
  await page.waitForSelector('#playerName', { timeout: 60000 });
  await page.fill('#playerName', name);
  await page.click('[data-testid="cypress-sloop-card"]');
  await page.click('[data-testid="cypress-start-game-button"]');
  await page.waitForSelector('[data-testid="cypress-player-name"]', { timeout: 60000 });
  await installHooks(page);
  return { ctx, page, logs };
}

export async function installHooks(page) {
  await page.waitForFunction(async () => {
    const m = await import('/src/lib/net/index.ts');
    return m.net.predictor.initialized;
  }, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const m = await import('/src/lib/net/index.ts');
    const net = m.net;
    window.__net = net;
    if (!window.__qa) {
      window.__qa = { corr: [], frames: [], snaps0: net.predictor.snaps };
      const orig = net.predictor.reconcile.bind(net.predictor);
      net.predictor.reconcile = (me, ack) => { const d = orig(me, ack); window.__qa.corr.push(d); return d; };
      let last = performance.now();
      const loop = (t) => {
        const s = net.getOwnRenderState();
        window.__qa.frames.push([t - last, s.x, s.z, s.rotationY, s.velocity]);
        if (window.__qa.frames.length > 20000) window.__qa.frames.splice(0, 10000);
        last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  });
}

export async function state(page) {
  return page.evaluate(() => {
    const n = window.__net; const p = n.predictor;
    return { x: p.cur.x, z: p.cur.z, r: p.cur.rotationY, v: p.cur.velocity, snaps: p.snaps, errX: p.errX, errZ: p.errZ };
  });
}

/** Reset the frame/correction buffers. */
export async function resetQa(page) {
  await page.evaluate(() => { window.__qa.corr = []; window.__qa.frames = []; window.__qa.snaps0 = window.__net.predictor.snaps; });
}

/** Summarise frames: fps, long frames, max per-frame displacement (metric), corrections. */
export async function qaSummary(page) {
  return page.evaluate(() => {
    const f = window.__qa.frames, c = window.__qa.corr;
    const C = 400000, H = 200000;
    const mx = (z) => Math.max(0.01, Math.cos((90 - z / H * 180) * Math.PI / 180));
    let maxStep = 0, sumDt = 0, long = 0, maxDt = 0, steps = [];
    for (let i = 1; i < f.length; i++) {
      let dx = f[i][1] - f[i - 1][1]; if (dx > C / 2) dx -= C; if (dx < -C / 2) dx += C;
      const d = Math.hypot(dx * mx(f[i][2]), f[i][2] - f[i - 1][2]);
      steps.push(d); maxStep = Math.max(maxStep, d); sumDt += f[i][0]; if (f[i][0] > 50) long++; maxDt = Math.max(maxDt, f[i][0]);
    }
    steps.sort((a, b) => a - b);
    const cs = [...c].sort((a, b) => a - b);
    return {
      frames: f.length, fps: f.length > 1 ? +(1000 * (f.length - 1) / sumDt).toFixed(1) : 0, longFrames: long, maxFrameMs: +maxDt.toFixed(1),
      medStep: +(steps[steps.length >> 1] || 0).toFixed(3), maxStep: +maxStep.toFixed(2),
      corrN: c.length, corrMed: +(cs[cs.length >> 1] || 0).toFixed(3), corrMax: +(cs[cs.length - 1] || 0).toFixed(2),
      corrOver5: c.filter(d => d > 5).length, snaps: window.__net.predictor.snaps - window.__qa.snaps0,
    };
  });
}

export async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
}

export async function teleport(page, x, z, r = 0) {
  await page.evaluate(([x, z, r]) => window.__net.send({ t: 'devtp', x, z, r }), [x, z, r]);
  await sleep(1500);
}

/** Turn in place until heading (compass deg, clockwise from north = -rotationY) is within tol. */
export async function faceHeading(page, deg, tol = 4) {
  for (let i = 0; i < 400; i++) {
    const s = await state(page);
    let h = ((-s.r * 180 / Math.PI) % 360 + 360) % 360;
    let diff = ((deg - h + 540) % 360) - 180; // + = need clockwise = rotationY decrease = right (D)
    if (Math.abs(diff) < tol) return h;
    const key = diff > 0 ? 'd' : 'a';
    await hold(page, [key], Math.min(300, Math.max(40, Math.abs(diff) * 6)));
    await sleep(150);
  }
}

export async function shot(page, name) {
  await page.screenshot({ path: `${QA}/${name}.jpg`, type: 'jpeg', quality: 55 });
}
