import { launch, join, state, shot, sleep, hold, teleport, qaSummary, resetQa, xOf, zOf } from './lib.mjs';
const b = await launch();
const A = await join(b, 'QaTwoA' + Date.now() % 10000, '?terrainStats=1');
const B = await join(b, 'QaTwoB' + Date.now() % 10000);
const tl = [];
A.page.on('console', m => { if (/^\[terrain\]/.test(m.text())) tl.push(m.text()); });
const ports = await A.page.evaluate(() => fetch('/api/ports').then(r => r.json()));
const pr = ports.find(p => /Port Royal/.test(p.name));
await teleport(A.page, pr.spawn.x + 40, pr.spawn.z + 60, Math.PI); // facing south (seaward)
await teleport(B.page, pr.spawn.x - 40, pr.spawn.z + 60, Math.PI);
await sleep(3000);
const eidA = await A.page.evaluate(() => window.__net.lastMe?.eid ?? null);
// B watches every remote: record render samples per frame
await B.page.evaluate(() => {
  const net = window.__net; window.__obs = []; window.__obsOn = true;
  const loop = (t) => {
    const rt = net.remoteRenderTime(); const row = { t, e: {} };
    for (const e of net.remote.renderable()) { const p = net.remote.sample(e.eid, rt); if (p) row.e[e.eid] = [p.x, p.z, p.rotationY ?? p.r, e.meta?.name ?? e.name]; }
    window.__obs.push(row); if (window.__obsOn) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await resetQa(A.page); await resetQa(B.page);
// A sails a circle: W + A for 12 s
await A.page.keyboard.down('w'); await A.page.keyboard.down('a');
await sleep(12000);
await A.page.keyboard.up('a'); await sleep(4000); await A.page.keyboard.up('w');
await sleep(1000);
const sumA = await qaSummary(A.page), sumB = await qaSummary(B.page);
const obs = await B.page.evaluate(() => { window.__obsOn = false; return window.__obs; });
// find A in B's view by name
const nameA = (await A.page.evaluate(() => document.querySelector('[data-testid="cypress-player-name"]').textContent));
let key = null; for (const r of obs) for (const [k, v] of Object.entries(r.e)) if (v[3] && nameA.startsWith(v[3].slice(0, 6))) key = k;
const C = 400000;
const steps = []; let reversals = 0, prevDir = null, nVisible = 0;
for (let i = 1; i < obs.length; i++) {
  const a = obs[i - 1].e[key], c = obs[i].e[key]; if (!a || !c) continue; nVisible++;
  let dx = c[0] - a[0]; if (dx > C / 2) dx -= C; if (dx < -C / 2) dx += C; const dz = c[1] - a[1];
  const d = Math.hypot(dx * 0.95, dz); const dt = obs[i].t - obs[i - 1].t;
  steps.push(d / dt * 1000);
  if (d > 0.5) { const dir = Math.atan2(dx, dz); if (prevDir !== null) { let dd = Math.abs(dir - prevDir); if (dd > Math.PI) dd = 2 * Math.PI - dd; if (dd > Math.PI / 2) reversals++; } prevDir = dir; }
}
const s2 = [...steps].sort((a, b) => a - b);
const pct = (p) => s2[Math.floor(p * (s2.length - 1))]?.toFixed(1);
console.log('B sees A key', key, 'frames visible', nVisible, 'of', obs.length, 'speed u/s p5/p50/p95/max', pct(0.05), pct(0.5), pct(0.95), pct(1), 'reversals', reversals);
console.log('remote ships in B view (last frame)', Object.keys(obs[obs.length - 1].e).length);
console.log('A', JSON.stringify(sumA)); console.log('B', JSON.stringify(sumB));
await shot(B.page, 't6-two-clients');
// Perf: A near busy coast vs open sea
await teleport(A.page, pr.spawn.x, pr.spawn.z, 0);
await sleep(4000); await resetQa(A.page); tl.length = 0;
await hold(A.page, ['d'], 3000); await sleep(7000);
const coast = await qaSummary(A.page);
const nRemote = await A.page.evaluate(() => window.__net.remote.renderable().length);
console.log('PERF coast (Port Royal, remote ships', nRemote, ')', JSON.stringify(coast), 'terrain', tl.slice(-1)[0]);
await teleport(A.page, xOf(-40), zOf(30), 0);
await sleep(5000); await resetQa(A.page); tl.length = 0;
await hold(A.page, ['d'], 3000); await sleep(7000);
const sea = await qaSummary(A.page);
console.log('PERF open sea', JSON.stringify(sea), 'terrain', tl.slice(-1)[0]);
// sailing along a busy coast: Cuba north coast near Havana heading west
const hv = ports.find(p => /Havana/.test(p.name));
await teleport(A.page, hv.spawn.x, hv.spawn.z, Math.PI / 2); // heading 270 = west
await sleep(4000); await resetQa(A.page); tl.length = 0;
await hold(A.page, ['w'], 12000);
const sail = await qaSummary(A.page);
console.log('PERF sailing Cuba coast west 12s', JSON.stringify(sail), 'terrain', JSON.stringify(tl.slice(-3)));
console.log('LOGS A', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall/.test(l))), 'B', JSON.stringify(B.logs.filter(l => !/Stripe|GPU stall/.test(l))));
await b.close();
