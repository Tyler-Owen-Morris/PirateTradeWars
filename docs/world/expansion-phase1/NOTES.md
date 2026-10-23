# New Horizons phase 1: "The Americas, both coasts" (progress notes)

Branch: the agent worktree branch, started from `dev/2026-10-23-batch` (7abf9d7). Every commit ends `[skip ci]`.
Nothing is pushed, merged or deployed. Another agent can resume from the checklist below.

## Checklist
- [x] 1. Ports: 16 new ports appended to `scripts/world/portDefs.ts` (append-only: numeric ids are indices),
      5 new named lanes, `npm run world:build` (tiles unchanged; ports/lanes/versions regenerated), `south_atlantic`
      region type in `shared/world/ports.ts` and the trade screen's region label.
- [ ] 2. Goods: 5 new goods appended (ids 9-13), GOOD_GROUPS "specie"; goods seeding by id at boot; ensurePortGoods
      fills missing goods rows.
- [ ] 3. Market model: `shared/world/goodMarkets.ts` (GOOD_MARKETS, lane-graph distance premium, notSold, wanted);
      wired into seeding, price updates and the goods API; price simulator.
- [ ] 4. NPC zones/fleets for the new lanes; bot test tick numbers.
- [ ] 5. Cities: CITY_CUSTOM entries for the 16 ports.
- [ ] 6. Map/minimap label decluttering.
- [ ] 7. Docs (WORLD_SPEC dated block, DATA_PIPELINE, contexts, NPC README, city README).
- [ ] 8. Tests, check, build, Playwright shots in this folder.

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
