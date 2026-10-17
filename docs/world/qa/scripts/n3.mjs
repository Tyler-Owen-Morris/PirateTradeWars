// F1 controlled B2 browser check: spawn a pirate next to me in open ocean (QA-only devnpc hook),
// provoke it (strike until hit), then (still|straight|circle) for FIGHT_S s; then set its hp to 30 %
// (QA-only devhp hook) and watch it break off.
//   Usage: [LON=-25 LAT=-20 FIGHT_S=30] node n3.mjs <still|straight|circle> [sloop|brigantine]
// Needs the server hooks in devtp.patch (devtp, devnpc, devhp; PTW_DEV_TELEPORT=1) and lib.mjs's
// BASE/require paths pointed at your server and worktree. Use a fresh LON/LAT per run: earlier
// pirates stay near their spawn, and keep the spot in open water (e.g. -30..-15 lon, -30..-10 lat).
import { launch, join, sleep, xOf, zOf, qaSummary, shot } from './lib.mjs';
const mode = process.argv[2] ?? 'still';
const ship = process.argv[3] ?? 'sloop';
const b = await launch();
const A = await join(b, 'F1' + mode.slice(0, 2) + (Date.now() % 1000));
const P = A.page;
await P.evaluate(() => { window.__qa.ev = []; for (const k of ['fire', 'hit', 'sunk']) window.__net.on(k, (m, me) => window.__qa.ev.push({ k, m, me, t: performance.now() })); window.__net.on('self', (me) => { window.__qa.me = me; }); });
const EAST = -Math.PI / 2;
// open South Atlantic, far from lanes and land
const X = xOf(+(process.env.LON || -25)), Z = zOf(+(process.env.LAT || -20));
await P.evaluate(([x, z, r]) => window.__net.send({ t: 'devtp', x, z, r, v: 0 }), [X, Z, EAST]);
await sleep(4000);
const me0 = await P.evaluate(() => ({ x: window.__net.predictor.cur.x, z: window.__net.predictor.cur.z, land: window.__net.predictor.land.distance(window.__net.predictor.cur.x, window.__net.predictor.cur.z) }));
console.log('me', JSON.stringify(me0));
await P.evaluate(([x, z, s]) => window.__net.send({ t: 'devnpc', a: 'pirate', x, z, ship: s, r: -Math.PI / 2 }), [me0.x, me0.z + 50, ship]);
await sleep(150);
await P.keyboard.down(' '); await sleep(120); await P.keyboard.up(' ');
await sleep(1200);
const survey = () => P.evaluate(() => {
  const net = window.__net, me = net.predictor.cur, rt = net.remoteRenderTime(); const out = [];
  for (const e of net.remote.renderable()) { const p = net.remote.sample(e.eid, rt); if (!p || !e.meta?.npc) continue;
    let dx = p.x - me.x; out.push({ eid: e.eid, title: e.meta.title, hp: e.hp, maxHp: e.meta.maxHp, d: Math.hypot(dx * Math.cos((90 - me.z / 2e5 * 180) * Math.PI / 180), p.z - me.z), x: p.x, z: p.z, r: p.rotationY ?? p.r, v: p.velocity ?? p.v }); }
  return out.sort((a, b) => a.d - b.d); });
const s0 = await survey();
console.log('npcs near', JSON.stringify(s0.slice(0, 3).map(e => [e.eid, e.title, Math.round(e.d)])));
const tgt = s0.find(e => /Pirate/.test(e.title));
if (!tgt) { console.log('no pirate'); await b.close(); process.exit(1); }
const eid = tgt.eid;
// provoke: put it on my starboard beam 30 units away (extrapolated 0.25 s) and fire, until it is hit
for (let k = 0; k < 8 && (await P.evaluate((eid) => window.__qa.ev.filter(e => e.k === 'hit' && e.m.target === eid).length, eid)) === 0; k++) {
  const t = (await survey()).find(e => e.eid === eid); if (!t) break;
  const mx = Math.cos((90 - t.z / 2e5 * 180) * Math.PI / 180);
  const fx = t.x + (-Math.sin(t.r)) * (-t.v) * 60 * 0.25 / mx, fz = t.z + (-Math.cos(t.r)) * (-t.v) * 60 * 0.25;
  const ux = Math.cos(t.r), uz = -Math.sin(t.r);
  await P.evaluate(([x, z, r]) => window.__net.send({ t: 'devtp', x, z, r, v: 0 }), [fx - ux * 30 / mx, fz - uz * 30, t.r]);
  await sleep(100);
  await P.keyboard.down(' '); await sleep(120); await P.keyboard.up(' ');
  await sleep(2100);
}

await sleep(800);
const cnt = () => P.evaluate((eid) => ({ fires: window.__qa.ev.filter(e => e.k === 'fire' && e.m.eid === eid).length, hitsMe: window.__qa.ev.filter(e => e.k === 'hit' && e.me).length, hitsIt: window.__qa.ev.filter(e => e.k === 'hit' && e.m.target === eid).length, myHp: window.__qa.me?.hp }), eid);
console.log('after provoke', JSON.stringify(await cnt()), JSON.stringify(await P.evaluate(() => ({ r: window.__net.predictor.cur.rotationY, myFires: window.__qa.ev.filter(e => e.k === 'fire' && e.me).length, firesAll: window.__qa.ev.filter(e => e.k === 'fire').map(e => e.m.eid) }))));
if (mode !== 'still') await P.keyboard.down('w');
if (mode === 'circle') await P.keyboard.down('a');
const tr = [];
const FIGHT_S = +(process.env.FIGHT_S || 30);
for (let i = 0; i < FIGHT_S; i++) { const t = (await survey()).find(e => e.eid === eid); const c = await cnt(); tr.push([i, t ? Math.round(t.d) : 'gone', t?.hp, c.fires, c.hitsMe, c.myHp]); await sleep(1000); }
if (mode !== 'still') await P.keyboard.up('w');
if (mode === 'circle') await P.keyboard.up('a');
console.log(`${mode} 30 s [s, dist, pirateHp, piratesFires, hitsOnMe, myHp]`, JSON.stringify(tr));
await shot(P, `n3-${mode}-${ship}`);
// hurt it to 30 % (QA-only devhp hook; the pirate's courage 0.5 → breaks off at ≤ 35 %)
const t0h = (await survey()).find(e => e.eid === eid);
if (t0h) await P.evaluate(([eid, hp]) => window.__net.send({ t: 'devhp', eid, hp }), [eid, Math.floor(t0h.maxHp * 0.3)]);
await sleep(300);
const th = (await survey()).find(e => e.eid === eid);
console.log('pirate hp now', th?.hp, '/', th?.maxHp, 'my hp', (await cnt()).myHp);
const meS = await P.evaluate(() => ({ x: window.__net.predictor.cur.x, z: window.__net.predictor.cur.z }));
const fl = [];
for (let i = 0; i < 12; i++) { const t = (await survey()).find(e => e.eid === eid); if (!t) { fl.push('gone'); break; }
  const dx = (t.x - meS.x) * 0.94, dz = t.z - meS.z; const away = (-Math.sin(t.r) * -t.v * dx + -Math.cos(t.r) * -t.v * dz) / (Math.hypot(dx, dz) * Math.abs(t.v) + 1e-9);
  fl.push([i, Math.round(t.d), t.hp, +t.v.toFixed(1), +away.toFixed(2)]); await sleep(1000); }
console.log('after hurting it [s, dist, hp, v, cos(motion, away-from-me)]', JSON.stringify(fl));
console.log('perf', JSON.stringify(await qaSummary(P)));
console.log('LOGS', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall|ReadPixels/.test(l))));
await b.close();





