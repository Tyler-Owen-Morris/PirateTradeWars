import { launch, join, state, qaSummary, resetQa, shot, sleep, lat, lon } from './lib.mjs';
const b = await launch();
const { page, logs } = await join(b, 'QaJoin' + Date.now() % 10000, '?terrainStats=1');
await sleep(6000);
const s = await state(page);
console.log('spawn', s, 'lat', lat(s.z).toFixed(3), 'lon', lon(s.x).toFixed(3), 'heading', (((-s.r * 180 / Math.PI) % 360) + 360) % 360);
const info = await page.evaluate(async () => {
  const land = window.__net.land;
  const p = window.__net.predictor.cur;
  const f = window.__net.predictor.land;
  const d0 = f.distance(p.x, p.z);
  // distance ahead along heading 300 units
  const fx = p.x + Math.sin(p.rotationY) * -300 / Math.cos((90 - p.z / 200000 * 180) * Math.PI / 180);
  const fz = p.z + Math.cos(p.rotationY) * -300;
  const ahead = f.distance(fx, fz);
  return { d0, ahead, ready: f.ready(p.x, p.z, 500) };
});
console.log('land', info);
console.log('HUD', JSON.stringify(await page.evaluate(() => document.body.innerText)));
await resetQa(page);
await sleep(5000);
console.log('idle summary', await qaSummary(page));
await shot(page, 't1-spawn');
console.log('LOGS', JSON.stringify(logs, null, 1));
await b.close();
