# Raw footage pack: run log

Goal: a clean raw footage pack for Theo to cut his own trailers (no captions, no music, no edit), at
`C:\Users\theow\Videos\PirateTradeWars Raw Footage\` (not in git). Tooling in `scripts/trailer/` (see `NOTES.md` for the
capture runbook). Branch `worktree-agent-abeaf55e71f818c31`, from `origin/dev/2026-10-23-batch`.

## Pack layout
- `01 Trailer 1 raw\`, `02 Trailer 2 raw\`: every full-length raw shot of both trailers, re-encoded.
- `03 New - Scenic\`, `04 New - Epic battles\`, `05 New - Ports and towns\`, `06 New - UI and gameplay\`.
- `Audio\` (CC0 music + cannon SFX + licence note), `Graphics\` (end cards, transparent title and caption PNGs).
- `README.txt` (one line per clip), `_contact.jpg` per clip folder.

## Tooling
- `scripts/trailer/footage.mjs`: `encode <captureDir> <out.mp4>` (H.264 High CRF 15 slow, yuv420p TV range bt709, 30 fps,
  +faststart, no audio), `check <clip> <dir>` (start/mid/end JPGs), `contact <folder>`, `probe <folder>`.

## Progress (newest last)
1. Setup: worktree reset to `origin/dev/2026-10-23-batch`; `node_modules` = junction to `agent-abb70aea15b1777da/node_modules`.
2. Trailer raw encoded (no server needed): 18 clips from trailer 1 (`agent-abb70aea15b1777da/capture`, 16:9 + 9:16;
   the 9:16 ship-select there was a preview only), 19 from trailer 2 (`agent-a0b64b43bd24fb3bf/capture`; its reused t1 shots
   are the same files as folder 01, not duplicated). Sources copied from, never moved.
3. Audio + Graphics done: end cards from `cards.mjs`, 9 transparent captions per aspect ("43 ports" dropped: stale, 60 now),
   transparent title PNGs (with/without URL; scratchpad `title.mjs`).
4. Server for the pack: port 5170, `REDIS_CONN_STRING=redis://localhost:6379/13` (leaderboard seeded with invented captains,
   seed-1..10), devtp.patch applied uncommitted. Control script (session scratchpad `srv.ps1 restart`): kill the :5170
   listener, delete `player:*`, `player_*`, `active_name*` in DB 13, start `npx tsx server/index.ts` hidden, wait for /api/ports.
5. Survey: `town-<key>` previews of 27 ports (capture/survey). Good: Havana, Port Royal, Cartagena, Cadiz, Lisbon, Stockholm,
   Copenhagen, Quebec, Rio, Macau, Batavia, Cape Town; inland towns (Amsterdam, London) need the dock-anchored truck or a high
   pass; Juan Fernandez and Galapagos are tiny pirate sandbars.

## Lessons (read before shooting more)
- **The game camera is FOV 80 (vertical)**: ships look tiny at 150+ units. New `__trailer.fov(deg)` (useTrailerHooks.ts, dev
  only) + `shot.fov` in capture.mjs. Pack defaults: sail shots 50, aerials and battles 60, towns 80 (as surveyed).
- **Heading constants**: r = 0 sails NORTH, PI south, -PI/2 east, PI/2 west (forward = (-sin r, -cos r) in (east, south)).
  The `Math.PI // heading north` comments in shots.mjs are wrong (harmless at open sea).
- **Check sailing lines for land** before shooting: `npx tsx scripts/trailer/landcheck.ts <lat> <lon> [dist] [r]` (real land
  field; a galleon covers ~330 units/s at full sail, ~4000 in a 12 s take). 18.5 N 66.5 W (used for broadside tests) is ON
  Puerto Rico's coast; battles moved to 14-15 N 70-76 W.
- **Realtime ship-relative paths froze during settle** (seek(0) then 3 s of sailing before play): new `shot.lead` plays the
  path from setPath with a hold, so the camera follows the ship from before the first recorded frame (no snap).
- 2560x1440 realtime screencast runs at 35-40 fps captured (resampled to 30); frames mode works at any size.
- Spawned merchants sit still (no rail); a "convoy" can only be a fleet we sail through. NPCs never despawn: restart.
