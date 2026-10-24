# Trailer: working notes and runbook

State (2026-10-24): storyboard, tooling and edit pipeline are DONE and the edit pipeline is tested end to end on
placeholder clips. The capture driver and the client hook are written but NEVER RUN (the server and a browser against it were
off limits while this was built), so the first live run will need a tuning pass. Footage is recorded after the
expansion (Baltic/Arctic/North Pacific) merges.

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
- It drives the existing dev city camera (`lib/world/cityDebug.ts`); the only changes to existing files are
  `cityDebug.showShip` (keep the own ship drawn while the debug camera is on; used in `Player.tsx`) and the mount line in `GameScene.tsx`.
- `lib/trailer/path.ts`: pure keyframe maths (anchor = port / own ship / lat,lon; offsets in render units; smooth or linear
  easing; map-seam aware; optional ship-relative rotation). `evalPath(path, t)` is a pure function of `t`, so every frame can be
  asked for by time. Tested in `lib/trailer/__tests__/path.test.ts` (`npx vitest run client/src/lib/trailer`, passes).
- HUD hiding: `hud(false)` injects `div:has(> div > canvas) ~ * { display:none }`, i.e. everything after the R3F canvas wrapper in
  `App.tsx` (HUD, chat, minimap, compass, toasts, trade screen). Chat is therefore never on screen (real players, kids).
  `hud(true)` is used by the UI shots (trade screen, map, leaderboard).

## How capture works

Prereqs: the game running locally in dev mode (`NODE_ENV=development DEV_START_GOLD=10000000 npm run dev`, Docker Redis,
`STRIPE_SECRET_KEY=sk_test_dummy`; see `CLAUDE.md` gotchas) and the QA-only server patch `docs/world/qa/scripts/devtp.patch`
applied UNCOMMITTED with `PTW_DEV_TELEPORT=1` (teleport `devtp`, NPC spawn `devnpc`, as in `docs/world/qa/scripts/n2.mjs`).
Playwright is not in this repo's package.json: `npm i --no-save playwright` (chromium is cached in `%LOCALAPPDATA%\ms-playwright`) or
let `scripts/trailer/lib.mjs` find an install in a sibling worktree (`PLAYWRIGHT_DIR` overrides).

1. `node scripts/trailer/capture.mjs --list`
2. Preview framing first: `node scripts/trailer/capture.mjs --shot havana-approach --preview` (3 PNGs: start, middle, end). Camera
   numbers in `shots.mjs` are first guesses; adjust there.
3. Full capture: `--shot <id>` or `--all`, `--aspect 16x9|9x16`. Output goes to `<repo>/capture/<aspect>/` (git-ignored).

Two modes (chosen per shot in `shots.mjs`):

- **frames (deterministic, preferred for scenery).** An init script replaces `performance.now`, `Date.now`, `requestAnimationFrame`
  and `cancelAnimationFrame` with a virtual clock. The page loads on the real clock (tiles and towns stream in), then `__clock.freeze()`;
  from then on each frame = `__trailer.seek(t)` + `__clock.step(1000/fps)` (R3F, the ocean shader, camera smoothing and the net layer
  all read these) + a PNG screenshot. Headless software GL can run at 2 fps and the result is still smooth. The own ship is PARKED
  (no input) and the camera path is a pure function of `t`. Caveat, by design: the server runs on real time, so NPCs and other ships
  do not move believably under the frozen clock. Use frames mode for ports, coast, sky, ice, and for native 1080x1920.
- **realtime (for anything that moves).** A headed Chromium kiosk window plus ffmpeg `gdigrab` of the desktop at 60 fps, while the
  key script from `shots.mjs` plays. Needs a 1920x1080 monitor at 100% scaling and a free GPU. There is a 1.2 s lead-in, hence
  `"in": 1.2` in the timelines. 9:16 realtime clips are cropped from the 16:9 recording by `edit.mjs`.

If you want realtime frames without the desktop grab, `Page.startScreencast` over CDP works but tops out around 30 fps.

## How to edit

```
node scripts/trailer/edit.mjs --selftest [--aspect 9x16]          # placeholder clips, proves ffmpeg + fonts + audio
node scripts/trailer/edit.mjs --timeline scripts/trailer/timeline.16x9.json   # -> dist/ptw_trailer_16x9.mp4
node scripts/trailer/edit.mjs --timeline scripts/trailer/timeline.9x16.json
```
Remove clips from the JSON (for example the `_needs: "expansion"` one) if the footage is missing. Retune `sfx[].at` and `music.start`
by ear. Selftest result 2026-10-24: both aspects build in 9-14 s; h264 High yuv420p 1920x1080 / 1080x1920 30 fps + AAC 48 kHz stereo; integrated
loudness -14.0 LUFS, sample peak -1.3 dBFS; duration equals sum(clips) + end - 0.4 s per crossfade. Output keeps a `dist/` home (git-ignored).

## Still to do (in order)

1. Merge of the expansion, then check the port keys used by `northern-seas` (`archangel`, `saint_petersburg`, `stockholm` are guesses).
2. First live dry run with `--preview` for every shot; fix camera numbers, `h.at(...)` sea points (open water?), and the `broadside`
   NPC placement. Check `div:has(> div > canvas) ~ *` really hides the HUD (else use `__trailer.hide([...selectors])`).
3. Record, retime the SFX and caption times, encode, review on a phone, post.
4. Decide with Theo: CC0 music pick after listening; whether the in-game sounds may be used.
