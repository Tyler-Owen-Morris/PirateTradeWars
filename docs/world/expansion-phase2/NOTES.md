# New Horizons phase 2: "North of everything" (progress notes)

Branch: the agent worktree branch (`worktree-agent-aa6a08c447472a281`), started from `dev/2026-10-23-batch` (45c7a4a).
Every commit ends `[skip ci]`. Nothing is pushed, merged or deployed. Copies Phase 1's approach
(`docs/world/expansion-phase1/NOTES.md`). **Status: complete.** Resume from the first unchecked box if anything reopens.

Worktree setup: `node_modules` is a junction to the main checkout's (`mklink /J node_modules <main>\node_modules`).
The Natural Earth cache downloads itself into `scripts/world/.cache/` on the first `npm run world:build`.

## Checklist
- [x] 1. Ice line split: `ICE_LAT_N = 72`, `ICE_LAT_S = 70` (shared/world/geo.ts, scripts/world/lib/common.ts);
      `iceLatFor(lat)`, `isIceLat(lat)`; manifest `iceLatN/iceLatS` (old `iceLat` dropped, nothing read it);
      map.ts + minimapLand.ts per-hemisphere ice tint; client ice.ts one `IceLine` per pole (own period and
      geometry); WorldMap legend; tests updated. The SDF tiles do not contain the ice.
- [x] 2. 17 ports appended to `scripts/world/portDefs.ts`; regions `baltic`, `arctic`, `north_pacific`; nations
      `russia`, `sweden`, `denmark_norway`, `hawaii`; 7 named lanes; carved channels (`scripts/world/channels.ts`);
      `npm run world:build` (land bd01338429, ports 6fb26242b6, lanes fcac30feb9). data.test checks the channels,
      North Cape and the Archangel lane.
- [x] 3. Runtime types (`PortNation`/`PortRegion`), trade-screen region/nation labels (+ `HOLDER` for York Factory,
      a saltire for Russia), map dot colours, flag colours and city flag patterns.
- [x] 4. Goods 14 Furs (120), 15 Whale Oil (65), 16 Naval Stores (35), group `northern`, all exotic; GOOD_MARKETS;
      `npm run market:sim` and its tests pass.
- [x] 5. Russia NPC faction (server FACTION_IDS/NATIONS/STANDING_FACTIONS, client flag), zones `north` and
      `npacific`, +29 NPCs (185 -> 214), Caribbean unchanged (72). Display-only nations send Guild merchants.
- [x] 6. CITY_CUSTOM entries for the 17 ports; styles `nordic`, `russian`, `trading_post`, `pacific_island`;
      landmark/extra `onion_church`.
- [x] 7. Labels: `MAJOR_PORT_KEYS` + st_petersburg, copenhagen, quebec, arkhangelsk; nav test asserts they show
      on the zoomed-out world.
- [x] 8. Docs: WORLD_SPEC dated block (+ §2 constants), DATA_PIPELINE (carved channels), SHARED/SERVER/CLIENT_CONTEXT,
      NPC README, city README, CLAUDE.md (ice rule).
- [x] 9. Verification (below).

## World build
- 60 ports, 169 lanes, min lane clearance 69 (test asserts >= 60). Validation passed.
- **Carved channels** (land pixels -> water along a polyline, half-width 150 units, before the SDF):
  - Øresund (Kullen - Helsingør - Copenhagen/Malmö - Falsterbo): 97 pixels. Without it the Baltic is cut off at
    ocean-mask/lane clearance (the Helsingør narrows are 1-2 px), and St. Petersburg failed "no dock water".
  - St. Lawrence (Pointe-des-Monts side -> Île d'Orléans): 148 pixels. The 1:50m river is water but only 1-3 px at
    sdf >= 100, on a diagonal the 2x2 lane cells could not follow ("quebec: only 0 ports reachable"). Without the
    carve the dock went 129 km (1291 units) downriver and still had no lane. The real estuary is 20-25 km wide up
    to Kamouraska, so the carve mostly straightens it; the last ~60 km below Québec is widened to ~30 km.
- Town displacement from the real coordinate (dock distance from the town in brackets), in units (1 unit = 100 m):
  St. Petersburg **324** (487; town at the Neva mouth), Riga 0 (239), Stockholm 0 (422), Copenhagen 74 (165),
  Bergen 0 (303), Arkhangelsk 0 (427), Reykjavík 21 (157), Godthåb 51 (161), St. John's 0 (163),
  Québec 46 (198, thanks to the carve), York Factory 0 (168), Okhotsk 36 (147), Petropavlovsk 39 (228),
  Sitka 55 (237), Guam 0 (148), Honolulu 32 (153), Galápagos 19 (138).
- Straits that needed nothing: the Gulf of Finland, the Gulf of Riga (Irbe strait), the Stockholm approaches,
  North Cape and the White Sea's Gorlo (with the 72° ice), Hudson Strait/Bay, the Sea of Okhotsk, Avacha Bay,
  Sitka Sound. The Archangel lane runs north of North Cape below 72° (tested).
- 4 nearest by sea: arkhangelsk -> bergen, reykjavik, copenhagen, amsterdam; york_factory -> godthab, st_johns,
  reykjavik, boston; okhotsk -> petropavlovsk, guam, macau, manila; honolulu -> sitka, petropavlovsk, acapulco, guam.
- Named lanes: london-arkhangelsk (39.8k), amsterdam-st_petersburg (23.9k), copenhagen-reykjavik (25.2k),
  london-york_factory (65.0k), saint_malo-quebec (55.4k), petropavlovsk-sitka (44.3k), acapulco-guam (124.2k).
- Old lanes: 11 old 4-nearest lanes were displaced by nearer new ports (acapulco-juan_fernandez, amsterdam-porto,
  batavia-sainte_marie, boston-tortuga, goa-macau, havana-new_york, juan_fernandez-panama, london-porto,
  macau-sainte_marie, manila-sainte_marie, panama-valparaiso). No surviving old lane changed shape; every port
  still has >= 4 lanes.
- Probe tools (session scratchpad, not committed): `p2/dump.ts` builds the SDF exactly as the build (incl. channels)
  and writes it raw; `p2/ascii.ts lonMin latMax lonMax latMin step sdf.bin "lon,lat;..."` prints `#` land /
  `.` < 80 / `-` 80-99 / `o` >= 100 with `@` marks. Both are ~20 lines and easy to rewrite.

## Market (`npm run market:sim`, zero fluctuation, spread applied)
Other pitch notes covered by existing goods: arctic ports are Fish sources (stockfish, Iceland); the Baltic is a Wood
source and wants Sugar, Rum and Wine (Copenhagen); Guam wants Silver. Tea and the "held in reserve" goods are not in.
Top 10 by profit per cargo unit (unchanged at the top; Acapulco -> Batavia shortened 180k -> 171k via Guam):
```
Gold     elmina          -> goa             buy  108  sell  356  + 248/unit   132k lanes    18.8/unit/10k
Gold     rio_de_janeiro  -> goa             buy  108  sell  356  + 248/unit   144k lanes    17.2/unit/10k
Silver   acapulco        -> batavia         buy   84  sell  307  + 223/unit   171k lanes    13.0/unit/10k
Silver   panama          -> batavia         buy   84  sell  307  + 223/unit   198k lanes    11.3/unit/10k
Silver   callao          -> batavia         buy   84  sell  307  + 223/unit   212k lanes    10.5/unit/10k
Silver   buenos_aires    -> batavia         buy   84  sell  307  + 223/unit   256k lanes     8.7/unit/10k
Silver   portobelo       -> batavia         buy   84  sell  307  + 223/unit   296k lanes     7.5/unit/10k
Silver   buenos_aires    -> goa             buy   84  sell  302  + 218/unit   165k lanes    13.2/unit/10k
Silver   portobelo       -> goa             buy   84  sell  302  + 218/unit   205k lanes    10.6/unit/10k
Silver   callao          -> goa             buy   84  sell  302  + 218/unit   246k lanes     8.9/unit/10k
```
Best per distance: Gold Elmina -> Lisbon 28.4 per unit per 10k; **Whale Oil Bergen -> Amsterdam is 2nd (26.2)**,
Bergen -> London 5th (24.3): the short cold "whalers' circuit" from the pitch. 10th best is 22.9 (test: top <= 1.6x).
Best per good for the Northern group: Furs Arkhangelsk -> Sainte-Marie +143/unit (198k); Whale Oil Bergen -> Goa
+78; Naval Stores St. Petersburg -> Port Royal +43 (the pitch's "Northern Stores"). Fur to Macau from Okhotsk
(~55k) is about +100/unit.

## Verification
- `npm test`: 52 files, 667 tests pass. `npm run check`: 56 error lines (= baseline, none in touched files).
  `npm run build` passes.
- Re-seed on old data: `seed-old-world.ts` (now takes an optional goods count) wrote the 43-port world
  (portsVersion 9690dce4bc, goods 1-13, every row price 999) into Redis DB 10; booting the built server
  (`node dist/index.js`, :5191) logged `[ports] seeded 60 ports (portsVersion 9690dce4bc -> 6fb26242b6)` and
  `[goods] seeded 3 missing goods (ids 14, 15, 16)`; `/api/ports/:id/goods` returned 16 rows for all 60 ports
  (e.g. St. Petersburg sells Naval Stores at 20; Port Royal marks them wanted, not sold).
- Bot test (`--port 5195 --bots 30`, Redis DB 9): 30 s run all assertions pass incl. the trade round trip; a 70 s
  run for the tick line: `[tick] avg 3.03 ms (max 11.9)`, 69 players, NPCs 38 active / 212 records
  (Phase 1: 2.33 / 8.0).
- Live-world load test (200 players + 214 NPC records): avg 2.07 ms/tick spread over all ports (NPC system 0.55 ms,
  max 6.0), 1.96 ms packed at the starter ports.
- Playwright (QA dev server :5177 with the UNCOMMITTED `docs/world/qa/scripts/devtp.patch`, reverted after; script
  `pw/horizons2.mjs` in the session scratchpad): `worldmap-whole.jpg`, `worldmap-north-atlantic-baltic.jpg`,
  `arrive-{arkhangelsk,st-petersburg,quebec,sitka}.jpg`, `trade-arkhangelsk-northern.jpg`. No page errors.
  The trade shot predates the Russian saltire on the card (it shows the straight cross).
- Redis DBs 9 and 10 flushed; no servers left running.

## Open issues / decisions for Theo
- Two carved channels change the land tiles (new land version; clients fetch new tiles). The Øresund is ~30 km wide
  in game (4 km at Helsingør in reality); the St. Lawrence ~30 km up to Île d'Orléans. Alternative for Québec would
  have been a dock ~130 km downriver (it had no lane even then).
- The Caribbean share of the NPC fleet drops to 44 % (counts unchanged); the live-world test bound went 0.45 -> 0.42.
- Furs are mid-tier (+100-143/unit) rather than the pitch's "big score"; raise Furs' base price or add Canton (a
  phase 3 port) as a wanted market if Theo wants Soft Gold to rival silver.
