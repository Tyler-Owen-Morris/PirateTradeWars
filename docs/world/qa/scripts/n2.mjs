// NPC combat: merchant flee, pirate attack + break off.
import { launch, join, state, shot, sleep, qaSummary, resetQa } from './lib.mjs';
const mode = process.argv[2] ?? 'merchant';
const b = await launch();
const A = await join(b, 'QaFight' + Date.now() % 10000);
const P = A.page;
await P.evaluate(() => { window.__qa.ev = []; for (const k of ['fire', 'hit', 'sunk']) window.__net.on(k, (m, me) => window.__qa.ev.push({ k, m, me, t: performance.now() })); window.__net.on('self', (me) => { window.__qa.me = me; }); });
const ports = await P.evaluate(() => fetch('/api/ports').then(r => r.json()));
const lanes = JSON.parse((await import('fs')).readFileSync('C:/Users/theow/Documents/GitHub Projects/PirateTradeWars/.claude/worktrees/agent-a36d07bc9afd46740/shared/world/lanes.json', 'utf8'));
const tp = (x, z, r = 0) => P.evaluate(([x, z, r]) => window.__net.send({ t: 'devtp', x, z, r }), [x, z, r]);
const survey = () => P.evaluate(() => {
  const net = window.__net, me = net.predictor.cur, land = net.predictor.land, rt = net.remoteRenderTime();
  const out = [];
  for (const e of net.remote.renderable()) {
    const p = net.remote.sample(e.eid, rt); if (!p || !e.meta?.npc) continue;
    let dx = p.x - me.x; if (dx > 2e5) dx -= 4e5; if (dx < -2e5) dx += 4e5;
    out.push({ eid: e.eid, title: e.meta.title, faction: e.meta.faction, ship: e.meta.shipType, hp: e.hp, maxHp: e.meta.maxHp, d: Math.hypot(dx * Math.cos((90 - me.z / 2e5 * 180) * Math.PI / 180), p.z - me.z), x: p.x, z: p.z, r: p.rotationY ?? p.r, v: p.velocity ?? p.v, land: land.distance(p.x, p.z) });
  }
  return out.sort((a, b) => a.d - b.d);
});
const want = mode === 'merchant' ? (e) => /Merchant/i.test(e.title) && e.ship === 'sloop' : (e) => e.faction === 'pirates' && e.hp === e.maxHp;
const farFromPorts = (x, z) => ports.every(p => Math.hypot((p.dock.x - x) * 0.95, p.dock.z - z) > 1500);
// scan points along Caribbean lanes
const pts = [];
for (const l of lanes) for (let i = 0; i < l.points.length; i += 3) { const [x, z] = l.points[i]; const xx = ((x % 4e5) + 4e5) % 4e5; if (z > 60000 && z < 90000 && xx > 100000 && xx < 140000 && farFromPorts(xx, z)) pts.push([xx, z]); }
console.log('scan points', pts.length);
let target = null;
for (let i = 0; i < pts.length && !target; i += Math.max(1, Math.floor(pts.length / 25))) {
  await tp(pts[i][0], pts[i][1]); await sleep(6000);
  const s = await survey();
  const c = s.find(e => want(e) && e.d < 2500 && e.land > 100 && farFromPorts(e.x, e.z) && !s.some(o => /Navy|Privateer/.test(o.title) && Math.hypot((o.x - e.x) * 0.95, o.z - e.z) < 2500));
  console.log('pt', i, 'npcs', s.length, s.slice(0, 4).map(e => `${e.title}/${e.ship}@${Math.round(e.d)}`).join(', '));
  if (c) target = c;
}
if (!target) { console.log('no target found'); await b.close(); process.exit(0); }
console.log('TARGET', JSON.stringify(target));
const eid = target.eid;
const get = async () => (await survey()).find(e => e.eid === eid);
// place abeam: aim starboard at predicted position
async function strike(dist = 90) {
  const t = await get(); if (!t) return null;
  const mx = Math.cos((90 - t.z / 2e5 * 180) * Math.PI / 180);
  const ux = Math.cos(t.r), uz = -Math.sin(t.r);
  const myx = t.x - ux * dist / mx, myz = t.z - uz * dist;
  const fast = Math.abs(t.v) > 2;
  if (fast) await P.keyboard.down('w');
  await P.evaluate(([x, z, r, v]) => window.__net.send({ t: 'devtp', x, z, r, v }), [myx, myz, t.r, t.v]);
  await sleep(300);
  await P.keyboard.down(' '); await sleep(200); await P.keyboard.up(' ');
  await sleep(700);
  if (fast) await P.keyboard.up('w');
  return t;
}
const hitsOn = () => P.evaluate((eid) => window.__qa.ev.filter(e => e.k === 'hit' && e.m.target === eid).length, eid);
if (mode === 'merchant') {
  for (let k = 0; k < 8 && (await hitsOn()) === 0; k++) { await strike(); await sleep(2300); }
  console.log('hits on merchant', await hitsOn());
  // stay put, watch it
  const me = await state(P); const track = [];
  for (let i = 0; i < 50; i++) { const t = await get(); if (t) { const mx = 0.95; let dx = t.x - me.x; const dz = t.z - me.z; const away = (Math.sin(t.r) * t.v * dx * mx + Math.cos(t.r) * t.v * dz) / (Math.hypot(dx * mx, dz) * Math.abs(t.v) + 1e-9); track.push([Math.round(t.d), +t.v.toFixed(2), +away.toFixed(2), t.hp, Math.round(t.land), +t.r.toFixed(2)]); } else track.push('gone'); await sleep(500); }
  console.log('merchant after hit [dist, v, cos(motion, away-from-me)]', JSON.stringify(track));
  await shot(P, 'n2-merchant-flee');
} else {
  const firesBy = () => P.evaluate((eid) => window.__qa.ev.filter(e => e.k === 'fire' && e.m.eid === eid).length, eid);
  const hitsMe = () => P.evaluate(() => window.__qa.ev.filter(e => e.k === 'hit' && e.me).length);
  const watch = async (label, n) => {
    const s0 = await state(P); const tr = [];
    for (let i = 0; i < n; i++) { const t = await get(); if (!t) { tr.push('gone'); break; } let dx = t.x - s0.x, dz = t.z - s0.z; const away = (Math.sin(t.r) * t.v * dx * 0.95 + Math.cos(t.r) * t.v * dz) / (Math.hypot(dx * 0.95, dz) * Math.abs(t.v) + 1e-9); tr.push([Math.round(t.d), t.hp, +t.v.toFixed(1), +away.toFixed(2), await firesBy(), await hitsMe()]); await sleep(1000); }
    console.log(label, '[dist, hp, v, cos(away), firesByPirate, hitsOnMe]', JSON.stringify(tr));
  };
  for (let k = 0; k < 12 && (await hitsOn()) === 0; k++) { await strike(); await sleep(1800); }
  console.log('provoke hits', await hitsOn());
  await watch('after provoke (I stay still)', 30);
  for (let k = 0; k < 25; k++) { const t = await get(); if (!t || t.hp / t.maxHp < 0.4) break; await strike(); await sleep(1800); }
  const t = await get(); console.log('pirate hp now', t?.hp, '/', t?.maxHp, 'my hp', await P.evaluate(() => window.__qa.me?.hp));
  await watch('after hurting it', 15);
  await shot(P, 'n2-pirate');
}
console.log('perf', JSON.stringify(await qaSummary(P)));
console.log('LOGS', JSON.stringify(A.logs.filter(l => !/Stripe|GPU stall/.test(l))));
await b.close();
