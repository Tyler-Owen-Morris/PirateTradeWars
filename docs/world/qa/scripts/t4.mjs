import { launch, join, state, shot, sleep, hold, faceHeading, teleport, lat, lon } from './lib.mjs';
const b = await launch();
const { page, logs } = await join(b, 'QaNav' + Date.now() % 10000);
const compass = () => page.evaluate(() => {
  const ll = document.querySelector('[data-testid="latlon"]');
  const line = ll?.parentElement?.textContent;
  const tgt = document.querySelector('[data-testid="open-world-map"]')?.parentElement?.textContent;
  return { line, tgt };
});
const ports = await page.evaluate(() => fetch('/api/ports').then(r => r.json()));
const pr = ports.find(p => /Port Royal/.test(p.name));
console.log('Port Royal', JSON.stringify(pr));
// Teleport to Port Royal spawn (open water), to test lat/lon
await teleport(page, pr.spawn.x, pr.spawn.z, 0);
await sleep(1500);
let s = await state(page);
console.log('at PR spawn', s.x.toFixed(0), s.z.toFixed(0), 'lat', lat(s.z).toFixed(3), 'lon', lon(s.x).toFixed(3), JSON.stringify(await compass()));
// heading checks: sail north
for (const hdg of [0, 90, 180, 270]) {
  await teleport(page, pr.spawn.x, pr.spawn.z, 0);
  await faceHeading(page, hdg, 2);
  const a = await state(page);
  const c = await compass();
  await hold(page, ['w'], 1500);
  await sleep(300);
  const bb = await state(page);
  let dx = bb.x - a.x; const dz = bb.z - a.z;
  console.log(`hdg ${hdg}: compass "${c.line}" | moved dx=${dx.toFixed(1)} dz=${dz.toFixed(1)} -> ${dz < 0 ? 'N' : 'S'}${dx > 0 ? 'E' : 'W'}`);
}
await teleport(page, pr.spawn.x, pr.spawn.z, 0);
await faceHeading(page, 0, 2);
await sleep(2500);
await shot(page, 't4-portroyal');
// world map
await page.keyboard.press('m');
await sleep(1500);
console.log('map open', await page.locator('[data-testid="world-map"]').count());
const geo = await page.evaluate(async () => {
  const nav = await import('/src/lib/nav.ts');
  const st = (await import('/src/lib/stores/useGameState.tsx')).useGameState.getState();
  const p = st.gameState.player; const w = innerWidth, h = innerHeight;
  const v = nav.clampView({ cx: p.x, cz: p.z, k: 0.004 }, h);
  const me = nav.mapWorldToScreen(v, w, h, p.x, p.z);
  const ports = st.gameState.ports.map(q => { const pt = nav.portPoint(q); const s = nav.mapWorldToScreen(v, w, h, pt.x, pt.z); return { id: q.id, name: q.name, sx: s.x, sy: s.y }; });
  const cv = document.querySelector('[data-testid="world-map"] canvas');
  const ctx = cv.getContext('2d');
  const px = ctx.getImageData(Math.round(me.x), Math.round(me.y), 1, 1).data;
  return { me, px: [...px], player: { x: p.x, z: p.z }, ports: ports.filter(q => q.sx > 0 && q.sx < w && q.sy > 0 && q.sy < h) };
});
console.log('map player marker', JSON.stringify(geo.me), 'pixel', geo.px, 'visible ports', geo.ports.map(p => p.name).join(','));
await shot(page, 't4-worldmap');
const hav = geo.ports.find(p => /Havana/.test(p.name)) ?? geo.ports[0];
await page.mouse.click(hav.sx, hav.sy);
await sleep(800);
await shot(page, 't4-worldmap-target');
await page.keyboard.press('Escape');
await sleep(800);
console.log('map after Esc', await page.locator('[data-testid="world-map"]').count());
const c2 = await compass();
const hp = ports.find(p => p.id === hav.id); s = await state(page);
const C = 400000, H = 200000; let dx = hp.dock.x - s.x; if (dx > C / 2) dx -= C; if (dx < -C / 2) dx += C;
const mx = Math.cos((90 - (hp.dock.z + s.z) / 2 / H * 180) * Math.PI / 180);
const d = Math.hypot(dx * mx, hp.dock.z - s.z);
console.log('target', JSON.stringify(c2.tgt), 'expected', hav.name, (d / 18.52).toFixed(1), 'nm', ((Math.atan2(dx * mx, -(hp.dock.z - s.z)) * 180 / Math.PI + 360) % 360).toFixed(0), 'deg');
// M toggles map, M again closes
await page.keyboard.press('m'); await sleep(500); const o1 = await page.locator('[data-testid="world-map"]').count();
await page.keyboard.press('m'); await sleep(500); const o2 = await page.locator('[data-testid="world-map"]').count();
console.log('M toggle open/closed', o1, o2);
console.log('LOGS', JSON.stringify(logs.filter(l => !/Stripe|GPU stall/.test(l)), null, 1));
await b.close();
