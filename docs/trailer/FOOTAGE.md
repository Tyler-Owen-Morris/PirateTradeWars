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

## Shot status (pack folder 03-06; ids in footage-shots.mjs)
- 03 scenic done (2560x1440): orbit-carib, waterline-pass, bow-on-low, high-chase-islands, ice-sail, ships-passing,
  aerial-bahamas, aerial-antilles, ice-cliff-dolly, ice-orbit-man-o-war, aerial-oresund, aerial-gulf-finland, reveal-havana.
  merchant-fleet re-shot (sailShot `pre` holds W at full speed through settle: NPCs spawned < 1000 ahead get overrun).
- 04 battles: batch running via scratchpad `takes.ps1` (one server restart per take).
- 04 battles done (3 batches). Lessons: **hits only land ~100-190 units out and roughly abeam** (|along| < ~30 for a sure hit;
  closer than ~90 the balls spawn past the target); the NPC AI breaks off within ~5 s (sloops flee a galleon, navies sail on),
  so the action is in the first 4-8 s of each take; trackers now use `trackGroup({ dyn })` (own ship + any NPC near it) so
  the frame never goes empty. The on-camera sink uses a man-o'-war (4 x 15 per volley) and `weaken: 8` (devhp) on the sloop;
  the sinking shows a ~1.2 s capture hitch when the gold coin first appears (shader compile, probably). Pursuit reverse angle
  dropped (pirate too far). `takes.ps1` bug: PowerShell variables are case-insensitive ($s shadowed $S): no restarts happened
  in batch 1.
- **Frames mode + moving NPCs = flicker** (virtual page clock vs real-time server snapshots: NPC ships pop in/out and jump
  between consecutive frames; seen at Havana). Ports, aerials and the reveal now run through `live()` (realtime, path
  played from setPath with `lead`). 2560x1440 realtime renders only ~35-38 fps for towns (14% repeated frames = judder), so
  **ports and aerials are 1920x1080** (57-59 fps captured, ~0-4 repeats). Ship and battle shots stay 2560 (39-59 fps).
- 05 ports done (24 clips incl. sailing into Havana / out of Port Royal). 06 UI done at 1920x1080 (the UI is laid out for it).
- Pack helpers (session scratchpad, not committed): `pack.mjs` (encode + 3-frame check strip), `strip.mjs` (1 frame/s
  filmstrip), `stack.mjs`, `readme.mjs` + `clips.json`/`clips2.json` (README.txt), `takes.ps1`, `srv.ps1`.
