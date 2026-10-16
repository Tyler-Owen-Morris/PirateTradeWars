// NPC survey: who is around, nameplates, stuck check, fps.
import { launch, join, state, shot, sleep, teleport, qaSummary, resetQa } from './lib.mjs';
const b = await launch();
const A = await join(b, 'QaNpc' + Date.now() % 10000);
await A.page.evaluate(() => { window.__qa.ev = []; for (const k of ['fire', 'hit', 'sunk']) window.__net.on(k, (m, me) => window.__qa.ev.push({ k, m, me, t: performance.now() })); });
await sleep(12000);
const survey = () => A.page.evaluate(() => {
  const net = window.__net, me = net.predictor.cur, land = net.predictor.land, rt = net.remoteRenderTime();
  const out = [];
  for (const e of net.remote.renderable()) {
    const p = net.remote.sample(e.eid, rt); if (!p) continue;
    let dx = p.x - me.x; if (dx > 2e5) dx -= 4e5; if (dx < -2e5) dx += 4e5;
    out.push({ eid: e.eid, npc: !!e.meta?.npc, name: e.meta?.name, title: e.meta?.title, faction: e.meta?.faction, ship: e.meta?.shipType, hp: e.hp, d: Math.round(Math.hypot(dx * 0.95, p.z - me.z)), land: Math.round(land.distance(p.x, p.z)), x: p.x, z: p.z, v: p.velocity ?? p.v });
  }
  return out.sort((a, b) => a.d - b.d);
});
let s = await survey();
console.log('first entity keys', JSON.stringify(await A.page.evaluate(() => { const e = [...window.__net.remote.entities.values()][0]; return e ? Object.keys(e).concat(Object.keys(e.meta || {})) : null; })));
console.log('visible', s.length, 'npc', s.filter(e => e.npc).length);
console.log(JSON.stringify(s.slice(0, 12).map(({ x, z, ...r }) => r)));
await shot(A.page, 'n1-npcs-spawn');
// stuck + fps: sample every 500 ms for 40 s
await resetQa(A.page);
const track = {};
for (let i = 0; i < 80; i++) {
  for (const e of await survey()) if (e.npc) (track[e.eid] ??= []).push([e.x, e.z, e.land, e.title + '/' + e.ship]);
  await sleep(500);
}
const perf = await qaSummary(A.page);
let stuckList = [];
for (const [eid, arr] of Object.entries(track)) {
  if (arr.length < 20) continue;
  // windows of 10 samples (5 s): net displacement < 20 while near land (< 40)
  let worst = 0, run = 0;
  for (let i = 10; i < arr.length; i++) {
    const a = arr[i - 10], c = arr[i]; let dx = c[0] - a[0]; if (dx > 2e5) dx -= 4e5; if (dx < -2e5) dx += 4e5;
    const disp = Math.hypot(dx * 0.95, c[1] - a[1]);
    if (disp < 20 && c[2] < 60) { run++; worst = Math.max(worst, run); } else run = 0;
  }
  if (worst > 0) stuckList.push({ eid, who: arr[0][3], stuckSamplesInRow: worst, minLand: Math.min(...arr.map(q => q[2])) });
}
const minLandAll = Math.min(...Object.values(track).flat().map(q => q[2]));
console.log('tracked npcs', Object.keys(track).length, 'min land distance seen', minLandAll, 'stuck (5s no progress within 60 of land)', JSON.stringify(stuckList));
console.log('perf with npcs (40 s idle at spawn)', JSON.stringify(perf), 'npcs in view now', (await survey()).filter(e => e.npc && e.d < 2500).length);
const ev = await A.page.evaluate(() => window.__qa.ev.map(e => ({ k: e.k, me: e.me, m: JSON.stringify(e.m).slice(0, 120) })));
console.log('events', ev.length, JSON.stringify(ev.slice(0, 8)));
await shot(A.page, 'n1-npcs-later');
console.log('LOGS', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall/.test(l))));
await b.close();
