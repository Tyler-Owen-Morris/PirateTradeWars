# Trailer: working notes and runbook

State (2026-10-25): **trailer 1 (the live game, no northern expansion) is recorded and cut**, both aspects. The tooling has had
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
