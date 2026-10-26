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
