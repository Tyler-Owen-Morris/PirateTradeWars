import { launch, join, state, shot, sleep, hold, faceHeading } from './lib.mjs';
const b = await launch();
const { page, logs } = await join(b, 'QaDock' + Date.now() % 10000);
await page.evaluate(() => { window.__qa.legacy = []; window.__net.on('legacy', (m) => window.__qa.legacy.push(m)); });
const ports = await page.evaluate(() => fetch('/api/ports').then(r => r.json()));
console.log('ports', ports.length, JSON.stringify(ports[0]).slice(0, 300));
const dockInfo = async () => page.evaluate((ports) => {
  const p = window.__net.predictor.cur; const C = 400000, H = 200000;
  let best = null;
  for (const pt of ports) {
    const dk = pt.dock ?? pt; let dx = dk.x - p.x; if (dx > C / 2) dx -= C; if (dx < -C / 2) dx += C;
    const mz = (dk.z + p.z) / 2; const d = Math.hypot(dx * Math.cos((90 - mz / H * 180) * Math.PI / 180), dk.z - p.z);
    if (!best || d < best.d) best = { id: pt.id, name: pt.name, d, hdg: (Math.atan2(dx * Math.cos((90 - mz / H * 180) * Math.PI / 180), -(dk.z - p.z)) * 180 / Math.PI + 360) % 360 };
  }
  const prompt = [...document.querySelectorAll('div,button,span')].some(e => /to trade/.test(e.textContent || '') && e.children.length < 6);
  return { ...best, prompt };
}, ports);
await sleep(2000);
let di = await dockInfo();
console.log('at spawn', di);
// Open trade menu with T
await page.keyboard.press('t');
await sleep(1500);
await shot(page, 't3-trade');
const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
console.log('trade menu text', JSON.stringify(text));
// select first good in buy tab: buttons inside the dialog listing goods
const dlg = page.locator('[role="dialog"]');
const goodBtns = dlg.locator('button').filter({ hasNotText: /Buy Goods|Buy Max|Sell|Close|Repair|Upgrade/ });
console.log('dialog buttons', await dlg.locator('button').allInnerTexts());
await dlg.locator('button', { hasText: /Select|Rum|Sugar|Cloth|Spice|Tobacco|Coffee/i }).first().click().catch(e => console.log('select fail', e.message));
await sleep(500);
await dlg.locator('button', { hasText: 'Buy Max' }).click().catch(e => console.log('buymax fail', e.message));
await sleep(1500);
console.log('after buy legacy', JSON.stringify((await page.evaluate(() => window.__qa.legacy)).map(m => ({ type: m.type, action: m.action, q: m.quantity, gold: m.gold, msg: m.message }))));
await dlg.locator('[role="tab"]', { hasText: 'Sell Goods' }).click();
await sleep(800);
console.log('sell tab buttons', await dlg.locator('button').allInnerTexts());
await dlg.locator('[role="tabpanel"] button').first().click().catch(e => console.log('sel2 fail', e.message));
await sleep(400);
await dlg.locator('button', { hasText: 'Sell Max' }).click().catch(e => console.log('sellmax fail', e.message));
await sleep(1500);
const leg = await page.evaluate(() => window.__qa.legacy);
console.log('after sell legacy', JSON.stringify(leg.map(m => ({ type: m.type, action: m.action, q: m.quantity, gold: m.gold, msg: m.message }))));
await page.keyboard.press('Escape');
await sleep(800);
// buy 1 via raw msg so we have cargo, then sail away and try to sell/buy far away
const portId = di.id;
await page.evaluate((portId) => window.__net.send({ type: 'trade', portId, action: 'buy', goodId: 1, quantity: 1 }), portId);
await sleep(1000);
// sail away from dock
await faceHeading(page, (di.hdg + 180) % 360);
const samples = [];
await page.keyboard.down('w');
for (let i = 0; i < 16; i++) { await sleep(250); const d = await dockInfo(); samples.push([+d.d.toFixed(0), d.prompt]); }
await page.keyboard.up('w');
await sleep(1500);
console.log('dock distance / prompt while leaving', JSON.stringify(samples));
di = await dockInfo();
console.log('far', di);
await page.evaluate(() => { window.__qa.legacy = []; });
await page.evaluate((portId) => { window.__net.send({ type: 'trade', portId, action: 'buy', goodId: 1, quantity: 1 }); window.__net.send({ type: 'trade', portId, action: 'sell', goodId: 1, quantity: 1 }); window.__net.send({ type: 'repairShip', portId }); window.__net.send({ type: 'upgradeShip', portId }); }, portId);
await sleep(1500);
console.log('far legacy', JSON.stringify((await page.evaluate(() => window.__qa.legacy)).map(m => ({ type: m.type, msg: m.message }))));
await page.keyboard.press('t'); await sleep(800);
console.log('T far opens dialog?', await page.locator('[role="dialog"]').count());
console.log('LOGS', JSON.stringify(logs.filter(l => !/Stripe|GPU stall/.test(l)), null, 1));
await b.close();
