# Trailer music and SFX

Verified on the OpenGameArt pages on 2026-10-24 (licence shown on the page, linked to CC0 1.0). I have NOT listened
to them: audition all three before committing. Downloaded files are untrusted data: they sit in their own folders and are
only ever read by ffmpeg.

## Music candidates (all CC0: free for commercial social use, no attribution required)

| # | Title | Artist | Length | Licence | Page | Notes |
|---|---|---|---|---|---|---|
| 1 (pick) | Pirate's Orchestra | Dizzy Crow | 2:08 | CC0 1.0 | https://opengameart.org/content/pirates-orchestra-208 | Orchestra plus accordion, piratey, a little silly. Long enough for both cuts. MP3 128 kbps, so keep the bed unprocessed. File: `assets/music/pirates_orchestra.mp3` (2 MB, downloaded) |
| 2 | Treasure Hunter | TAD | about 1:05 (estimated from bitrate) | CC0 1.0 | https://opengameart.org/content/treasure-hunter (file: https://opengameart.org/sites/default/files/treasure_hunter_0.mp3) | Simple orchestral loop, adventurous; safer for a serious tone. Not downloaded |
| 3 | Pirate Indenture | Eldritch Grim | 0:38 (full track); loop version also on the page | CC0 1.0 | https://opengameart.org/content/pirate-indenture (file: https://opengameart.org/sites/default/files/pirate_indenture.wav) | Epic, fast, pirate-inspired. Under 45 s, so loop it (edit.mjs loops the bed). WAV 6.7 MB. Not downloaded |

Attribution text: none required for any of the three. If a platform asks for credit anyway:
"Music: Pirate's Orchestra by Dizzy Crow (CC0), opengameart.org". Content ID: CC0 tracks occasionally get claimed on YouTube
when someone else re-uploads them; keep the page URL as proof of the licence.

Considered and rejected (need attribution or are not clearly free): Matthew Pablo "Blackmoor Tides" (CC-BY 3.0), Shane Ivers
"The Kraken's Pursuit" (CC BY 4.0, usable with credit: "Music by Shane Ivers, silvermansound.com"), Kevin MacLeod / Incompetech
(CC BY 4.0, credit "Kevin MacLeod (incompetech.com), CC BY 4.0"; no specific pirate track verified), "pirate theme" by Loliver (GPL 3).
If CC-BY is acceptable to Theo, a stronger orchestral piece from these is a one-line swap in the timeline JSON.

## Game audio already in `client/public/sounds/`

`bang1.mp3` (cannon), `hit.mp3`, `success.mp3`, `The Salty Horizon*.mp3`, `background.mp3`, `At-Sea-Sailing-a-wooden-ship.mp3`
(21 MB). Their provenance and licence are not recorded anywhere in the repo. Ask Theo before using them in a public video;
the in-game sound is muted by default in the capture (`useAudio` starts SFX/music muted), so realtime recordings are silent anyway.

## SFX (CC0, downloaded)

| File | Artist | Licence | Page |
|---|---|---|---|
| `assets/sfx/cannon_fire.ogg` (180 KB) | Thimras | CC0 1.0 | https://opengameart.org/content/cannon-fire |

Ocean ambience (optional, not downloaded: 12 MB): "Sea and river wave sounds" by RandomMind, CC0,
https://opengameart.org/content/sea-and-river-wave-sounds (file `VistulaShort_0.mp3`; a RIVER recording, so
low-pass it or skip it). Another CC0 option: "Battle at sea" by Thimras, https://opengameart.org/content/battle-at-sea.
The SFX is mixed by `edit.mjs` from the timeline `sfx` list (`at` seconds on the final timeline, `gainDb`).
Retime `at` to the first Q broadside once the real footage exists.
