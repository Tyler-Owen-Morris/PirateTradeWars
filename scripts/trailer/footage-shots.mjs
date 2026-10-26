// Raw footage pack shots (docs/trailer/FOOTAGE.md). Same shot format as shots.mjs; capture.mjs looks here first.
// Capture with --size 2560x1440 (16:9) or --aspect 9x16 (1080x1920). Ids: sc-* scenic, bt-* battles, pt-* ports, ui-*.
// Heading convention (NOTES.md): forward = (-sin r, -cos r) in (east, south): r = PI sails north, r = 0 south,
// r = -PI/2 east, r = PI/2 west. Ship-relative path axes: -z ahead, +z astern, +x starboard. Paths should run ~1-2 s
// longer than dur (the camera holds its last pose after the path ends).
import { orbit, portShot, townShot, parkAtPort, trackPair } from "./shots.mjs";

const NORTH = Math.PI, SOUTH = 0, EAST = -Math.PI / 2, WEST = Math.PI / 2;
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

/** Frames: camera-only flight anchored on lat/lon (own ship parked out of frame unless `shipAt`). */
function aerial(id, o) {
  return {
    id,
    mode: "frames",
    dur: o.dur,
    ship: "galleon",
    settleMs: o.settleMs ?? 7000,
    note: o.note,
    setup: async (h) => h.tp(...h.at(...(o.shipAt ?? [o.lat + 3, o.lon])), o.shipR ?? 0),
    path: (h) => {
      const ks = typeof o.keys === "function" ? o.keys(h) : o.keys;
      return ks.map((k, i) => ({ t: k.t ?? (o.dur * i) / (ks.length - 1), anchor: { lat: o.lat, lon: o.lon }, cam: k.cam, look: k.look ?? { x: 0, y: 0, z: 0 }, ease: k.ease ?? (ks.length > 2 ? "linear" : "smooth") }));
    },
  };
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
async function fight(h, ms, { duty = 1, steer = true, range = 420, cool = 2300, fire = true } = {}) {
  const t0 = Date.now();
  const last = { q: -1e9, e: -1e9 };
  let turning = null, wOn = false;
  const log = [];
  const setW = async (on) => { if (on !== wOn) { if (on) await h.keys.down("w"); else await h.keys.up("w"); wOn = on; } };
  while (Date.now() - t0 < ms) {
    const t = Date.now() - t0;
    await setW(duty >= 1 || t % 400 < 400 * duty);
    const all = (await relAll(h)).filter((n) => !n.sunk);
    if (fire) {
      for (const n of all) {
        if (n.d > range || Math.abs(n.along) > 130) continue;
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
  console.log("  volleys", JSON.stringify(log));
}

/**
 * In-page group camera: frames the own ship (includeMe) and the NPCs within `radius` at the start (locked), from a
 * world bearing (deg, 0 = north of the group, turning `spin` deg/s), distance from the group's spread, smoothed.
 */
async function trackGroup(h, { bearing = 200, spin = 0, high = 0.45, distK = 1.5, minD = 220, maxD = 700, includeMe = true, radius = 800, k = 0.05, lookY = 10 } = {}) {
  await h.page.evaluate((o) => {
    const net = window.__net;
    let lock = null, a = null, D = null, raf = 0, stop = false;
    const t0 = performance.now();
    const tick = () => {
      if (stop) return;
      const me = net.getOwnRenderState(), rt = net.remoteRenderTime();
      const mx = Math.cos(((90 - (me.z / 200000) * 180) * Math.PI) / 180);
      const pts = o.includeMe ? [{ x: me.x, z: me.z }] : [];
      const seen = [];
      for (const e of net.remote.renderable()) {
        if (!e.meta?.npc) continue;
        const p = net.remote.sample(e.eid, rt); if (!p) continue;
        if (lock ? lock.includes(e.eid) : Math.hypot((p.x - me.x) * mx, p.z - me.z) < o.radius) { pts.push({ x: p.x, z: p.z }); seen.push(e.eid); }
      }
      if (!lock && seen.length) lock = seen;
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
  }, { bearing, spin, high, distK, minD, maxD, includeMe, radius, k, lookY });
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
    note: o.note,
    settleMs: o.settleMs ?? 1500,
    setup: async (h) => {
      await h.tp(...h.at(o.lat, o.lon), o.r);
      for (const n of o.npcs) await spawnRel(h, n);
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
    dur: 10, lat: 22.2, lon: -74.4, r: NORTH, duty: 0.7,
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
    keys: [{ cam: { x: -600, y: 380, z: 200 }, look: { x: -200, y: 0, z: -250 } }, { cam: { x: -350, y: 380, z: -350 }, look: { x: 50, y: 0, z: -600 } }],
  }),
  aerial("sc-ice-cliff-dolly", {
    dur: 10, lat: 71.97, lon: 30.0,
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
  {
    id: "sc-ice-orbit-man-o-war",
    mode: "frames",
    dur: 10,
    ship: "man-o-war",
    settleMs: 7000,
    note: "Man-o'-war hove to under the 72 N ice cliff; slow low orbit.",
    setup: async (h) => h.tp(...h.at(71.93, 31.0), EAST),
    path: orbit({ ship: true }, { r: 175, h: 30, yaw0: 120, yaw1: 200, dur: 10, lookY: 34, n: 16 }),
  },
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
  {
    id: "sc-reveal-havana",
    mode: "frames",
    dur: 12,
    ship: "galleon",
    settleMs: 8000,
    note: "Reveal: from open sea low over the water, the camera pushes in and rises until Havana and the Morro fill the frame.",
    setup: parkAtPort("havana", 40, 110),
    path: portShot("havana", [{ d: 1300, h: 14, s: -120, ld: 0, lh: 30 }, { d: 600, h: 40, s: -60, ld: -20, lh: 15 }, { d: 230, h: 70, s: 10, ld: -50, lh: 0 }], 12),
  },
  sailShot("sc-convoy-merchants", {
    dur: 10, lat: 15.0, lon: -66.0, r: WEST, duty: 0.6,
    npcs: [{ a: "merchant", f: "england", ship: "brigantine", ahead: 220, beam: -70 }, { a: "merchant", f: "england", ship: "sloop", ahead: 380, beam: 40 }, { a: "merchant", f: "england", ship: "brigantine", ahead: 520, beam: -40 }],
    note: "Our galleon following a small English merchant convoy (spawned) across the Caribbean; high camera astern.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: 60, y: 140, z: 260 }, look: { x: 0, y: 0, z: -320 } },
      { t: 12, anchor: { ship: true }, rot: "ship", cam: { x: -80, y: 120, z: 230 }, look: { x: 0, y: 0, z: -360 } },
    ],
  }),
  sailShot("sc-ships-passing", {
    dur: 9, lat: 15.0, lon: -66.0, r: WEST, duty: 0.6,
    npcs: [{ a: "navy", f: "england", ship: "man-o-war", ahead: 900, beam: 110, rel: Math.PI }],
    note: "An English Navy man-o'-war passes close on the opposite course (no shots), camera low between the ships.",
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: 70, y: 18, z: 60 }, look: { x: 60, y: 22, z: -300 } },
      { t: 11, anchor: { ship: true }, rot: "ship", cam: { x: 60, y: 22, z: 140 }, look: { x: 90, y: 22, z: 200 } },
    ],
  }),
];

// Restart the server before each battle take (spawned NPCs never despawn).
const BATTLES = [
  battle("bt-spanish-pass", {
    dur: 11, lat: 15.5, lon: -70.0, r: NORTH, preMs: 600,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 700, beam: 200, rel: Math.PI }],
    note: "Spanish Navy man-o'-war on the opposite course; broadsides as it comes abeam, it returns fire. Two-shot tracker.",
    camera: (h) => trackPair(h),
  }),
  battle("bt-spanish-pass-wide", {
    dur: 11, lat: 15.5, lon: -70.0, r: NORTH, preMs: 600,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 700, beam: 200, rel: Math.PI }],
    note: "Same action, wide high angle (slow group camera).",
    camera: (h) => trackGroup(h, { bearing: 250, high: 0.5, distK: 1.4, minD: 380, maxD: 750, k: 0.03 }),
  }),
  battle("bt-english-pass", {
    dur: 11, lat: 49.6, lon: -4.0, r: EAST, preMs: 600,
    npcs: [{ a: "navy", f: "england", ship: "man-o-war", ahead: 700, beam: -200, rel: Math.PI }],
    note: "English Channel: English Navy man-o'-war passing to port, broadsides exchanged (we fire first).",
    camera: (h) => trackPair(h),
  }),
  battle("bt-russian-pass", {
    dur: 11, lat: 66.0, lon: 4.0, r: NORTH, preMs: 600,
    npcs: [{ a: "navy", f: "russia", ship: "man-o-war", ahead: 700, beam: 200, rel: Math.PI }],
    note: "Norwegian Sea: Russian Navy man-o'-war, broadsides on the pass, camera from astern and high.",
    camera: (h) => trackPair(h, { portrait: true, high: 1.3 }),
  }),
  battle("bt-sink-sloop", {
    dur: 12, lat: 18.5, lon: -66.5, r: WEST,
    npcs: [{ a: "pirate", ship: "sloop", beam: 70 }],
    note: "Pirate sloop on the starboard beam: broadsides until she sinks (sink animation).",
    fight: { duty: 0.35, range: 300 },
    camera: (h) => trackPair(h),
  }),
  battle("bt-sink-close", {
    dur: 12, lat: 18.5, lon: -66.5, r: WEST,
    npcs: [{ a: "pirate", ship: "sloop", beam: 75 }],
    note: "Close on the pirate sloop from beyond her: splashes and hits, then she goes down; our galleon firing behind.",
    fight: { duty: 0.3, range: 300 },
    camera: (h) => trackEnemy(h, { dist: 80, height: 16, lookBias: 0.4, sideways: 30 }),
  }),
  battle("bt-brigantine-duel-close", {
    dur: 12, lat: 18.5, lon: -66.5, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 80 }],
    note: "Pirate brigantine close aboard; low camera beside her, cannonball splashes and smoke close up.",
    fight: { duty: 0.4, range: 320 },
    camera: (h) => trackEnemy(h, { dist: 60, height: 10, lookBias: 0.55, sideways: -60 }),
  }),
  battle("bt-pursuit", {
    dur: 12, lat: 17.0, lon: -68.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", ahead: -380, beam: 60 }],
    note: "Pursuit: a pirate brigantine runs us down from astern; low camera beyond the pirate, our galleon ahead.",
    fight: { duty: 0.75, steer: false, range: 300 },
    camera: (h) => trackEnemy(h, { dist: 120, height: 22, lookBias: 0.6, sideways: 20, k: 0.05 }),
  }),
  battle("bt-pursuit-ahead", {
    dur: 12, lat: 17.0, lon: -68.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", ahead: -380, beam: 60 }],
    note: "Pursuit, reverse angle: from beyond our galleon looking back at the pirate closing in.",
    fight: { duty: 0.75, steer: false, range: 300 },
    camera: (h) => trackPair(h, { portrait: true, high: 0.8 }),
  }),
  battle("bt-melee-3", {
    dur: 14, lat: 18.0, lon: -66.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 160, ahead: 120 }, { a: "pirate", ship: "brigantine", beam: -170, ahead: 60 }, { a: "pirate", ship: "sloop", ahead: 300, beam: 30, rel: Math.PI }],
    note: "Melee: our galleon against three pirates (two brigantines, a sloop), broadsides both sides; slow orbiting wide camera.",
    fight: { duty: 0.5, range: 380, cool: 2000 },
    camera: (h) => trackGroup(h, { bearing: 160, spin: 5, high: 0.55, distK: 1.3, minD: 300, maxD: 650, k: 0.04 }),
  }),
  battle("bt-melee-3-low", {
    dur: 14, lat: 18.0, lon: -66.0, r: WEST,
    npcs: [{ a: "pirate", ship: "brigantine", beam: 160, ahead: 120 }, { a: "pirate", ship: "brigantine", beam: -170, ahead: 60 }, { a: "pirate", ship: "sloop", ahead: 300, beam: 30, rel: Math.PI }],
    note: "Melee, second angle: low two-shot on the nearest pirate.",
    fight: { duty: 0.5, range: 380, cool: 2000 },
    camera: (h) => trackPair(h, { high: 0.7 }),
  }),
  battle("bt-navy-vs-pirates", {
    dur: 14, lat: 19.0, lon: -69.0, r: WEST,
    npcs: [{ a: "navy", f: "spain", ship: "man-o-war", ahead: 0, beam: 650, rel: Math.PI / 2 }, { a: "pirate", ship: "brigantine", ahead: 260, beam: 650, rel: -Math.PI / 2 }, { a: "pirate", ship: "brigantine", ahead: -260, beam: 650, rel: -Math.PI / 2 }],
    note: "Spanish Navy man-o'-war against two pirate brigantines (NPC vs NPC, our ship hove to out of frame); wide group camera.",
    script: async (h) => { await h.sleep(14600); },
    camera: (h) => trackGroup(h, { includeMe: false, bearing: 90, spin: 3, high: 0.45, distK: 1.4, minD: 300, maxD: 650, radius: 1100, k: 0.04 }),
  }),
];

export const FOOTAGE = [...SCENIC, ...BATTLES];
