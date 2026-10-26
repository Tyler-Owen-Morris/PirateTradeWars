// Shot definitions for the trailer capture (see docs/trailer/STORYBOARD.md for the intent of each shot).
//
// A shot is { id, mode, dur, ship, setup(h), path?, run?(h), needs? }:
//   mode "frames"   : deterministic frame-by-frame capture. The page clock is virtual and stepped 1/fps per
//                     frame; the camera follows `path` (window.__trailer, client/src/lib/trailer/path.ts).
//                     The own ship is PARKED (no input), so use it for scenery: ports, coast, ocean, UI.
//   mode "realtime" : headed browser recorded live with ffmpeg gdigrab; `run(h)` plays the keyboard script.
//                     Use it for anything where the ship, NPCs or cannonballs move.
//   dur             : seconds of footage wanted.
//   needs           : "expansion" = needs the Baltic/Arctic/North Pacific expansion merged; skipped otherwise.
//
// Camera numbers (render units, 1 unit = 100 m; the chase camera sits at (0, 250, 400) from the ship) are a
// FIRST GUESS made without running the game. Tune them on the first dry run with `--preview` (writes a
// single PNG per shot at t=0, mid and end) before spending the full capture time.
//
// h = { page, tp(x,z,r), dock(key), keys: {hold, tap}, sleep }.

const O = { x: 0, y: 0, z: 0 };

/** Orbit around an anchor: n+1 linear keyframes from yaw0 to yaw1 (degrees, 0 = camera north of anchor). */
export function orbit(anchor, { r, h, yaw0, yaw1, dur, lookY = 12, rot, n = 12, t0 = 0 }) {
  const ks = [];
  for (let i = 0; i <= n; i++) {
    const a = ((yaw0 + ((yaw1 - yaw0) * i) / n) * Math.PI) / 180;
    ks.push({
      t: t0 + (dur * i) / n,
      anchor,
      cam: { x: Math.sin(a) * r, y: h, z: -Math.cos(a) * r },
      look: { x: 0, y: lookY, z: 0 },
      rot,
      ease: i === 0 || i === n - 1 ? "smooth" : "linear",
    });
  }
  return ks;
}

/** Slow push from one offset to another around the same anchor (smooth in and out). */
export function push(anchor, from, to, dur, look = { x: 0, y: 10, z: 0 }, rot) {
  return [
    { t: 0, anchor, cam: from, look, rot },
    { t: dur, anchor, cam: to, look, rot },
  ];
}

/**
 * Port shot in the port's own "seaward" frame (so it works for any coast orientation): each pose is
 * { d: metres-ish render units out to sea from the dock, h: height, s: sideways (+ = right when looking at
 * the town from the sea), ld/lh/ls: the same for the look-at point (default: the dock, 10 up) }.
 * Returns a function of the capture helpers h (capture.mjs resolves `path` functions after setup).
 */
export function portShot(key, poses, dur, posesPortrait) {
  return (h) => {
    if (h.aspect === "9x16" && posesPortrait) poses = posesPortrait; // portrait frames need their own poses
    const p = h.port(key);
    let ux = p.dock.x - p.x, uz = p.dock.z - p.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l; // seaward
    const rx = uz, rz = -ux; // sideways axis (check the framing with --preview)
    const off = (d, hh, s) => ({ x: ux * d + rx * s, y: hh, z: uz * d + rz * s });
    return poses.map((q, i) => ({
      t: (dur * i) / (poses.length - 1),
      anchor: { port: key },
      cam: off(q.d, q.h, q.s ?? 0),
      look: off(q.ld ?? 0, q.lh ?? 10, q.ls ?? 0),
      ease: q.ease ?? (poses.length > 2 ? "linear" : "smooth"),
    }));
  };
}

/**
 * Park the own ship in the same seaward frame as portShot: d out to sea, s sideways (same axis as portShot),
 * heading along the coast (broadside to a camera out at sea). World x is divided by cos(lat) like dockNear.
 */
export function parkAtPort(key, d, s, sPortrait = s) {
  return async (h) => {
    if (h.aspect === "9x16") s = sPortrait;
    const p = h.port(key);
    let ux = p.dock.x - p.x, uz = p.dock.z - p.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    const rx = uz, rz = -ux;
    const mx = Math.max(0.01, Math.cos(((90 - (p.dock.z / 200000) * 180) * Math.PI) / 180));
    const ox = ux * d + rx * s, oz = uz * d + rz * s;
    const r = Math.atan2(rx, rz);
    await h.tp(p.dock.x + ox / mx, p.dock.z + oz, r);
  };
}

/**
 * Realtime "two-shot" camera for combat: every frame it frames the own ship AND the nearest NPC (they move,
 * so a fixed ship-relative path loses the enemy within seconds). Landscape: camera off to the side of the
 * line between them (ships side by side). Portrait: camera behind our ship along that line (ships stacked).
 * Smoothed; keeps the camera on the same side. Runs in the page until window.__trackStop() is called.
 */
export async function trackPair(h, { portrait = h.aspect === "9x16" } = {}) {
  await h.page.evaluate((portrait) => {
    const net = window.__net;
    let ax = null, az = null, ox = 0, oy = 0, oz = 0, side = 1, raf = 0, stop = false, lock = null; // lock = target eid
    const tick = () => {
      if (stop) return;
      const me = net.getOwnRenderState();
      const rt = net.remoteRenderTime();
      // Lock onto the nearest NPC at the start (the spawned enemy) and stay on it; switching targets whips the camera.
      let best = null;
      for (const e of net.remote.renderable()) {
        if (!e.meta?.npc || (lock !== null && e.eid !== lock)) continue;
        const p = net.remote.sample(e.eid, rt);
        if (!p) continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < 900 && (!best || d < best.d)) best = { x: p.x, z: p.z, d, eid: e.eid };
      }
      if (best && lock === null) lock = best.eid;
      const mx = Math.cos(((90 - (me.z / 200000) * 180) * Math.PI) / 180);
      const tx = best ? (me.x + best.x) / 2 : me.x, tz = best ? (me.z + best.z) / 2 : me.z;
      let lx = best ? (best.x - me.x) * mx : 1, lz = best ? best.z - me.z : 0; // line us -> enemy (render units)
      const sep = Math.hypot(lx, lz) || 1;
      lx /= sep; lz /= sep;
      const px = -lz, pz = lx; // perpendicular
      const D = Math.min(portrait ? 300 : 260, Math.max(140, sep * (portrait ? 1.4 : 1.05)));
      const want = (s) => portrait
        ? [-lx * D * 0.75 + px * s * D * 0.35, -lz * D * 0.75 + pz * s * D * 0.35]
        : [px * s * D - lx * D * 0.25, pz * s * D - lz * D * 0.25];
      let [cx, cz] = want(side);
      if ((ox || oz) && cx * ox + cz * oz < 0) { side = -side; [cx, cz] = want(side); } // stay on the same side
      const cy = D * (portrait ? 0.55 : 0.42);
      const k = ax === null ? 1 : 0.06;
      ax = ax === null ? tx : ax + (tx - ax) * k;
      az = az === null ? tz : az + (tz - az) * k;
      ox += (cx - ox) * k; oy += (cy - oy) * k; oz += (cz - oz) * k;
      window.__trailer.setPath([{ t: 0, anchor: { x: ax, z: az }, cam: { x: ox, y: oy, z: oz }, look: { x: 0, y: 8, z: 0 } }]);
      window.__trailer.seek(0);
      raf = requestAnimationFrame(tick);
    };
    window.__trackStop = () => { stop = true; cancelAnimationFrame(raf); };
    tick();
  }, portrait);
}

export const SHOTS = [
  {
    id: "hero-dawn",
    mode: "frames",
    dur: 4,
    ship: "galleon",
    note: "Orbit the parked galleon at open sea, low and close; sky and ocean do the work.",
    setup: async (h) => h.tp(...h.at(18.0, -62.0), 0), // open Atlantic east of the Bahamas
    path: (h) =>
      h.aspect === "9x16"
        ? orbit({ ship: true }, { r: 125, h: 26, yaw0: 215, yaw1: 160, dur: 4, lookY: 42 })
        : orbit({ ship: true }, { r: 150, h: 32, yaw0: 215, yaw1: 150, dur: 4, lookY: 38 }),
  },
  {
    id: "ship-select",
    lobby: true,
    mode: "realtime",
    dur: 4,
    note: "The real ship selection screen (before joining): name typed, each ship card picked in turn (ships are free).",
    setup: async () => {},
    run: async (h) => {
      const pick = async (s) => {
        const el = h.page.locator(`[data-testid="cypress-${s}-card"]`);
        const b = await el.boundingBox();
        if (b) await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
        await el.click();
      };
      await h.sleep(500);
      for (const s of ["sloop", "brigantine", "galleon", "man-o-war"]) {
        await pick(s);
        await h.sleep(850);
        await h.mark(s);
      }
      await pick("galleon");
      await h.sleep(700);
    },
  },
  {
    id: "sail-run",
    mode: "realtime",
    dur: 6,
    ship: "galleon",
    note: "Close low chase (ship-relative camera path), under way before recording; islands pass. No HUD.",
    setup: async (h) => h.tp(...h.at(21.5, -75.0), -Math.PI / 2),
    pre: async (h) => h.keys.down("w"),
    path: [
      { t: 0, anchor: { ship: true }, rot: "ship", cam: { x: -110, y: 38, z: 120 }, look: { x: 0, y: 30, z: -60 } },
      { t: 7, anchor: { ship: true }, rot: "ship", cam: { x: -45, y: 55, z: 190 }, look: { x: 0, y: 30, z: -80 } },
    ],
    run: async (h) => {
      await h.sleep(6600); // path is 7 s; stop before the camera freezes at its last pose
      await h.keys.up("w");
    },
  },
  {
    id: "havana-approach",
    mode: "frames",
    dur: 5,
    ship: "galleon",
    note: "Rise from the water towards Havana: Morro, quay, red roofs; own galleon anchored left of the docks.",
    setup: parkAtPort("havana", 40, 110, 35),
    path: portShot("havana", [{ d: 230, h: 22, s: -70, ld: -20, lh: 14 }, { d: 195, h: 60, s: 15, ld: -50, lh: 0 }], 5, [{ d: 270, h: 30, s: -10, ld: -30, lh: 14, ls: 15 }, { d: 215, h: 70, s: 15, ld: -55, lh: 0, ls: 15 }]),
  },
  {
    id: "callao",
    mode: "frames",
    dur: 4.5,
    ship: "galleon",
    note: "Americas expansion port (live): Callao and the Real Felipe star fort, sideways truck with the galleon at anchor.",
    setup: parkAtPort("callao", 40, 110, 35),
    path: portShot("callao", [{ d: 215, h: 32, s: 140, ld: -40, lh: 12 }, { d: 190, h: 55, s: -30, ld: -40, lh: 8 }], 4.5, [{ d: 270, h: 30, s: -10, ld: -30, lh: 14, ls: 15 }, { d: 215, h: 70, s: 15, ld: -55, lh: 0, ls: 15 }]),
  },
  {
    id: "trade-screen",
    hud: true,
    mode: "realtime",
    dur: 5,
    ship: "galleon",
    note: "Dock at Port Royal, press T, buy a couple of goods on the bill of sale. Real UI, no mock-ups.",
    setup: async (h) => h.tp(...h.dockNear("port_royal", 40), 0),
    run: async (h) => {
      // The "Port Royal - press T to trade" prompt is on screen at the start; then the bill of goods opens
      // and two real purchases are signed (BillOfGoods.tsx: aria-label "Buy <good> at <n> gold", chips, #tb-sign).
      const click = async (sel) => { const el = h.page.locator(sel).first(); const b = await el.boundingBox(); if (b) await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await el.click(); };
      await h.sleep(900);
      await h.keys.tap("t");
      await h.sleep(1400);
      await h.mark("open");
      await click('[aria-label^="Buy Sugar at"]');
      await h.sleep(700);
      await click('[data-fk="q:10"]');
      await h.sleep(800);
      await h.mark("order");
      await click("#tb-sign");
      await h.sleep(1300);
      await click('[aria-label^="Buy Rum at"]');
      await h.sleep(600);
      await click('[data-fk="q:10"]');
      await h.sleep(700);
      await click("#tb-sign");
      await h.sleep(1300);
      await h.mark("end");
    },
  },
  {
    id: "world-map",
    hud: true,
    mode: "realtime",
    dur: 4,
    ship: "galleon",
    note: "Press M; slow drag from the Caribbean across the Atlantic to Europe.",
    setup: async (h) => h.tp(...h.dockNear("port_royal", 600), 0),
    run: async (h) => {
      await h.keys.tap("m");
      await h.sleep(900);
      await h.mark("open");
      const { width: w, height: ht } = h.viewport;
      // Map opens centred on the ship (Caribbean). Dragging LEFT pans east: across the Atlantic to Europe/Africa.
      await h.page.mouse.move(w * 0.75, ht * 0.5);
      await h.page.mouse.down();
      await h.page.mouse.move(w * 0.25, ht * 0.55, { steps: 120 });
      await h.page.mouse.up();
      await h.mark("dragged");
      await h.sleep(1000);
    },
  },
  {
    id: "amsterdam",
    mode: "frames",
    dur: 4,
    ship: "galleon",
    note: "European town for variety: gabled Dutch waterfront and windmills, sideways truck (the sky is fixed: no real dusk).",
    setup: parkAtPort("amsterdam", 40, 110, 35),
    path: portShot("amsterdam", [{ d: 215, h: 32, s: 140, ld: -40, lh: 12 }, { d: 190, h: 55, s: -30, ld: -40, lh: 8 }], 4, [{ d: 270, h: 30, s: -10, ld: -30, lh: 14, ls: 15 }, { d: 215, h: 70, s: 15, ld: -55, lh: 0, ls: 15 }]),
  },
  {
    id: "broadside",
    hud: true,
    plates: "others",
    mode: "realtime",
    dur: 14,
    ship: "galleon",
    note: "Pirate brigantine spawned on the starboard beam; E broadsides (starboard), it fights back. HUD + nameplates on (health bars). Needs devtp + devnpc patch.",
    setup: async (h) => {
      await h.tp(...h.at(18.5, -75.5), 0);
      const me = await h.me();
      // Starboard of heading r is (cos r, -sin r) in world x/z (x scaled by cos(lat)); see docs/world/qa/scripts/n2.mjs.
      const mx = Math.cos(18.5 * Math.PI / 180), d = h.beam ?? 65;
      await h.npc({ a: "pirate", ship: h.enemy ?? "brigantine" /* tan sails read apart from our red galleon */, x: me.x + (Math.cos(me.r) * d) / mx, z: me.z - Math.sin(me.r) * d, r: me.r });
    },
    // Camera: trackPair() (two-shot that follows both ships; the enemy manoeuvres out of any fixed framing).
    run: async (h) => {
      // Fire at once: the spawned pirate starts stationary on the beam, but turns away within a few seconds.
      // (Manually spawned NPCs are never despawned: restart the server before a final take, or the area fills up.)
      await trackPair(h);
      await h.sleep(500);
      await h.mark("before");
      for (let i = 0; i < 4; i++) {
        await h.keys.tap("e");
        await h.sleep(900);
        await h.mark("e" + i);
        await h.sleep(2200);
      }
      await h.mark("end");
      await h.page.evaluate(() => window.__trackStop());
    },
  },
  {
    id: "northern-seas",
    mode: "frames",
    dur: 5,
    ship: "galleon",
    needs: "expansion",
    note: "NEEDS EXPANSION. Baltic/Arctic: pack ice, a Russian/Baltic port under snow. Port keys are placeholders: replace with the merged ports.json ids (e.g. archangel, saint_petersburg, stockholm).",
    setup: async (h) => h.tp(...h.dockNear(h.firstPort(["archangel", "saint_petersburg", "stockholm"]), 900), 0),
    path: push({ port: "archangel" }, { x: 0, y: 60, z: 700 }, { x: 120, y: 170, z: 420 }, 5),
  },
  {
    id: "leaderboard",
    hud: true,
    mode: "realtime",
    dur: 3,
    ship: "galleon",
    note: "Hold Tab over open water. Check first that no real player names (kids) are on the board; use a private Redis with bot names.",
    setup: async (h) => h.tp(...h.at(18.0, -62.0), 0),
    run: async (h) => {
      await h.keys.down("Tab");
      await h.sleep(1200);
      await h.mark("open");
      await h.sleep(3600);
      await h.keys.up("Tab");
    },
  },
];

/** Generic "port-<key>" survey shot for ANY port (used to pick towns: `--shot port-callao --preview`). */
const portSurvey = (key) => ({
  id: "port-" + key,
  mode: "frames",
  dur: 4,
  ship: "galleon",
  note: "Survey: generic seaward push on " + key,
  setup: parkAtPort(key, 40, 110),
  path: portShot(key, [{ d: 215, h: 28, s: 140, ld: -40, lh: 12 }, { d: 190, h: 48, s: -30, ld: -40, lh: 8 }], 4),
});

export const byId = (id) => SHOTS.find((s) => s.id === id) ?? (id.startsWith("port-") ? portSurvey(id.slice(5)) : undefined);
