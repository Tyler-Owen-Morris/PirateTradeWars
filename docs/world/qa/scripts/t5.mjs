import { launch, join, state, shot, sleep, hold, faceHeading, teleport, qaSummary, resetQa, lat, lon, xOf, zOf } from './lib.mjs';
const b = await launch();
const A = await join(b, 'QaSeamA' + Date.now() % 10000);
const B = await join(b, 'QaSeamB' + Date.now() % 10000);
const zEq = zOf(0.5);
const dist = (page) => page.evaluate(() => { const p = window.__net.predictor.cur; return window.__net.predictor.land.distance(p.x, p.z); });
// B parked just east of the seam, A west of it
await teleport(B.page, 700, zEq - 60, 0);
await teleport(A.page, 399000, zEq, -Math.PI / 2); // heading 90 = east
await sleep(3000);
console.log('A', await state(A.page), 'land d', await dist(A.page), 'B', await state(B.page), 'land d', await dist(B.page));
await A.page.evaluate(async () => {
  const rs = await import('/src/lib/world/renderSpace.ts');
  const net = window.__net;
  window.__seam = [];
  const loop = () => {
    const f = rs.renderFocus;
    const rt = net.remoteRenderTime();
    const others = [];
    for (const e of net.remote.renderable()) {
      const p = net.remote.sample(e.eid, rt); if (!p) continue;
      const r = rs.toRender(p.x, p.z); others.push([e.eid, +r.x.toFixed(2), +r.z.toFixed(2)]);
    }
    window.__seam.push({ t: performance.now(), fx: f.x, sx: f.shiftX, sz: f.shiftZ, tx: f.travelX, o: others });
    if (window.__seamOn) requestAnimationFrame(loop);
  };
  window.__seamOn = true; requestAnimationFrame(loop);
});
await resetQa(A.page);
await A.page.keyboard.down('w');
const shots = [];
for (let i = 0; i < 16; i++) {
  await sleep(500);
  const s = await state(A.page);
  if (s.x > 399700 && !shots.includes('pre')) { shots.push('pre'); await shot(A.page, 't5-seam-before'); }
  if (s.x < 400 && s.x > 0 && !shots.includes('post')) { shots.push('post'); await shot(A.page, 't5-seam-after'); }
}
await A.page.keyboard.up('w');
await sleep(500);
const sum = await qaSummary(A.page);
const seam = await A.page.evaluate(() => { window.__seamOn = false; return window.__seam; });
// analyse
let maxShift = 0, crossIdx = -1, maxOtherJump = 0, otherSeen = 0;
for (let i = 1; i < seam.length; i++) {
  const s = seam[i];
  maxShift = Math.max(maxShift, Math.hypot(s.sx, s.sz));
  if (seam[i - 1].fx > 390000 && s.fx < 10000) crossIdx = i;
  for (const o of s.o) {
    const prev = seam[i - 1].o.find(q => q[0] === o[0]); if (!prev) continue; otherSeen++;
    // other ship's render pos should move by ~ -(own shift) + its own motion (it is parked)
    const j = Math.hypot(o[1] - prev[1] + s.sx, o[2] - prev[2] + s.sz);
    maxOtherJump = Math.max(maxOtherJump, j);
  }
}
console.log('A summary', JSON.stringify(sum));
console.log('frames', seam.length, 'crossed at frame', crossIdx, crossIdx > 0 ? JSON.stringify(seam.slice(crossIdx - 2, crossIdx + 2).map(s => ({ fx: +s.fx.toFixed(1), sx: +s.sx.toFixed(2), tx: +s.tx.toFixed(1), o: s.o }))) : '');
console.log('max focus shift/frame', maxShift.toFixed(2), 'other-ship frames', otherSeen, 'max other ship residual jump/frame', maxOtherJump.toFixed(2));
const endA = await state(A.page);
console.log('A end', endA.x.toFixed(1), endA.z.toFixed(1), 'lon', lon(endA.x).toFixed(3));
console.log('B sees A?', await B.page.evaluate(() => [...window.__net.remote.entities.values()].map(e => e.meta?.name ?? e.name ?? e.eid)));
// ---------- ICE ----------
const xI = xOf(5), zI = zOf(69.3);
await teleport(A.page, xI, zI, 0);
await sleep(2500);
console.log('ice start', await state(A.page), 'd', await dist(A.page), 'lat', lat((await state(A.page)).z).toFixed(3));
await shot(A.page, 't5-ice-approach');
await resetQa(A.page);
await hold(A.page, ['w'], 9000);
let si = await state(A.page);
console.log('ice after north', 'z', si.z.toFixed(1), 'Z_ICE_N', (200000 * 20 / 180).toFixed(1), 'lat', lat(si.z).toFixed(4), 'v', si.v.toFixed(2), 'd', (await dist(A.page)).toFixed(1), JSON.stringify(await qaSummary(A.page)));
await shot(A.page, 't5-ice-wall');
// slide: heading 45 (NE)
await faceHeading(A.page, 45);
const x0 = (await state(A.page)).x;
await resetQa(A.page);
await hold(A.page, ['w'], 6000);
si = await state(A.page);
console.log('ice slide NE 6s: dx metric', ((si.x - x0) * Math.cos(70 * Math.PI / 180)).toFixed(1), 'z', si.z.toFixed(1), 'v', si.v.toFixed(2), JSON.stringify(await qaSummary(A.page)));
const hp = await A.page.evaluate(() => document.body.innerText.match(/Hull Integrity\n(\d+) \/ (\d+)/)?.slice(1));
console.log('hp', hp);
console.log('LOGS A', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall/.test(l))), 'B', JSON.stringify(B.logs.filter(l => !/Stripe|GPU stall/.test(l))));
await b.close();
