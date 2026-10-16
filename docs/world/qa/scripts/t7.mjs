import { launch, join, state, sleep, teleport, qaSummary, resetQa, faceHeading, xOf, zOf } from './lib.mjs';
const b = await launch();
const A = await join(b, 'QaPerf' + Date.now() % 10000, '?terrainStats=1');
const tl = [];
A.page.on('console', m => { if (/^\[terrain\]/.test(m.text())) tl.push(m.text()); });
const runs = [
  ['Lesser Antilles south along chain', xOf(-61.0), zOf(17.5), 180],
  ['Bahamas west->east', xOf(-79.0), zOf(25.5), 90],
  ['Aegean north', xOf(25.0), zOf(36.0), 0],
];
for (const [name, x, z, hdg] of runs) {
  await teleport(A.page, x, z, -hdg * Math.PI / 180);
  await sleep(5000);
  await resetQa(A.page); tl.length = 0;
  await A.page.evaluate(() => { window.__qa.t0 = performance.now(); });
  await A.page.keyboard.down('w');
  await sleep(20000);
  await A.page.keyboard.up('w');
  const sum = await qaSummary(A.page);
  const longs = await A.page.evaluate(() => { let t = 0; const o = []; for (const f of window.__qa.frames) { t += f[0]; if (f[0] > 40) o.push([Math.round(t), Math.round(f[0])]); } return o; });
  const s = await state(A.page);
  const maxBuild = Math.max(0, ...tl.map(l => +(l.match(/lastUpdateMs: ([\d.]+)/)?.[1] ?? 0)));
  const maxQueued = Math.max(0, ...tl.map(l => +(l.match(/queued: (\d+)/)?.[1] ?? 0)));
  console.log(name, JSON.stringify(sum), 'frames>40ms', JSON.stringify(longs.slice(0, 10)), 'terrain max lastUpdateMs', maxBuild, 'max queued', maxQueued, 'last', tl.slice(-1)[0], 'v', s.v.toFixed(2));
}
console.log('LOGS', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall/.test(l))));
await b.close();
