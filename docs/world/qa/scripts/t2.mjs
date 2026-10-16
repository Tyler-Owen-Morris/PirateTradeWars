import { launch, join, state, qaSummary, resetQa, shot, sleep, hold, faceHeading, lat, lon } from './lib.mjs';
const b = await launch();
const { page, logs } = await join(b, 'QaCoast' + Date.now() % 10000);
await page.evaluate(() => {
  window.__qa.splash = []; window.__qa.fire = 0;
  window.__net.on('self', (me) => { window.__qa.me = me; });
  window.__net.on('splash', (m) => window.__qa.splash.push(m));
  window.__net.on('fire', (m, mine) => { if (mine) window.__qa.fire++; });
});
await sleep(3000);
const coast = () => page.evaluate(() => {
  const f = window.__net.predictor.land, p = window.__net.predictor.cur;
  const n = f.normal(p.x, p.z);
  return { d: f.distance(p.x, p.z), nx: n.nx, nz: n.nz, hdgToCoast: ((Math.atan2(-n.nx, n.nz) * 180 / Math.PI) + 360) % 360, hp: window.__qa.me?.hp };
});
async function sail(label, ms) {
  await resetQa(page);
  const samples = [];
  await page.keyboard.down('w');
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page); const c = await coast();
    samples.push({ t: Date.now() - t0, d: +c.d.toFixed(1), v: +s.v.toFixed(2), hdg: +((((-s.r * 180 / Math.PI) % 360) + 360) % 360).toFixed(1), hp: c.hp });
    await sleep(500);
  }
  await page.keyboard.up('w');
  const sum = await qaSummary(page);
  console.log(label, JSON.stringify(sum));
  console.log(label, 'samples', JSON.stringify(samples.filter((_, i) => i % 3 === 0)));
  return { sum, samples };
}
let c = await coast();
console.log('start', c);
// head-on
await faceHeading(page, c.hdgToCoast);
await sail('headon', 22000);
await shot(page, 't2-headon');
c = await coast();
console.log('after headon', c);
// back off
await faceHeading(page, (c.hdgToCoast + 180) % 360);
await hold(page, ['w'], 1200);
await sleep(2000);
c = await coast();
// glancing: 35 deg off the coast direction
await faceHeading(page, (c.hdgToCoast + 50) % 360);
await sail('glancing', 12000);
await shot(page, 't2-glancing');
c = await coast();
console.log('after glancing', c);
// cannons at land: put coast on starboard (heading = coastDir - 90)
await faceHeading(page, (c.hdgToCoast + 270) % 360);
c = await coast();
console.log('fire setup', c);
await resetQa(page);
for (let i = 0; i < 4; i++) { await hold(page, [' '], 200); await sleep(2600); }
await sleep(1500);
const fr = await page.evaluate(() => ({ fire: window.__qa.fire, splash: window.__qa.splash.slice(0, 5), nSplash: window.__qa.splash.length, ballsLeft: window.__net.balls.balls?.size ?? window.__net.balls.count?.() ?? JSON.stringify(Object.keys(window.__net.balls)) }));
console.log('fire', JSON.stringify(fr));
await shot(page, 't2-fire');
console.log('final hp', (await coast()).hp);
console.log('LOGS', JSON.stringify(logs.filter(l => !/Stripe|GPU stall/.test(l)), null, 1));
await b.close();
