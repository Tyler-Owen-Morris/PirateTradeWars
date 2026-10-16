// Phase 1 (arg "save"): join, buy, sail, save storage. Phase 2 (arg "load"): open with storage, check restore.
import { launch, join, state, sleep, hold, installHooks, BASE, shot } from './lib.mjs';
import fs from 'fs';
const SS = 'C:/Users/theow/AppData/Local/Temp/claude/C--Users-theow-Documents-GitHub-Projects-PirateTradeWars/80d3fe3b-e705-4627-b00e-93bc68260f5a/scratchpad/ss.json';
const b = await launch();
if (process.argv[2] === 'save') {
  const A = await join(b, 'QaRs' + Date.now() % 10000);
  await sleep(1500);
  const ports = await A.page.evaluate(() => fetch('/api/ports').then(r => r.json()));
  const s0 = await state(A.page);
  let near = null, nd = 1e9; for (const p of ports) { const d = Math.hypot((p.dock.x - s0.x) * 0.95, p.dock.z - s0.z); if (d < nd) { nd = d; near = p; } }
  await A.page.evaluate((id) => window.__net.send({ type: 'trade', portId: id, action: 'buy', goodId: 1, quantity: 2 }), near.id);
  await hold(A.page, ['w'], 2500); await sleep(5000);
  const s = await state(A.page);
  const hud = await A.page.evaluate(() => document.body.innerText.match(/Cargo\n[^\n]+\n[^\n]+\ngold/)?.[0]);
  await A.ctx.storageState({ path: SS });
  fs.writeFileSync(SS + '.pos', JSON.stringify({ x: s.x, z: s.z, r: s.r, hud }));
  console.log('saved', JSON.stringify({ x: s.x, z: s.z, r: s.r, hud }));
  // wait for a Redis save cycle
  await sleep(6000);
} else {
  const prev = JSON.parse(fs.readFileSync(SS + '.pos', 'utf8'));
  const ctx = await b.newContext({ viewport: { width: 1024, height: 640 }, storageState: SS });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-testid="cypress-player-name"], #playerName', { timeout: 60000 });
  await sleep(1500);
  if (await page.locator('#playerName').count()) { console.log('join screen shown (not restored)'); }
  else {
    await installHooks(page); await sleep(2000);
    const s = await state(page);
    const hud = await page.evaluate(() => document.body.innerText.match(/Cargo\n[^\n]+\n[^\n]+\ngold/)?.[0]);
    console.log('prev', JSON.stringify(prev)); console.log('now ', JSON.stringify({ x: s.x, z: s.z, r: s.r, hud }), 'moved', Math.hypot((s.x - prev.x) * 0.95, s.z - prev.z).toFixed(1));
  }
}
await b.close();
