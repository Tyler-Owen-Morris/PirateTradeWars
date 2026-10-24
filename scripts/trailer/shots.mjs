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

export const SHOTS = [
  {
    id: "hero-dawn",
    mode: "frames",
    dur: 4,
    ship: "galleon",
    note: "Orbit the parked galleon at open sea, low and close; sky and ocean do the work.",
    setup: async (h) => h.tp(...h.at(18.0, -62.0), 0), // open Atlantic east of the Bahamas
    path: orbit({ ship: true }, { r: 260, h: 70, yaw0: 200, yaw1: 140, dur: 4, lookY: 25 }),
  },
  {
    id: "sail-run",
    mode: "realtime",
    dur: 6,
    ship: "galleon",
    note: "Chase camera, W held, gentle S-turn. Wake and sails; no HUD.",
    setup: async (h) => h.tp(...h.at(21.5, -75.0), -Math.PI / 2),
    run: async (h) => {
      await h.keys.hold(["w"], 6000);
    },
  },
  {
    id: "havana-approach",
    mode: "frames",
    dur: 5,
    ship: "galleon",
    note: "Rise over the harbour mouth towards Havana: fort, quay, red roofs.",
    setup: async (h) => h.tp(...h.dockNear("havana", 900), 0),
    path: push({ port: "havana" }, { x: 0, y: 70, z: 650 }, { x: 150, y: 190, z: 380 }, 5, { x: 0, y: 10, z: 0 }),
  },
  {
    id: "trade-screen",
    mode: "realtime",
    dur: 5,
    ship: "galleon",
    note: "Dock at Port Royal, press T, buy a couple of goods on the bill of sale. Real UI, no mock-ups.",
    setup: async (h) => h.tp(...h.dockNear("port_royal", 40), 0),
    run: async (h) => {
      await h.sleep(800);
      await h.keys.tap("t");
      await h.sleep(4000);
    },
  },
  {
    id: "world-map",
    mode: "realtime",
    dur: 4,
    ship: "galleon",
    note: "Press M; slow drag from the Caribbean across the Atlantic to Europe.",
    setup: async (h) => h.tp(...h.dockNear("port_royal", 600), 0),
    run: async (h) => {
      await h.keys.tap("m");
      await h.sleep(800);
      const { width: w, height: ht } = h.viewport;
      await h.page.mouse.move(w * 0.3, ht * 0.5);
      await h.page.mouse.down();
      await h.page.mouse.move(w * 0.7, ht * 0.45, { steps: 90 });
      await h.page.mouse.up();
      await h.sleep(1200);
    },
  },
  {
    id: "amsterdam-dusk",
    mode: "frames",
    dur: 4,
    ship: "galleon",
    note: "Second town for variety: gabled Dutch waterfront, slow orbit from the sea.",
    setup: async (h) => h.tp(...h.dockNear("amsterdam", 900), 0),
    path: orbit({ port: "amsterdam" }, { r: 620, h: 150, yaw0: -25, yaw1: 25, dur: 4, lookY: 10 }),
  },
  {
    id: "broadside",
    mode: "realtime",
    dur: 9,
    ship: "man-o-war",
    note: "A pirate sloop closes; line up the beam, Q/E broadside, splinters, hit flashes. Needs devtp + devnpc patch (docs/world/qa/scripts/devtp.patch).",
    setup: async (h) => {
      await h.tp(...h.at(18.5, -75.5), 0);
      const me = await h.me();
      // pirate sloop 90 units off the port beam, same heading (as in docs/world/qa/scripts/n2.mjs)
      await h.page.evaluate(([x, z, r]) => window.__net.send({ t: "devnpc", a: "pirate", x, z, ship: "sloop", r }), [me.x - 90 / 0.95, me.z, me.r]);
    },
    run: async (h) => {
      await h.keys.hold(["w"], 2500);
      await h.keys.tap("q");
      await h.sleep(900);
      await h.keys.tap("q");
      await h.sleep(1500);
      await h.keys.tap("e");
      await h.sleep(2500);
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
    mode: "realtime",
    dur: 3,
    ship: "galleon",
    note: "Hold Tab over open water. Check first that no real player names (kids) are on the board; use a private Redis with bot names.",
    setup: async (h) => h.tp(...h.at(18.0, -62.0), 0),
    run: async (h) => {
      await h.keys.hold(["Tab"], 2500);
    },
  },
];

export const byId = (id) => SHOTS.find((s) => s.id === id);
