// Open-sea sail: correlate corrections/snaps with frame times and tile loading.
import { launch, join, state, qaSummary, resetQa, sleep, faceHeading } from './lib.mjs';
const hdg = +(process.argv[2] ?? 0);
const ms = +(process.argv[3] ?? 25000);
const b = await launch();
const { page, logs } = await join(b, 'QaSea' + Date.now() % 10000, '?terrainStats=1');
const tlogs = [];
page.on('console', m => { if (/terrain|land/i.test(m.text())) tlogs.push(m.text().slice(0, 200)); });
await sleep(3000);
await page.evaluate(() => {
  const qa = window.__qa; qa.tl = [];
  const p = window.__net.predictor; const orig = p.reconcile.bind(p);
  // replace the wrapper with a timestamped one
  p.reconcile = (me, ack) => { const pend = p.pending.length; const d = orig(me, ack); qa.corr.push(d); if (d > 5) qa.tl.push({ t: Math.round(performance.now()), d: +d.toFixed(1), pend, ack, seq: p.seq }); return d; };
});
await faceHeading(page, hdg);
await resetQa(page);
await page.evaluate(() => { window.__qa.t0 = performance.now(); window.__qa.tl = []; });
await page.keyboard.down('w');
await sleep(ms);
await page.keyboard.up('w');
const sum = await qaSummary(page);
const tl = await page.evaluate(() => {
  const qa = window.__qa; const f = qa.frames; let t = 0; const longF = [];
  for (const fr of f) { t += fr[0]; if (fr[0] > 150) longF.push([Math.round(t), Math.round(fr[0])]); }
  return { tl: qa.tl.map(e => ({ ...e, t: Math.round(e.t - qa.t0) })), longF };
});
console.log('summary', JSON.stringify(sum));
console.log('corrections>5', JSON.stringify(tl.tl.slice(0, 40)));
console.log('frames>150ms (t,dt)', JSON.stringify(tl.longF.slice(0, 40)));
console.log('terrain logs', JSON.stringify(tlogs.slice(-6), null, 1));
console.log('end state', await state(page));
await b.close();
