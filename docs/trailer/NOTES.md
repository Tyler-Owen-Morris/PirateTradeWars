# Trailer: working notes and runbook

State (2026-10-25): **trailer 1 and trailer 2 (the North) are recorded and cut; a raw footage pack for editing is in `FOOTAGE.md`**, both aspects (trailer 2: see "Trailer 2 run log" at the end). The tooling has had
its first live run and the fixes are in (see "Trailer 1 run log" below). Trailer 2 (after the North ships) reuses all of it:
add the north shots to `shots.mjs`, re-capture, re-cut.

| Piece | File |
|---|---|
| Storyboard (both cuts, text, timings) | `docs/trailer/STORYBOARD.md` |
| Music and SFX picks, licences | `docs/trailer/MUSIC.md`, `docs/trailer/assets/{music,sfx}/` |
| Shot list as code (camera paths, key scripts) | `scripts/trailer/shots.mjs` |
| Capture driver | `scripts/trailer/capture.mjs` |
| Captions and end card renderer (HTML to PNG, game fonts) | `scripts/trailer/cards.mjs` |
| Edit pipeline (ffmpeg) | `scripts/trailer/edit.mjs`, `timeline.16x9.json`, `timeline.9x16.json` |
| Client dev hook | `client/src/components/game/useTrailerHooks.ts`, `client/src/lib/trailer/path.ts` (+ test) |

## Client code added (dev-only)

- `useTrailerHooks.ts` (mounted from `GameScene.tsx`): active only if `import.meta.env.DEV` AND the URL has `?trailer=1`.
  `import.meta.env.DEV` is a compile-time `false` in `npm run build`, so production bundles run none of it. It adds `window.__trailer`
  (`setPath`, `seek(t)`, `play()`, `stop()`, `hud(bool)`, `hide([selectors])`, `ship()`, `ports()`).
- It drives the existing dev city camera (`lib/world/cityDebug.ts`). Changes to existing files: `cityDebug.showShip`, the mount line in
  `GameScene.tsx`, and (run 1) `Player.tsx` draws the own ship at its REAL position while the trailer camera is on (it used to be
  drawn at the camera focus, i.e. on the dock in every port shot).
- `&plates=0|others|all` (URL, trailer mode only, `TRAILER_NAMEPLATES`): `0` hides ship nameplates/health bars (`Ship.tsx`) and port
  name labels (`Port.tsx`; their mirrored reflection in the water looked bad); `others` hides only your own (combat: the enemy's
  health bar stays). capture.mjs sets it from `shot.plates` (default `0`).
- Global chat (`[data-testid="chat-panel"]`, `ChatPanel.tsx`) is ALWAYS hidden in trailer mode, HUD on or off.
- `lib/trailer/path.ts`: pure keyframe maths (anchor = port dock / own ship / lat,lon / raw x,z; offsets in render units = world
  units; smooth or linear easing; map-seam aware; optional ship-relative rotation). Tested in `lib/trailer/__tests__/path.test.ts`.
- HUD hiding: `hud(false)` injects `div:has(> div > canvas) ~ * { display:none }` (everything after the R3F canvas wrapper). Verified.

## How capture works (as of run 1)

**Never record the desktop** (Theo may be using the PC). Everything is captured from the page only, in HEADLESS Chromium on the GPU
(`--use-angle=d3d11`; WebGL renderer seen 2026-10-25: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
headless and headed alike). The viewport IS the output size (1920x1080 or 1080x1920), so 9:16 is captured natively, never cropped.

Prereqs:
- Docker Redis on a PRIVATE DB: `REDIS_CONN_STRING=redis://localhost:6379/11` (never the Upstash URL in `.env`). `FLUSHDB` it after.
- Server: `NODE_ENV=development STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy SEGMENT_WRITE_KEY=dev-dummy
  PORT=5150 PTW_DEV_TELEPORT=1 SHIPS_FREE=true npx tsx server/index.ts` (logs to a file, in the background). Do NOT set
  `DEV_START_GOLD`: a 10,000,000 purse on the HUD and the bill of goods looks fake; the galleon's real 800 g buys plenty.
- `git apply docs/world/qa/scripts/devtp.patch` (uncommitted; `git checkout -- server/game/socketHandler.tsx` after).
- `npm ci` in the worktree, then `npm i --no-save playwright@latest` (1.64.1 matched the cached chromium-1248).
- Leaderboard: seed invented captains into DB 11 (`leaderboard` zset + `leaderboard_entry:<id>` hashes `playerId`,
  `playerName`, `achievedAt`), e.g. Calico Meg 48,210 / Black Bart Rowe 41,775 / Anne Tarrow 36,540 / ... Never real names.

Commands:
```
node scripts/trailer/capture.mjs --list
node scripts/trailer/capture.mjs --base http://localhost:5150 --shot callao --aspect 16x9 --preview   # 3 frames (frames) / marks (realtime)
node scripts/trailer/capture.mjs --base http://localhost:5150 --shot "hero-dawn,sail-run" --aspect 9x16
node scripts/trailer/capture.mjs --base http://localhost:5150 --shot port-<key> --preview            # survey ANY port (generic shot)
```
Output: `<repo>/capture/<aspect>/<shot>/` (git-ignored): `00000.png..` (frames) or `00000.jpg..` + `frames.json` (realtime:
capture fps, max gap, repeated frames, the shot's `h.mark()` times on the clip clock - use them for `in` and SFX times).

Modes (per shot in `shots.mjs`):
- **frames**: virtual clock, one screenshot per 1/30 s step; camera path is a pure function of t. Own ship parked. Use for ports,
  the hero orbit. NPC ships still move (server is real time); they looked fine at 1 s review granularity in run 1.
- **realtime**: real clock, CDP `Page.startScreencast` (JPEG q95) during the shot's `run(h)`; the variable-rate frames (38-55 fps
  measured) are resampled to constant 30 fps. A shot can have a camera `path` (played in real time, ship-relative paths follow the
  ship), `pre(h)` (e.g. hold W before recording), `hud`, `plates`, `css`, `lobby` (ship-selection screen, no join).
- **trackPair(h)** (shots.mjs): realtime two-shot for combat; every frame frames the own ship and the NPC nearest at the start
  (locked), smoothed; landscape = from the side, portrait = from behind/above so the ships stack. Fixed paths lost the enemy in 3 s.

Housekeeping built in: every join uses a fresh invented name (`<First> <Last>` from lists; names are unique while a ship is at
sea), and every shot RETIRES (scuttles) its ship when done. Ships persist at sea for hours after a disconnect (galleon 4 h), so
without that the next shots fill with ghost galleons. Manually spawned NPCs (`devnpc`) are never despawned: restart the server
before each combat take (stop it, delete `player:*`, `player_*`, `active_name*` in DB 11, start it).

Memory: one server + one headless browser at a time was fine on this PC (31.8 GB, ~13 GB free); one context per shot, one browser
per run. Nothing was killed.

## How to edit

```
node scripts/trailer/edit.mjs --timeline scripts/trailer/timeline.16x9.json --out <file>.mp4
node scripts/trailer/edit.mjs --timeline scripts/trailer/timeline.9x16.json --out <file>.mp4
node scripts/trailer/edit.mjs --selftest [--aspect 9x16]
```
Timeline clips: `src` = capture folder (png or jpg detected), `in` = seconds skipped, `dur`, optional `caption`/`capIn`/`capDur`,
and clip-relative `sfx: [{ src: <seconds on the clip's source clock>, gainDb }]` (default file `cannon_fire.ogg`); edit.mjs turns
them into timeline times, so re-timing a clip keeps the cannon in sync. Output is TV-range yuv420p (screencast JPGs are full range;
without `scale=out_range=tv` the file came out `yuvj420p`), H.264 High, AAC 192k 48 kHz, two-pass loudnorm to -14 LUFS / -1.5 dBTP.

## Trailer 1 run log (2026-10-25)

Final files (not in git): scratchpad `trailer/v1/ptw-trailer-v1-16x9.mp4` (45.5 s), `ptw-trailer-v1-9x16.mp4` (31.1 s), contact sheets.

What worked / camera values that looked good (all in `shots.mjs`):
- `hero-dawn`: orbit the parked galleon at 18 N 62 W, r 150 h 32 yaw 215->150 lookY 38 (portrait r 125 h 26 lookY 42).
- `sail-run`: ship-relative path cam (-110,38,120)->(-45,55,190), look (0,30,-60)->(0,30,-80), heading -90 deg from 21.5 N 75 W, W held.
- Port shots via `portShot(key, poses)` + `parkAtPort(key, d, s)` in the port's seaward frame. Good: sideways truck
  `[{d:215,h:32,s:140,ld:-40}, {d:190,h:55,s:-30,ld:-40}]`, galleon parked at d 40 s 110 (portrait: separate poses, ship s 35).
  Callao (Real Felipe fort), Amsterdam (gables, windmills), Havana (Morro) all read well; Rio, Cartagena, Port Royal, Lisbon surveyed.
- `trade-screen`: dock at Port Royal, T, click `Buy Sugar at`, chip 10, `#tb-sign`, then Rum. 16:9 is crisp; 9:16 is small.
- `broadside`: galleon vs a `devnpc` pirate BRIGANTINE spawned 65 u on the starboard beam (`(cos r, -sin r)/cos(lat)`), E every 3.2 s,
  `trackPair` camera. The pirate fires back. Busy waters near 18.5 N 75.5 W = navies and privateers join in (good, but restart first).
- `ship-select`: lobby shot, the four cards clicked in turn (all "Free").
- Music: `pirates_orchestra.mp3` measured -16.7 LUFS integrated, peak -2.8 dBFS, LRA 6.6 (not silent, not clipped). Energy by 2 s
  RMS: quiet 0-10 s, high 12-31 s, dip 32-42 s, high 74-106 s (peak 84-96 s), tail-off after 110 s. 16:9 starts at 74 s, 9:16 at 82 s.

Fixes made to the tooling in this run:
1. Realtime capture: desktop `gdigrab` replaced by page-only CDP screencast + constant-fps resample; headless GPU for everything.
2. Own ship was drawn on the dock in port shots (camera focus) -> `Player.tsx` draws it at its real render position.
3. Ghost ships: random names + scuttle after every shot; server restart before combat takes.
4. Nameplates / port labels / chat hiding (`plates`, chat-panel testid).
5. `edit.mjs`: jpg folders, `in` for folders, clip-relative SFX, TV-range output.
6. `portShot` / `parkAtPort` / `trackPair` / `port-<key>` survey shots; portrait-specific poses; `pre`, `lobby`, `css` shot options.
7. Lost time on: the sideways sign in the port frame (just check with `--preview`), a CSS `zoom` on the leaderboard panel that did
   not take (removed), drawtext in ffmpeg needs `fontfile=` on Windows.

Known weaknesses of trailer 1: the sky is the game's fixed noon sky (no sunset exists, so none is shown); 9:16 trade screen text is
small; realtime clips have ~5% repeated frames (screencast jitter, fine at 30 fps); the leaderboard has no caption (it covered rows).

## For trailer 2 (after the North ships)
- Add north shots with `portShot` on the merged port keys (survey with `--shot port-<key> --preview` first) and drop them into both
  timelines (the `northern-seas` entry is a placeholder: replace its port keys and poses). Ice/snow towns: try a higher camera.
- Re-run the full batch per aspect after a server restart; reuse the timelines, swap one port shot for a north one.
- Consider a CSS-zoomed trade panel for 9:16 (find the right selector first) and a caption-safe leaderboard position.

## Trailer 2 run log (2026-10-25, New Horizons phase 2 live: "North of everything")

Resume notes (newest last). Worktree `agent-a0b64b43bd24fb3bf`, branch `worktree-agent-a0b64b43bd24fb3bf`, from main 92c09a4.
Outputs (not in git): session scratchpad `trailer/v2/`.

Setup done:
- `node_modules` = junction to `.claude/worktrees/agent-abb70aea15b1777da/node_modules` (same package.json; has playwright).
- Docker Desktop had to be started (`ptw-redis` was stopped). DB 11 seeded with the invented leaderboard (seed-1..10).
- devtp.patch applied uncommitted. **devtp.patch now passes `f` (faction) to `devnpc`** (needed for a Russian Navy ship:
  `{t:"devnpc", a:"navy", f:"russia"}`); the committed patch file was regenerated.
- Server: as in the runbook, port 5150, `REDIS_CONN_STRING=redis://localhost:6379/11`. Restart + clean = kill the :5150
  listener, delete `player:*`, `player_*`, `active_name*` in DB 11 (keeps the leaderboard).

Owner feedback on trailer 1 (do not reuse as is): (1) sail-run floats at an empty island: sail purposefully, 3-4 s,
INTO a living town / along the ice / past ships; (2) the trade screen lingered: 2.5-3 s, one purchase; (3) combat had
one ship still and the other spinning: both ships moving, enemy (Russian Navy) on a crossing/passing course, short angles.

Tooling changes:
- `portShot`/`parkAtPort`: the seaward direction now scales world x by cos(lat) (`seaward()`); unscaled it was skewed
  (fine at 18 N, badly off at 60 N).
- `townShot(key, poses)`: like portShot but anchored on the TOWN (port point) - northern docks are far from their towns
  (St. Petersburg 487 units, Stockholm 421, Arkhangelsk 428, Bergen 303). `--shot town-<key> --preview` surveys any port.
- New shots: `stpete`, `arkhangelsk`, `sitka`, `bergen` (town frames), `arrive-north` (realtime, sailing into Bergen),
  `ice-edge` (realtime, 71.8 N 38 E heading east), `trade-north` (Arkhangelsk, Furs x10, ~3 s), `world-map-north`,
  `navy-pass` (Russian Navy ship on the opposite course, E as it comes abeam). The `northern-seas` placeholder is gone.
- Heading convention: forward = (sin r, cos r) in (east, south): r 0 = south, PI = north, PI/2 = east.

Survey (town-<key> preview): St. Petersburg (white church, painted houses) and Stockholm/Bergen read well from 250 out;
Arkhangelsk is dark timber with ice floes on the beach (needs a high camera, it sits behind land); Sitka's end pose good.
The north is green land like everywhere else (the game has no snow on land); ice shows as floes and the ice sheet at 72 N.

Run 2 progress (later the same day):
- **Ship speed**: a galleon under full sail covers ~950-1500 render units in 4.6 s (it is a big world). A sailing shot
  must start ~2000+ units out; `pre` (W held through the 3 s settle) already moves it ~700.
- **Ship-relative path axes** (rot:"ship", path.ts): -z = ahead of the bow, +z = astern, +x = starboard. Heading:
  forward = (-sin r, -cos r) in (east, south) (the physics.ts comment reads the other way; this is what the game does).
  r = -PI/2 sails east, r = PI/2 west, r = PI south. The broadside setup's starboard formula (cos r, -sin r) is right.
- `arrive-north`: chase camera from the port quarter, start 60.0 N 26.8 E (mid Gulf of Finland) heading east; the town
  slides past on the right at ~2-3 s. A start computed along the town->dock line from 2000 out landed on a shoal (grounded).
- `ice-edge`: 71.9 N 38 E, r = PI/2 (west): the 72 N ice sheet is a grey cracked cliff to starboard. Camera ahead of the bow
  looking back; portrait has its own path (look further to starboard or the ice is out of frame).
- `navy-pass` / `navy-pass-b`: Russian Navy **man-o-war** forced (`ship`), spawned 750 ahead / 220 to starboard on the
  opposite course; we sail at it with W and the script fires E or Q when it is abeam (|along| < 170), so both ships move
  and the volley lands mid-frame. A rolled navy galleon had red sails and looked like us; at beam 120 the ships nearly
  collided. b = second angle: trackPair from astern (16:9) / `high: 1.9` portrait (9:16; the side framing put both ships
  at the frame edges). The navy returns fire after the first volley. Restart the server before every take (batch script).
- `trade-north`: Furs at Arkhangelsk rise after each take (56 -> 89 g): the script falls back to the Max chip when 10 is
  unaffordable (that was a 30 s click timeout).
- `world-map-north`: wheel-zoom on Scandinavia after 1.2 s on the whole world; the zoom point differs per aspect.
- `edit.mjs`: per-clip `zoom` (punch-in, lanczos) with cropX/cropY; used for the 9:16 trade (two 2 s beats: ledger with
  the Northern group, then the bill) and the 9:16 ship cards, and a light 1.25 on the 16:9 trade.
- Reused from trailer 1 (copied to `capture/t1/`): hero-dawn, ship-select (16:9), havana-approach, leaderboard (invented
  names). Not reused (owner feedback): sail-run, trade-screen, broadside. New 9:16 ship-select capture.
- Timelines: `scripts/trailer/timeline.v2.16x9.json`, `timeline.v2.9x16.json` (trailer-1 timelines kept).
- Batch helper used (session scratchpad, not committed): clean = kill the :5150 listener + delete player keys in DB 11;
  then start the server hidden, wait for /api/ports, run capture.mjs; one restart per shot group.

Result: `ptw-trailer-v2-16x9.mp4` 43.7 s (35 MB), `ptw-trailer-v2-9x16.mp4` 31.1 s (24.5 MB), both -14 LUFS, H.264 High,
yuv420p, AAC. Reviewed at 1 fps; contact sheets in the same folder. Cleanup done: server stopped, DB 11 flushed,
socketHandler reverted, ptw-redis stopped.

Known weaknesses: fixed noon sky; land in the north is as green as the tropics (no snow in the game); the 9:16 trade
beats are a 1.6x upscale (slightly soft but legible); the 16:9 St. Petersburg truck ends over rooftops; realtime clips
keep the HUD in combat (health bars and the "Russian Navy - Man-o'-War" plate are the point).
