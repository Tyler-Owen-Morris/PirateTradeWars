// Raw footage pack shots (docs/trailer/FOOTAGE.md). Same shot format as shots.mjs; capture.mjs looks here first.
// Capture with --size 2560x1440 (16:9) or --aspect 9x16 (1080x1920). Ids: sc-* scenic, bt-* battles, pt-* ports, ui-*.
// Heading convention (NOTES.md): forward = (-sin r, -cos r) in (east, south): r = 0 sails north, r = PI south,
// r = -PI/2 east, r = PI/2 west. Ship-relative path axes: -z ahead, +z astern, +x starboard. Paths should run ~1-2 s
// longer than dur (the camera holds its last pose after the path ends).
import { orbit, portShot, townShot, parkAtPort, trackPair } from "./shots.mjs";

const NORTH = 0, SOUTH = Math.PI, EAST = -Math.PI / 2, WEST = Math.PI / 2; // forward = (-sin r, -cos r) in (east, south)
const deg = Math.PI / 180;

/** Hold W for `ms`, or pulse it (duty 0..1 of every 400 ms) for a slower, steady cruise. */
async function sail(h, ms, duty = 1) {
  if (duty >= 1) { await h.sleep(ms); return; }
  const t0 = Date.now();
  let down = true;
  while (Date.now() - t0 < ms) {
    if (down) await h.keys.down("w"); else await h.keys.up("w");
    await h.sleep(down ? 400 * duty : 400 * (1 - duty));
    down = !down;
  }
  await h.keys.down("w");
}

/** Spawn an NPC relative to the own ship: ahead (+ = in front of the bow), beam (+ = starboard), rel heading (rad). */
async function spawnRel(h, { a = "pirate", f, ship, ahead = 0, beam = 0, rel = 0 }) {
  const me = await h.me();
  const mx = Math.cos((90 - (me.z / 200000) * 180) * deg);
  const fx = -Math.sin(me.r), fz = -Math.cos(me.r), sx = Math.cos(me.r), sz = -Math.sin(me.r);
  await h.npc({ a, f, ship, x: me.x + (fx * ahead + sx * beam) / mx, z: me.z + fz * ahead + sz * beam, r: me.r + rel });
}

/** Realtime: the own ship under sail at lat/lon/heading, ship-relative camera keyframes (played in real time). */
function sailShot(id, o) {
  return {
    id,
    mode: "realtime",
    dur: o.dur,
    ship: o.ship ?? "galleon",
    note: o.note,
    hud: !!o.hud,
    fov: o.fov ?? 50, // tighter lens than the game camera (80): ships read bigger, less distortion
    lead: 3.3 + (o.preMs ?? 0) / 1000, // camera follows the ship through pre + settle (capture.mjs)
    setup: async (h) => {
      await h.tp(...h.at(o.lat, o.lon), o.r);
      if (o.npcs) for (const n of o.npcs) await spawnRel(h, n);
    },
    pre: async (h) => { await h.keys.down("w"); if (o.preMs) await h.sleep(o.preMs); },
    path: (h) => (typeof o.path === "function" ? o.path(h) : o.path),
    run: async (h) => {
      await h.mark("start");
      await sail(h, o.dur * 1000 + 600, o.duty);
      await h.keys.up("w");
      await h.mark("end");
    },
  };
}

/**
 * Play a camera-only (frames-style) shot in REALTIME instead: frames mode runs the page on a virtual clock while the
 * server streams NPC snapshots in real time, so moving NPC ships flicker and jump between frames (seen at Havana,
 * 2026-10-25). Realtime keeps NPCs right; the path starts moving just before the recording (lead) and the recording
 * stops just before the path ends.
 */
function live(shot) {
  const settle = shot.settleMs ?? 8000;
  return { ...shot, mode: "realtime", settleMs: settle, lead: settle / 1000 - 0.3, run: async (h) => { await h.mark("start"); await h.sleep(shot.dur * 1000 - 400); await h.mark("end"); } };
}

/** Frames: camera-only flight anchored on lat/lon (own ship parked out of frame unless `shipAt`). */
function aerial(id, o) {
  return live({
    id,
    mode: "frames",
    dur: o.dur,
    ship: "galleon",
    settleMs: o.settleMs ?? 7000,
    fov: o.fov ?? 60,
    note: o.note,
    setup: async (h) => h.tp(...h.at(...(o.shipAt ?? [o.lat + 3, o.lon])), o.shipR ?? 0),
    path: (h) => {
      const ks = typeof o.keys === "function" ? o.keys(h) : o.keys;
      return ks.map((k, i) => ({ t: k.t ?? (o.dur * i) / (ks.length - 1), anchor: { lat: o.lat, lon: o.lon }, cam: k.cam, look: k.look ?? { x: 0, y: 0, z: 0 }, ease: k.ease ?? (ks.length > 2 ? "linear" : "smooth") }));
    },
  });
}

// ---------------------------------------------------------------- combat helpers
/** NPCs relative to the own ship (metric): along (+ ahead), side (+ starboard), d, hp, sunk. */
const relAll = (h) => h.page.evaluate(() => {
  const net = window.__net, c = net.predictor.cur, rt = net.remoteRenderTime();
  const mx = Math.cos(((90 - (c.z / 200000) * 180) * Math.PI) / 180);
  const fx = -Math.sin(c.rotationY), fz = -Math.cos(c.rotationY), sx = Math.cos(c.rotationY), sz = -Math.sin(c.rotationY);
  const out = [];
  for (const e of net.remote.renderable()) {
    if (!e.meta?.npc) continue;
    const p = net.remote.sample(e.eid, rt); if (!p) continue;
    const dx = (p.x - c.x) * mx, dz = p.z - c.z;
    out.push({ eid: e.eid, title: e.meta.title, along: dx * fx + dz * fz, side: dx * sx + dz * sz, d: Math.hypot(dx, dz), hp: p.hp, sunk: !!(p.flags & 1) });
  }
  return out.sort((a, b) => a.d - b.d);
});

/**
 * Fight for `ms`: W held (or pulsed with `duty`), fire Q/E whenever an NPC within `range` is abeam on that side
 * (cooldown per side), and (steer) put the helm over to bring the nearest enemy onto the beam. Logs the volleys.
 */
// Hits only land between ~100 and ~185 units (closer: the balls spawn past the target; tested 2026-10-25), so fire there.
async function fight(h, ms, { duty = 1, steer = true, range = 185, minR = 95, cool = 2300, fire = true, holdMs = 0, alongMax = 170 } = {}) {
  const t0 = Date.now();
  const last = { q: -1e9, e: -1e9 };
  let turning = null, wOn = false;
  const log = [];
  const setW = async (on) => { if (on !== wOn) { if (on) await h.keys.down("w"); else await h.keys.up("w"); wOn = on; } };
  while (Date.now() - t0 < ms) {
    const t = Date.now() - t0;
    await setW(duty >= 1 || t % 400 < 400 * duty);
    const all = (await relAll(h)).filter((n) => !n.sunk);
    if (fire && t >= holdMs) {
      for (const n of all) {
        if (n.d > range || n.d < minR || Math.abs(n.along) > alongMax) continue;
        const k = n.side > 0 ? "e" : "q";
        if (t - last[k] > cool) { await h.keys.tap(k); last[k] = t; log.push({ t, k, d: Math.round(n.d), hp: n.hp }); await h.mark(k.toUpperCase()); }
      }
    }
    if (steer && all[0] && all[0].d < 900) {
      const n = all[0], ang = (Math.abs(Math.atan2(n.side, n.along)) * 180) / Math.PI; // 0 ahead, 180 astern
      const stb = n.side > 0;
      const want = ang < 65 ? (stb ? "a" : "d") : ang > 115 ? (stb ? "d" : "a") : null;
      if (want !== turning) { if (turning) await h.keys.up(turning); if (want) await h.keys.down(want); turning = want; }
    }
    await h.sleep(70);
  }
  if (turning) await h.keys.up(turning);
  await setW(false);
  console.log("  volleys", JSON.stringify(log), "end", JSON.stringify((await relAll(h)).slice(0, 4).map((n) => ({ d: Math.round(n.d), along: Math.round(n.along), hp: n.hp, sunk: n.sunk }))));
}

/**
 * In-page group camera: frames the own ship (includeMe) and the NPCs within `radius` at the start (locked), from a
 * world bearing (deg, 0 = north of the group, turning `spin` deg/s), distance from the group's spread, smoothed.
 */
async function trackGroup(h, { bearing = 200, spin = 0, high = 0.45, distK = 1.5, minD = 220, maxD = 700, includeMe = true, radius = 800, k = 0.05, lookY = 10, dyn = 0 } = {}) {
  await h.page.evaluate((o) => {
    const net = window.__net;
    let lock = null, a = null, D = null, raf = 0, stop = false;
    const t0 = performance.now();
    const tick = () => {
      if (stop) return;
      const me = net.getOwnRenderState(), rt = net.remoteRenderTime();
      const mx = Math.cos(((90 - (me.z / 200000) * 180) * Math.PI) / 180);
      const pts = o.includeMe ? [{ x: me.x, z: me.z }] : [];
      const seen = [], all = [];
      for (const e of net.remote.renderable()) {
        if (!e.meta?.npc) continue;
        const p = net.remote.sample(e.eid, rt); if (!p) continue;
        if (o.dyn) { all.push({ eid: e.eid, x: p.x, z: p.z }); continue; }
        if (lock ? lock.includes(e.eid) : Math.hypot((p.x - me.x) * mx, p.z - me.z) < o.radius) { pts.push({ x: p.x, z: p.z }); seen.push(e.eid); }
      }
      if (o.dyn) {
        // dynamic: the subject (own ship, or the NPC nearest to us at the start) plus every NPC within dyn of it now
        let subj = o.includeMe ? { x: me.x, z: me.z } : null;
        if (!subj) {
          if (lock === null) { let b = null; for (const q of all) { const d = Math.hypot((q.x - me.x) * mx, q.z - me.z); if (!b || d < b.d) b = { d, eid: q.eid }; } if (b) lock = [b.eid]; }
          subj = all.find((q) => lock && q.eid === lock[0]) ?? null;
          if (subj) pts.push(subj);
        }
        if (subj) for (const q of all) if (q !== subj && Math.hypot((q.x - subj.x) * mx, q.z - subj.z) < o.dyn) pts.push(q);
      }
      if (!o.dyn && !lock && seen.length) lock = seen;
      if (!pts.length) { raf = requestAnimationFrame(tick); return; }
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const spread = Math.max(0, ...pts.map((p) => Math.hypot((p.x - cx) * mx, p.z - cz)));
      const want = Math.min(o.maxD, Math.max(o.minD, spread * o.distK + 120));
      const kk = a === null ? 1 : o.k;
      a = a === null ? { x: cx, z: cz } : { x: a.x + (cx - a.x) * kk, z: a.z + (cz - a.z) * kk };
      D = D === null ? want : D + (want - D) * kk * 0.5;
      const b = ((o.bearing + (o.spin * (performance.now() - t0)) / 1000) * Math.PI) / 180;
      window.__trailer.setPath([{ t: 0, anchor: { x: a.x, z: a.z }, cam: { x: Math.sin(b) * D, y: D * o.high, z: -Math.cos(b) * D }, look: { x: 0, y: o.lookY, z: 0 } }]);
      window.__trailer.seek(0);
      raf = requestAnimationFrame(tick);
    };
    window.__trackStop = () => { stop = true; cancelAnimationFrame(raf); };
    tick();
  }, { bearing, spin, high, distK, minD, maxD, includeMe, radius, k, lookY, dyn });
}

/** In-page close camera on the nearest NPC (locked): `dist` beyond it on the far side from us (+ `sideways`), low. */
async function trackEnemy(h, { dist = 90, height = 14, lookBias = 0.35, sideways = 0, k = 0.08 } = {}) {
  await h.page.evaluate((o) => {
    const net = window.__net;
    let lock = null, c = null, raf = 0, stop = false;
    const tick = () => {
      if (stop) return;
      const me = net.getOwnRenderState(), rt = net.remoteRenderTime();
      const mx = Math.cos(((90 - (me.z / 200000) * 180) * Math.PI) / 180);
      let best = null;
      for (const e of net.remote.renderable()) {
        if (!e.meta?.npc || (lock !== null && e.eid !== lock)) continue;
        const p = net.remote.sample(e.eid, rt); if (!p) continue;
        const d = Math.hypot((p.x - me.x) * mx, p.z - me.z);
        if (!best || d < best.d) best = { x: p.x, z: p.z, d, eid: e.eid };
      }
      if (!best) { raf = requestAnimationFrame(tick); return; }
      if (lock === null) lock = best.eid;
      let ux = (best.x - me.x) * mx, uz = best.z - me.z;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;
      const px = -uz, pz = ux;
      const want = { x: ux * o.dist + px * o.sideways, z: uz * o.dist + pz * o.sideways };
      const kk = c === null ? 1 : o.k;
      c = c === null ? want : { x: c.x + (want.x - c.x) * kk, z: c.z + (want.z - c.z) * kk };
      window.__trailer.setPath([{ t: 0, anchor: { x: best.x, z: best.z }, cam: { x: c.x, y: o.height, z: c.z }, look: { x: -ux * l * o.lookBias, y: 12, z: -uz * l * o.lookBias } }]);
      window.__trailer.seek(0);
      raf = requestAnimationFrame(tick);
    };
    window.__trackStop = () => { stop = true; cancelAnimationFrame(raf); };
    tick();
  }, { dist, height, lookBias, sideways, k });
}

/**
 * Combat take. Teleport to lat/lon heading r, spawn `npcs` (spawnRel specs), start the tracker camera(h) in pre,
 * then script(h) (default: fight for dur). Clean by default (no HUD, no plates).
 * Manually spawned NPCs never despawn: restart the server before every take (FOOTAGE.md).
 */
function battle(id, o) {
  return {
    id,
    mode: "realtime",
    dur: o.dur,
    ship: o.ship ?? "galleon",
    hud: !!o.hud,
    plates: o.plates ?? false,
    fov: o.fov ?? 60,
    note: o.note,
    settleMs: o.settleMs ?? 1500,
    setup: async (h) => {
      await h.tp(...h.at(o.lat, o.lon), o.r);
      for (const n of o.npcs) await spawnRel(h, n);
      if (o.weaken) { // dev shortcut (devhp): the nearest NPC starts on `weaken` hp so one hit sinks it on camera
        await h.sleep(800);
        const n = (await relAll(h))[0];
        if (n) await h.page.evaluate(([eid, hp]) => window.__net.send({ t: "devhp", eid, hp }), [n.eid, o.weaken]);
      }
    },
    pre: async (h) => {
      await o.camera(h);
      if (o.preMs) { await h.keys.down("w"); await h.sleep(o.preMs); }
    },
    run: async (h) => {
      await h.mark("start");
      if (o.script) await o.script(h); else await fight(h, o.dur * 1000 + 600, o.fight ?? {});
      await h.mark("end");
      await h.page.evaluate(() => window.__trackStop?.());
    },
  };
}

const SCENIC = [
  sailShot("sc-orbit-carib", {
    dur: 10, lat: 16.0, lon: -64.0, r: WEST, duty: 0.55,
    note: "Slow orbit round the galleon under sail, open Caribbean.",
    path: orbit({ ship: true }, { r: 170, h: 34, yaw0: 230, yaw1: 150, dur: 12, lookY: 30, rot: "ship", n: 16 }),
  }),
  sailShot("sc-waterline-pass", {
    dur: 9, lat: 16.0, lon: -64.0, r: WEST, duty: 0.45,
    note: "Lens at the waterline off the starboard bow; the galleon slides past the camera and away.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: 70, y: 5, z: -240 }, look: { x: 0, y: 26, z: -40 } },
      { t: 11, anchor: { ship: true }, rot: "ship", cam: { x: 55, y: 6, z: 170 }, look: { x: 0, y: 24, z: 0 } },
    ],
  }),
  sailShot("sc-bow-on-low", {
    dur: 9, lat: 16.0, lon: -64.0, r: WEST, duty: 1,
    note: "Low camera ahead of the bow looking back: the galleon bears down on the lens at full sail.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: -25, y: 12, z: -150 }, look: { x: 0, y: 24, z: 0 } },
      { t: 11, anchor: { ship: true }, rot: "ship", cam: { x: 20, y: 18, z: -110 }, look: { x: 0, y: 26, z: 10 } },
    ],
  }),
  sailShot("sc-high-chase-islands", {
    dur: 10, lat: 22.2, lon: -74.4, r: -2.88, duty: 0.7, // bearing 165, clear of land (landcheck.ts)
    note: "High chase over the Bahamas banks: the galleon sails between sandy cays.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: -120, y: 230, z: 330 }, look: { x: 0, y: 0, z: -150 } },
      { t: 12, anchor: { ship: true }, rot: "ship", cam: { x: 90, y: 180, z: 260 }, look: { x: 0, y: 0, z: -180 } },
    ],
  }),
  aerial("sc-aerial-bahamas", {
    dur: 10, lat: 25.0, lon: -77.3,
    note: "High aerial drift over the Bahamas: Nassau's island, cays and shallows.",
    keys: [{ cam: { x: -420, y: 560, z: 300 }, look: { x: -260, y: 0, z: -40 } }, { cam: { x: 240, y: 560, z: 300 }, look: { x: 400, y: 0, z: -40 } }],
  }),
  aerial("sc-aerial-antilles", {
    dur: 10, lat: 14.8, lon: -61.2,
    note: "Aerial drift along Martinique (Saint-Pierre) in the Lesser Antilles.",
    keys: [{ cam: { x: -650, y: 520, z: 250 }, look: { x: -350, y: 0, z: -100 } }, { cam: { x: -350, y: 520, z: -250 }, look: { x: -50, y: 0, z: -600 } }],
  }),
  aerial("sc-ice-cliff-dolly", {
    dur: 10, lat: 71.97, lon: 30.0, shipAt: [71.0, 30.0],
    note: "Low dolly along the 72 N ice cliff in the Barents Sea (ice sheet to the north).",
    keys: [{ cam: { x: -350, y: 35, z: 170 }, look: { x: -150, y: 10, z: -60 } }, { cam: { x: 250, y: 45, z: 150 }, look: { x: 450, y: 10, z: -60 } }],
  }),
  sailShot("sc-ice-sail", {
    dur: 9, lat: 71.9, lon: 34.0, r: EAST, duty: 0.6,
    note: "The galleon running east along the 72 N ice cliff, camera low off the starboard quarter (ice beyond the ship).",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: 160, y: 30, z: 120 }, look: { x: -30, y: 25, z: -40 } },
      { t: 11, anchor: { ship: true }, rot: "ship", cam: { x: 150, y: 50, z: -60 }, look: { x: -30, y: 25, z: 0 } },
    ],
  }),
  live({
    id: "sc-ice-orbit-man-o-war",
    mode: "frames",
    dur: 10,
    ship: "man-o-war",
    settleMs: 7000,
    note: "Man-o'-war hove to under the 72 N ice cliff; slow low orbit.",
    setup: async (h) => h.tp(...h.at(71.93, 31.0), EAST),
    path: orbit({ ship: true }, { r: 175, h: 30, yaw0: 120, yaw1: 200, dur: 10, lookY: 34, n: 16 }),
  }),
  aerial("sc-aerial-oresund", {
    dur: 10, lat: 55.95, lon: 12.65,
    note: "Aerial over the Oresund narrows (Helsingor / Helsingborg), Denmark to the west, Sweden to the east.",
    keys: [{ cam: { x: 0, y: 480, z: -700 }, look: { x: 0, y: 0, z: -100 } }, { cam: { x: 0, y: 480, z: -200 }, look: { x: 0, y: 0, z: 400 } }],
  }),
  aerial("sc-aerial-gulf-finland", {
    dur: 10, lat: 59.95, lon: 28.5,
    note: "Aerial up the Gulf of Finland towards St. Petersburg.",
    keys: [{ cam: { x: -700, y: 420, z: 0 }, look: { x: 0, y: 0, z: 0 } }, { cam: { x: -200, y: 420, z: 0 }, look: { x: 500, y: 0, z: 0 } }],
  }),
  live({
    id: "sc-reveal-havana",
    mode: "frames",
    dur: 12,
    ship: "galleon",
    settleMs: 8000,
    note: "Reveal: from open sea low over the water, the camera pushes in and rises until Havana and the Morro fill the frame.",
    setup: parkAtPort("havana", 40, 110),
    path: portShot("havana", [{ d: 1300, h: 14, s: -120, ld: 0, lh: 30 }, { d: 600, h: 40, s: -60, ld: -20, lh: 15 }, { d: 230, h: 70, s: 10, ld: -50, lh: 0 }], 12),
  }),
  sailShot("sc-merchant-fleet", {
    dur: 10, lat: 14.0, lon: -67.5, r: WEST, duty: 0.35,
    npcs: [{ a: "merchant", f: "england", ship: "brigantine", ahead: 1500, beam: -170 }, { a: "merchant", f: "england", ship: "sloop", ahead: 1750, beam: 150 }, { a: "merchant", f: "netherlands", ship: "brigantine", ahead: 2050, beam: -110 }],
    note: "Our galleon sails slowly through a gathering of merchantmen (spawned English and Dutch traders); low camera off the port quarter.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: -150, y: 60, z: 220 }, look: { x: 20, y: 10, z: -300 } },
      { t: 12, anchor: { ship: true }, rot: "ship", cam: { x: -190, y: 70, z: 40 }, look: { x: 60, y: 10, z: -220 } },
    ],
  }),
  battle("sc-ships-passing", {
    dur: 10, lat: 13.5, lon: -63.0, r: WEST, preMs: 300, fov: 55,
    npcs: [{ a: "navy", f: "england", ship: "man-o-war", ahead: 1500, beam: 140, rel: Math.PI }],
    note: "An English Navy man-o'-war passes close on the opposite course, no shots fired; two-shot camera.",
    script: async (h) => { await sail(h, 10600, 0.5); await h.keys.up("w"); },
    camera: (h) => trackPair(h, { high: 0.55 }),
  }),
];

// Restart the server before each battle take (spawned NPCs never despawn).
const BATTLES = [
  battle("bt-spanish-pass", {
    dur: 12, lat: 14.0, lon: -72.0, r: WEST, preMs: 400,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 650, beam: 150, rel: Math.PI }],
    note: "Spanish Navy man-o'-war on the opposite course; broadsides as it comes abeam, we come about for more, it returns fire.",
    fight: { duty: 0.35, steer: true },
    camera: (h) => trackGroup(h, { dyn: 700, bearing: 200, high: 0.3, distK: 1.2, minD: 200, maxD: 700, k: 0.05 }),
  }),
  battle("bt-spanish-pass-wide", {
    dur: 12, lat: 14.0, lon: -72.0, r: WEST, preMs: 400,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 650, beam: 150, rel: Math.PI }],
    note: "Spanish Navy man-o'-war, second take: wide, high and slowly circling.",
    fight: { duty: 0.35, steer: true },
    camera: (h) => trackGroup(h, { dyn: 500, bearing: 140, spin: 4, high: 0.6, distK: 1.5, minD: 380, maxD: 750, k: 0.03 }),
  }),
  battle("bt-english-pass", {
    dur: 12, lat: 49.8, lon: -3.5, r: WEST, preMs: 400,
    npcs: [{ a: "navy", f: "england", ship: "man-o-war", ahead: 650, beam: -150, rel: Math.PI }],
    note: "Western Approaches of the Channel: English Navy man-o'-war passing to port, broadsides exchanged (we fire first).",
    fight: { duty: 0.35, steer: true },
    camera: (h) => trackGroup(h, { dyn: 700, bearing: 20, high: 0.3, distK: 1.2, minD: 200, maxD: 700, k: 0.05 }),
  }),
  battle("bt-russian-pass", {
    dur: 12, lat: 66.0, lon: 4.0, r: NORTH, preMs: 400,
    npcs: [{ a: "navy", f: "russia", ship: "man-o-war", ahead: 650, beam: 150, rel: Math.PI }],
    note: "Norwegian Sea: Russian Navy man-o'-war, broadsides on the pass and after we come about.",
    fight: { duty: 0.35, steer: true },
    camera: (h) => trackGroup(h, { dyn: 700, bearing: 120, high: 0.4, distK: 1.2, minD: 220, maxD: 700, k: 0.05 }),
  }),
  battle("bt-sink-sloop", {
    dur: 12, lat: 15.0, lon: -72.0, r: WEST, ship: "man-o-war", // 4 x 15 per volley: a sloop (50 hp) goes down fast
    npcs: [{ a: "pirate", ship: "sloop", beam: 155 }],
    note: "Pirate sloop on the starboard beam: broadsides until she sinks (the sink animation, then her gold floats).",
    fight: { duty: 0, steer: true, holdMs: 700, minR: 115, range: 195, alongMax: 30, cool: 1500 }, weaken: 8,
    camera: (h) => trackGroup(h, { dyn: 400, bearing: 300, high: 0.4, distK: 1.1, minD: 200, maxD: 420, k: 0.06 }), // from ahead: our ship does not hide the sloop
  }),
  battle("bt-sink-close", {
    dur: 12, lat: 15.0, lon: -72.0, r: WEST, ship: "man-o-war", // 4 x 15 per volley: a sloop (50 hp) goes down fast
    npcs: [{ a: "pirate", ship: "sloop", beam: 155 }],
    note: "Close on the pirate sloop from beyond her: splashes and hits, then she goes down; our galleon firing behind.",
    fight: { duty: 0, steer: true, holdMs: 700, minR: 115, range: 195, alongMax: 30, cool: 1500 }, weaken: 8,
    camera: (h) => trackEnemy(h, { dist: 95, height: 20, lookBias: 0.4, sideways: 40 }),
  }),
  battle("bt-brigantine-duel-close", {
    dur: 14, lat: 15.0, lon: -72.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 150 }],
    note: "Pirate brigantine duel: low camera beside her, broadsides both ways, cannonball splashes and smoke close up.",
    fight: { duty: 0.15, steer: true },
    camera: (h) => trackEnemy(h, { dist: 90, height: 14, lookBias: 0.5, sideways: -60 }),
  }),
  battle("bt-brigantine-duel-two-shot", {
    dur: 14, lat: 15.0, lon: -72.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 150 }],
    note: "Pirate brigantine duel, low two-shot (both ships in frame).",
    fight: { duty: 0.15, steer: true },
    camera: (h) => trackGroup(h, { dyn: 400, bearing: 210, high: 0.22, distK: 1.1, minD: 170, maxD: 420, k: 0.06 }),
  }),
  battle("bt-pursuit", {
    dur: 12, lat: 17.0, lon: -68.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", ahead: -380, beam: 60 }],
    note: "Pursuit: a pirate brigantine runs our galleon down from astern; camera beyond the pirate, our galleon ahead.",
    fight: { duty: 0.3, steer: false },
    camera: (h) => trackEnemy(h, { dist: 110, height: 26, lookBias: 0.6, sideways: 20, k: 0.05 }),
  }),
  battle("bt-pursuit-ahead", {
    dur: 12, lat: 17.0, lon: -68.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", ahead: -380, beam: 60 }],
    note: "Pursuit, reverse angle: from beyond our galleon looking back at the pirate closing in.",
    fight: { duty: 0.3, steer: false },
    camera: (h) => trackPair(h, { portrait: true, high: 0.8 }),
  }),
  battle("bt-melee-3", {
    dur: 14, lat: 14.5, lon: -76.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 160, ahead: 120 }, { a: "pirate", ship: "brigantine", beam: -170, ahead: 60 }, { a: "pirate", ship: "sloop", ahead: 300, beam: 30, rel: Math.PI }],
    note: "Melee: our galleon against three pirates (two brigantines, a sloop), broadsides both sides; slow orbiting wide camera.",
    fight: { duty: 0.15, cool: 2000 },
    camera: (h) => trackGroup(h, { dyn: 450, bearing: 160, spin: 5, high: 0.5, distK: 1.3, minD: 300, maxD: 650, k: 0.04 }),
  }),
  battle("bt-melee-3-low", {
    dur: 14, lat: 14.5, lon: -76.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 160, ahead: 120 }, { a: "pirate", ship: "brigantine", beam: -170, ahead: 60 }, { a: "pirate", ship: "sloop", ahead: 300, beam: 30, rel: Math.PI }],
    note: "Melee, second angle: low and close among the ships.",
    fight: { duty: 0.15, cool: 2000 },
    camera: (h) => trackGroup(h, { dyn: 350, bearing: 250, spin: -3, high: 0.22, distK: 1.0, minD: 200, maxD: 480, k: 0.05 }),
  }),
  battle("bt-navy-vs-pirates", {
    dur: 14, lat: 13.5, lon: -70.0, r: WEST,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 0, beam: 650, rel: Math.PI / 2 }, { a: "pirate", ship: "brigantine", ahead: 200, beam: 820, rel: -Math.PI / 2 }, { a: "pirate", ship: "brigantine", ahead: -200, beam: 820, rel: -Math.PI / 2 }],
    note: "Spanish Navy man-o'-war against two pirate brigantines (NPC vs NPC, our ship hove to out of frame); group camera on the navy ship.",
    script: async (h) => { await h.sleep(14600); },
    camera: (h) => trackGroup(h, { includeMe: false, dyn: 450, bearing: 90, spin: 3, high: 0.4, distK: 1.3, minD: 250, maxD: 600, k: 0.04 }),
  }),
];

// ---------------------------------------------------------------- ports and towns (frames, town-anchored)
const TOWN_WIDE = [{ d: 300, h: 55, s: 170, lh: 10 }, { d: 210, h: 85, s: -80, lh: 0 }];
const TOWN_WIDE_V = [{ d: 330, h: 70, s: 90, lh: 10 }, { d: 250, h: 95, s: -40, lh: 0 }];
const TOWN_LOW = [{ d: 360, h: 16, s: -60, lh: 18 }, { d: 190, h: 34, s: 20, lh: 10 }];
const TOWN_HIGH = [{ d: 380, h: 150, s: 160, lh: 0 }, { d: 300, h: 170, s: -120, lh: 0 }];
/** Town flyover: the own ship parked far out to sea behind the camera (`ship: [d, s]` to put it in the shot instead). */
function town(id, key, poses, { dur = 10, posesV, ship = [1500, 0], dock = false, note } = {}) {
  return live({
    id,
    mode: "frames",
    dur,
    ship: "galleon",
    settleMs: 8000,
    note: note ?? `Town flyover: ${key}.`,
    setup: parkAtPort(key, ship[0], ship[1]),
    path: (dock ? portShot : townShot)(key, poses, dur, posesV),
  });
}

/** Realtime: sail in to a port's dock from `from` units out and stop (arrive), or leave from the dock (depart). */
function harbour(id, key, { arrive = true, from = 900, dur = 10, cam, note, duty = 0.45 }) {
  const geo = (h) => {
    const p = h.port(key);
    const mx = Math.cos((90 - (p.dock.z / 200000) * 180) * deg);
    let ux = (p.dock.x - p.x) * mx, uz = p.dock.z - p.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l; // seaward, metric
    return { p, mx, ux, uz };
  };
  return {
    id,
    mode: "realtime",
    dur,
    ship: "galleon",
    note,
    lead: 3.3,
    setup: async (h) => {
      const { p, mx, ux, uz } = geo(h);
      // forward = (-sin r, -cos r): heading landward (-u) => r = atan2(ux, uz); seaward => r = atan2(-ux, -uz)
      const d = arrive ? from : 60;
      await h.tp(p.dock.x + (ux * d) / mx, p.dock.z + uz * d, arrive ? Math.atan2(ux, uz) : Math.atan2(-ux, -uz));
    },
    path: (h) => {
      const { ux, uz } = geo(h);
      const rx = uz, rz = -ux; // sideways (same axis as portShot)
      const off = (d, hh, s) => ({ x: ux * d + rx * s, y: hh, z: uz * d + rz * s });
      return cam.map((q, i) => ({ t: (dur + 2) * (i / (cam.length - 1)), anchor: { port: key }, cam: off(q.d, q.h, q.s), look: off(q.ld ?? 0, q.lh ?? 10, q.ls ?? 0) }));
    },
    run: async (h) => {
      await h.mark("start");
      await sail(h, (arrive ? 0.62 : 1) * dur * 1000, duty);
      await h.keys.up("w");
      if (arrive) { await h.keys.down("s"); await h.sleep(900); await h.keys.up("s"); await h.sleep(0.38 * dur * 1000 - 300); }
      await h.mark("end");
    },
  };
}

const PORTS = [
  town("pt-havana", "havana", TOWN_WIDE, { posesV: TOWN_WIDE_V, note: "Havana: Morro castle, quay and red-roofed town, drifting past and rising." }),
  town("pt-havana-low", "havana", TOWN_LOW, { posesV: TOWN_LOW, note: "Havana from the water: low push in towards the harbour mouth." }),
  town("pt-port-royal", "port_royal", TOWN_WIDE, { note: "Port Royal, Jamaica: English brick town on the spit, fort and wharves." }),
  town("pt-cartagena", "cartagena", TOWN_WIDE, { posesV: TOWN_WIDE_V, note: "Cartagena de Indias: walled Spanish town on the bay." }),
  town("pt-cartagena-low", "cartagena", TOWN_LOW, { note: "Cartagena from the water, low push in." }),
  town("pt-amsterdam", "amsterdam", [{ d: 215, h: 32, s: 140, ld: -40, lh: 12 }, { d: 190, h: 60, s: -60, ld: -40, lh: 8 }], { dock: true, note: "Amsterdam: Dutch gables and windmills, sideways truck from the IJ." }),
  town("pt-london", "london", TOWN_HIGH, { note: "London: high pass over the City and its domed cathedral on the Thames." }),
  town("pt-lisbon", "lisbon", TOWN_WIDE, { note: "Lisbon on the Tagus: white houses, orange roofs, fort." }),
  town("pt-cadiz", "cadiz", TOWN_WIDE, { posesV: TOWN_WIDE_V, note: "Cadiz: white Andalusian town and fort across the bay." }),
  town("pt-st-petersburg", "st_petersburg", [{ d: 250, h: 55, s: 220, lh: 10 }, { d: 235, h: 80, s: 60, lh: 4 }], { posesV: [{ d: 300, h: 70, s: 150, lh: 10 }, { d: 280, h: 95, s: 60, lh: 4 }], note: "St. Petersburg on the Neva: church and painted Baltic town." }),
  town("pt-stockholm", "stockholm", TOWN_WIDE, { posesV: TOWN_WIDE_V, note: "Stockholm: ochre and red houses, church spire, castle and quays." }),
  town("pt-copenhagen", "copenhagen", TOWN_WIDE, { note: "Copenhagen: colourful harbour town and fortress on the Sound." }),
  town("pt-bergen", "bergen", [{ d: 260, h: 60, s: 190, lh: 8 }, { d: 240, h: 75, s: 40, lh: 4 }], { note: "Bergen: fort and Hanseatic wharf town." }),
  town("pt-arkhangelsk", "arkhangelsk", [{ d: 230, h: 85, s: 140, lh: 6 }, { d: 200, h: 110, s: -40, lh: 0 }], { note: "Arkhangelsk: dark timber town and church on the White Sea, ice floes on the shore." }),
  town("pt-quebec", "quebec", TOWN_WIDE, { note: "Quebec: walled French town on the St. Lawrence." }),
  town("pt-york-factory", "york_factory", TOWN_WIDE, { note: "York Factory: Hudson's Bay trading post among the spruce." }),
  town("pt-sitka", "sitka", [{ d: 240, h: 70, s: 60, lh: 6 }, { d: 215, h: 85, s: -140, lh: 2 }], { note: "Sitka, Russian America: timber town on the sound." }),
  town("pt-callao", "callao", [{ d: 215, h: 32, s: 140, ld: -40, lh: 12 }, { d: 190, h: 60, s: -60, ld: -40, lh: 8 }], { dock: true, note: "Callao: the Real Felipe star fort and the port of Lima." }),
  town("pt-rio", "rio_de_janeiro", TOWN_WIDE, { note: "Rio de Janeiro: Portuguese town on Guanabara Bay." }),
  town("pt-macau", "macau", TOWN_WIDE, { note: "Macau: Portuguese town and churches on the Pearl River estuary." }),
  town("pt-batavia", "batavia", TOWN_WIDE, { note: "Batavia: Dutch East India Company town, fort and windmill." }),
  town("pt-galapagos", "galapagos", [{ d: 260, h: 45, s: 160, lh: 6 }, { d: 200, h: 70, s: -60, lh: 0 }], { note: "Galapagos: a pirate outpost on a lonely sandbar, a pirate ship at anchor." }),
  harbour("pt-havana-arrive", "havana", { arrive: true, from: 1100, dur: 10, note: "A galleon sails into Havana harbour and heaves to at the quay; fixed wide camera.",
    cam: [{ d: 420, h: 70, s: 330, ld: 300, lh: 10, ls: -40 }, { d: 300, h: 75, s: 300, ld: 60, lh: 10, ls: -20 }] }),
  harbour("pt-port-royal-depart", "port_royal", { arrive: false, dur: 10, duty: 0.55, note: "Leaving Port Royal: the galleon gets under way from the quay and heads out to sea.",
    cam: [{ d: 120, h: 45, s: -230, ld: 150, lh: 10, ls: 0 }, { d: 260, h: 60, s: -260, ld: 600, lh: 10, ls: 0 }] }),
];

// ---------------------------------------------------------------- 06 UI and gameplay (HUD on, 1920x1080)
const glide = async (h, sel) => {
  const el = h.page.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (b) await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await el.click();
};
/** One purchase/sale on the open bill of goods: pick the cell, 10 (or Max if 10 is not allowed), sign. */
async function order(h, side, good, { chip = "10" } = {}) {
  await h.page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), `[aria-label^="${side} ${good} at"]`);
  await h.sleep(500);
  await glide(h, `[aria-label^="${side} ${good} at"]`);
  await h.sleep(700);
  const ten = chip === "10" ? await h.page.locator('[data-fk="q:10"]').first().isDisabled().catch(() => true) : true;
  await glide(h, ten ? '[data-fk="q:max"]' : '[data-fk="q:10"]');
  await h.sleep(800);
  await h.mark?.(side + "-" + good);
  await glide(h, "#tb-sign");
  await h.sleep(1600);
}
const ui = (id, o) => ({ mode: "realtime", ship: "galleon", hud: true, plates: true, ...o, id });

const UI = [
  ui("ui-ship-select", {
    lobby: true, dur: 10,
    note: "Ship selection before joining: the captain's name, then each ship card in turn (all free).",
    setup: async () => {},
    run: async (h) => {
      for (const s of ["sloop", "brigantine", "galleon", "man-o-war", "galleon"]) {
        const el = h.page.locator(`[data-testid="cypress-${s}-card"]`);
        const b = await el.boundingBox();
        if (b) await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
        await el.click();
        await h.sleep(1500);
        await h.mark(s);
      }
      await h.sleep(800);
    },
  }),
  ui("ui-sail-autosail", {
    dur: 12,
    note: "Sailing with the full HUD near Port Royal: double-tap W engages auto-sail (indicator), a turn to port, minimap and compass.",
    setup: async (h) => h.tp(...h.dockNear("port_royal", 1400, 40), 0),
    run: async (h) => {
      await h.sleep(800);
      await h.keys.tap("w"); await h.sleep(120); await h.keys.tap("w");
      await h.mark("autosail");
      await h.sleep(4000);
      await h.keys.hold(["a"], 1400);
      await h.sleep(5500);
      await h.keys.tap("s");
      await h.sleep(600);
    },
  }),
  ui("ui-sail-hud-islands", {
    dur: 12,
    note: "Sailing among the Bahamas cays with the HUD (minimap, gold, hold, compass); weaving with A/D.",
    setup: async (h) => h.tp(...h.at(22.2, -74.4), -2.88), // bearing 165, clear of land (landcheck.ts)
    run: async (h) => {
      await h.keys.down("w");
      await h.sleep(3000);
      await h.keys.hold(["d"], 900);
      await h.sleep(3000);
      await h.keys.hold(["a"], 1300);
      await h.sleep(4200);
      await h.keys.up("w");
    },
  }),
  ui("ui-trade-buy-furs", {
    dur: 9,
    note: "Docked at Arkhangelsk: T opens the bill of goods; Furs bought (10) and signed.",
    setup: async (h) => h.tp(...h.dockNear("arkhangelsk", 40), 0),
    run: async (h) => {
      await h.sleep(900);
      await h.keys.tap("t");
      await h.sleep(1600);
      await h.mark("open");
      await order(h, "Buy", "Furs");
      await h.sleep(800);
    },
  }),
  ui("ui-trade-sell-furs", {
    dur: 9,
    note: "Furs bought at Arkhangelsk (off camera), sold at London: T, the Furs sell cell, Max, sign.",
    setup: async (h) => {
      await h.tp(...h.dockNear("arkhangelsk", 40), 0);
      await h.sleep(800);
      await h.keys.tap("t");
      await h.sleep(1800);
      await order(h, "Buy", "Furs", { chip: "max" });
      await h.page.evaluate(() => document.querySelector('[data-fk="close"]')?.click());
      await h.sleep(800);
      await h.tp(...h.dockNear("london", 40), 0);
    },
    run: async (h) => {
      await h.sleep(900);
      await h.keys.tap("t");
      await h.sleep(1600);
      await h.mark("open");
      await order(h, "Sell", "Furs", { chip: "max" });
      await h.sleep(800);
    },
  }),
  ui("ui-trade-buy-silver", {
    dur: 9,
    note: "Docked at Callao: Silver bought on the bill of goods.",
    setup: async (h) => h.tp(...h.dockNear("callao", 40), 0),
    run: async (h) => {
      await h.sleep(900);
      await h.keys.tap("t");
      await h.sleep(1600);
      await h.mark("open");
      await order(h, "Buy", "Silver", { chip: "max" });
      await h.sleep(800);
    },
  }),
  ui("ui-world-map", {
    dur: 12,
    note: "M opens the world chart: the whole world (60 ports), wheel-zoom into the Caribbean, drag to Europe, zoom back out.",
    setup: async (h) => h.tp(...h.dockNear("havana", 700), 0),
    run: async (h) => {
      const { width: w, height: ht } = h.viewport;
      await h.keys.tap("m");
      await h.sleep(1800);
      await h.mark("open");
      await h.page.mouse.move(w * 0.5, ht * 0.5, { steps: 10 });
      for (let i = 0; i < 14; i++) { await h.page.mouse.wheel(0, -60); await h.sleep(70); }
      await h.sleep(1200);
      await h.page.mouse.down();
      await h.page.mouse.move(w * 0.2, ht * 0.45, { steps: 90 });
      await h.page.mouse.up();
      await h.mark("dragged");
      await h.sleep(1200);
      for (let i = 0; i < 14; i++) { await h.page.mouse.wheel(0, 60); await h.sleep(70); }
      await h.sleep(1800);
    },
  }),
  ui("ui-leaderboard", {
    dur: 7,
    note: "Tab: the gold leaderboard over open water (invented captains on a private test database).",
    setup: async (h) => h.tp(...h.at(18.0, -62.0), 0),
    run: async (h) => {
      await h.sleep(1200);
      await h.keys.down("Tab");
      await h.sleep(800);
      await h.mark("open");
      await h.sleep(4200);
      await h.keys.up("Tab");
      await h.sleep(1000);
    },
  }),
  ui("ui-combat-hud", {
    dur: 12, plates: "others",
    note: "Combat with the HUD: pirate brigantine on the beam, broadsides; enemy health bar and nameplate, reload gauges.",
    setup: async (h) => { await h.tp(...h.at(15.0, -72.0), WEST); await spawnRel(h, { a: "pirate", ship: "brigantine", beam: 80 }); },
    run: async (h) => fight(h, 12600, { duty: 0.15 }),
  }),
];

export const FOOTAGE = [...SCENIC, ...BATTLES, ...PORTS, ...UI];
