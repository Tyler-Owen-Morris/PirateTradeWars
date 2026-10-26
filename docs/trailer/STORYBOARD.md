# Pirate Trade Wars: gameplay trailer storyboard

Two cuts from the same shots (ids = `scripts/trailer/shots.mjs`; timelines = `scripts/trailer/timeline.*.json`).
All footage is real gameplay (dev server, `?trailer=1` only hides the HUD and moves the camera). Voice of the text:
short, in-world, full stops. Fonts: Pirata One (captions), IM Fell English SC (URL), Alegreya (tagline).
No narration; the music bed carries it, one real cannon SFX on the broadside.
## Trailer 1 as cut (2026-10-25, live game, no expansion)

The plan below was written before the first live run. What was actually cut (timelines in `scripts/trailer/timeline.*.json`):

- **16:9, 45.5 s**: hero-dawn "Sail the known world." / ship-select (all ships "Free") / sail-run / havana-approach "Trade where
  the price is right." / trade-screen (two real purchases) / world-map "43 ports. One ocean." / callao / broadside with HUD "Give 'em
  a broadside." + 2 cannon SFX / amsterdam / leaderboard (invented captains) / end card. Music from 74 s.
- **9:16, 31.1 s**, all native 1080x1920: broadside hook "Fire at will." (volley inside the first second) / sail-run / havana
  (caption) / trade-screen / callao / world-map (caption) / hero-dawn / leaderboard / end card. Music from 82 s.
- Dropped vs the plan: "Chart the frozen north." (trailer 2), the Amsterdam "dusk" (the game sky is fixed), captions on the
  ship-select and leaderboard shots (they covered the UI).

## 16:9, 1920x1080, 30 fps, about 44 s

Clips overlap by 0.4 s (crossfade), so cut lengths below are nominal.

| # | Time | Shot id | Mode | Camera | What we see | On-screen text |
|---|---|---|---|---|---|---|
| 1 | 0.0 - 4.5 | `hero-dawn` | frames | Slow low orbit (260 u radius, 70 u high, 60 degrees) round the parked galleon, open Atlantic | Sails, sea, sky, sun glare. Cold open, no HUD | "Sail the known world." (0.7 s) |
| 2 | 4.5 - 10.5 | `sail-run` | realtime | Standard chase camera, W held | Ship under full sail, wake, horizon rolling | none |
| 3 | 10.5 - 15.5 | `havana-approach` | frames | Rise from 70 u to 190 u over the harbour mouth, drift right | Morro fort, quay, boats, red-roof town | "Trade where the price is right." |
| 4 | 15.5 - 20 | `trade-screen` | realtime | Fixed (UI) | Docked at Port Royal, T pressed, the bill of sale and ledger, two buys | none (the UI is the message) |
| 5 | 20 - 23.5 | `world-map` | realtime | Fixed (UI) | M pressed, drag from the Caribbean to Europe over the chart | none |
| 6 | 23.5 - 27.5 | `amsterdam-dusk` | frames | 50 degree orbit, 620 u out, 150 u high | Dutch gables on the waterfront, ships at anchor | none |
| 7 | 27.5 - 36.5 | `broadside` | realtime | Chase camera | Pirate sloop on the beam, Q then E broadsides, splashes, hit flashes, it strikes or flees. One cannon SFX at the first Q | "Give 'em a broadside." (0.5 s) |
| 8 | 36.5 - 41 | `northern-seas` | frames | Push in on a northern port, ice on the water. **NEEDS THE EXPANSION** (Baltic / Arctic / North Pacific) | Pack ice, snow-roofed timber town, low sun | "Chart the frozen north." |
| 9 | 41 - 44 | `leaderboard` | realtime | Fixed (UI) | Tab held, gold board with bot or invented names only | "Climb the gold leaderboard." |
| 10 | 44 - 48 | end card | card | Static | Dark parchment-ink vignette, gold title | "Pirate Trade Wars" / piratetradewars.com / "Free to play in your browser" |

Total about 44.4 s with the end card. If the expansion is late, drop shot 8 and lengthen 6 or 7; edit.mjs does not care.
Shot 6 can also be Port Royal or Lisbon; pick the best-looking town after the first preview pass.

## 9:16, 1080x1920, 30 fps, about 30 s

Hook inside the first 2 s: the picture opens on muzzle flash and a broadside, with the cannon sound under a
music start at full level (fade-in 0.4 s). Captions sit in the safe area: x 6%-84% (clear of the TikTok right rail),
y 56%-68% (clear of the bottom caption/UI zone and of the top 10%). Text is 104 px, cream with ink outline.

| # | Time | Shot id | Source | Reframe | Text |
|---|---|---|---|---|---|
| 1 | 0 - 5 | `broadside` (starting on the first Q) | 16:9 realtime | centre crop | "Fire at will." (0.15 s; the hook) |
| 2 | 5 - 9.5 | `sail-run` | 16:9 realtime | centre crop (ship is mid-frame) | none |
| 3 | 9.5 - 14 | `havana-approach` | native 9:16 frames (1080x1920 viewport) | none | "Trade where the price is right." |
| 4 | 14 - 18.5 | `trade-screen` | 16:9 realtime | centre crop; swap for a native 9:16 recording if the bill of sale is cut | none |
| 5 | 18.5 - 23 | `northern-seas` (NEEDS EXPANSION) | native 9:16 frames | none | "Chart the frozen north." |
| 6 | 23 - 26.5 | `world-map` | 16:9 realtime | centre crop | none |
| 7 | 26.5 - 29.5 | `leaderboard` | 16:9 realtime | centre crop | "Climb the leaderboard." |
| 8 | 29.5 - 33 | end card (9:16 layout) | card | n/a | title, URL, tagline |

About 30 s of action plus the end card. Frames-mode shots are captured natively at 1080x1920, so there is no
upscaling; realtime shots are recorded 16:9 and cropped (framing the ship in the centre third). Keep the
hero subject in the middle 608 px of a 1920 px frame for every realtime shot.

## Platform notes

- YouTube / Facebook / X: the 16:9 file, H.264 High, yuv420p, AAC 192k, -14 LUFS, faststart. X allows 140 s and 512 MB.
- TikTok / Shorts / Reels: the 9:16 file. Keep the call to action in the end card (a link is not clickable in the video).
- Upload the captions as burned-in text (already done); also paste them in the post text for accessibility.
- Suggested post text: "Sail a pirate ship across the real 1650-1800 world. Trade, fight, climb the leaderboard. Free in your browser: piratetradewars.com"

## Rules of the cut

- Never show real players' names in the leaderboard or chat (kids play); the capture script hides chat, and the
  leaderboard shot must run against a private Redis with invented names.
- No fake features: the expansion shot waits for the real expansion; do not composite anything.
- The music is CC0 (see `MUSIC.md`), so no credit is required; the end card carries none.
