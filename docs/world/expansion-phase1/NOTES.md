# New Horizons phase 1: "The Americas, both coasts" (progress notes)

Branch: the agent worktree branch, started from `dev/2026-10-23-batch` (7abf9d7). Every commit ends `[skip ci]`.
Nothing is pushed, merged or deployed. **Status: complete.** Another agent can resume from the checklist below.

## Checklist
- [x] 1. Ports: 16 new ports appended to `scripts/world/portDefs.ts` (append-only: numeric ids are indices),
      5 new named lanes, `npm run world:build` (tiles unchanged; ports/lanes/versions regenerated), `south_atlantic`
      region type in `shared/world/ports.ts` and the trade screen's region label.
- [x] 2. Goods: 5 new goods appended (ids 9-13), GOOD_GROUPS "specie" (Silver, Gold); Cacao, Hides, Wine under
      Colonial (note now "grown in the colonies and the wine islands"). `seedGoods` writes missing ids at boot
      (`redisStorage.putGood`); `ensurePortGoods` adds missing rows to existing markets.
- [x] 3. Market model: `shared/world/goodMarkets.ts` (GOOD_MARKETS, lane-graph distance premium with a 0.6 curve,
      notSold, wanted). REGION_MARKETS / CHEAP/DEAR factors removed from `shared/world/ports.ts`. Wired into
      seeding, `updatePortMarkets` (re-syncs notSold via `redisStorage.updatePortGoodNotSold`) and the goods
      API (`portGoodView` wanted = `isWanted`). Price simulator: `npm run market:sim`
      (`scripts/market/priceSim.ts`, test `scripts/market/__tests__/priceSim.test.ts`).
- [x] 4. NPCs: lane zones `south` and `pacific`; +32 NPCs (153 -> 185), Caribbean fleets unchanged (72).
- [x] 5. Cities: CITY_CUSTOM entries for the 16 ports; new `lookout` piece (Juan Fernández).
- [x] 6. Map/minimap label decluttering (`lib/nav.ts` `placeLabels`).
- [x] 7. Docs: WORLD_SPEC dated block, DATA_PIPELINE, SHARED/SERVER/CLIENT_CONTEXT, NPC README, city kit README.
- [x] 8. Tests, check, build, Playwright shots in this folder.

## Step 1 results (world build)
- 43 ports, 117 lanes, min lane clearance 70 (test asserts >= 60). Land tiles unchanged (no tile diff).
- Every new port placed by the normal rules; town moved from the real coordinate:
  - Guayaquil moved **362 units** (the Guayas river is narrower than a pixel): town and dock sit at the river mouth.
  - Buenos Aires: the River Plate is wide enough at 4.9 km/px; town moved 13, dock 152 from town. No move needed.
  - All other new ports moved <= 52 units.
- Panamá's dock is on the Pacific side (lanes to Guayaquil/Callao/Acapulco), Portobelo's on the Caribbean side.
  The Pacific ports join the rest of the graph through acapulco-manila and the new buenos_aires-valparaiso
  (Cape Horn) lane.
- New named lanes: lisbon-rio_de_janeiro (Brazil fleet), cadiz-portobelo (galeones), callao-panama
  (Armada del Sur), buenos_aires-valparaiso (Cape Horn), rio_de_janeiro-cape_town.

## Market model numbers (`npm run market:sim`, zero fluctuation, spread applied)
Top 10 by profit per cargo unit:
```
Gold     elmina          -> goa             buy  108  sell  356  + 248/unit   132k lanes
Gold     rio_de_janeiro  -> goa             buy  108  sell  356  + 248/unit   144k lanes
Silver   acapulco        -> batavia         buy   84  sell  314  + 230/unit   180k lanes
Silver   panama          -> batavia         buy   84  sell  314  + 230/unit   207k lanes
Silver   callao          -> batavia         buy   84  sell  314  + 230/unit   221k lanes
Silver   buenos_aires    -> batavia         buy   84  sell  314  + 230/unit   228k lanes
Silver   portobelo       -> batavia         buy   84  sell  314  + 230/unit   268k lanes
Silver   acapulco        -> macau           buy   84  sell  302  + 218/unit   163k lanes
Silver   buenos_aires    -> goa             buy   84  sell  302  + 218/unit   165k lanes
Silver   panama          -> macau           buy   84  sell  302  + 218/unit   190k lanes
```
Best per distance: Gold Elmina -> Lisbon, +152/unit over 53k lanes (28.4 per unit per 10k; the 10th best is 20.4).
The test asserts top-1 <= 1.25x top-10 per unit and <= 1.6x per distance, and best < 400/unit.
A linear distance curve made short regional hops worthless (Caribbean rum to Charleston +9/unit vs +26 before);
the 0.6 exponent restores them (~+25).

## Verification
- Re-seed on old data: `scripts/market/seed-old-world.ts` wrote the 27-port world (portsVersion 6bd7731ac9, goods 1-8,
  every row price 999) into local Redis DB 7; booting the new server logged
  `[ports] seeded 43 ports (portsVersion 6bd7731ac9 -> 9690dce4bc)` and `[goods] seeded 5 missing goods (ids 9..13)`;
  `/api/ports/:id/goods` then returned 13 rows per port with model prices, `buyPrice: null` for not-sold exotics.
- Bot test (`npm run test:bots -- --port 5093 --duration 70`, Redis DB 8): all assertions pass incl. trade round trip;
  server `[tick] avg 2.33 ms (max 8.0)`, 62 players (30 bots + leftovers), 185 NPC records (31 active).
- Unit load test (200 players + 185 NPCs, real map): avg 2.10 ms/tick spread over all ports, 1.92 ms packed at starters.
- Playwright (own server on :5077 with an UNCOMMITTED QA-only `devtp` teleport in socketHandler, reverted after):
  `worldmap-whole.jpg`, `worldmap-americas-zoom.jpg`, `arrive-{rio,buenos-aires,callao}.jpg`,
  `trade-{rio,buenos-aires,callao}-{top,bottom}.jpg`. No page errors. The script lives in the session scratchpad
  (`pw/horizons.mjs`); the teleport patch is `docs/world/qa/scripts/devtp.patch` (applies by hand).
