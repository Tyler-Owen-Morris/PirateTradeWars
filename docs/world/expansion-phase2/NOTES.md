# New Horizons phase 2: "North of everything" (progress notes)

Branch: the agent worktree branch (`worktree-agent-aa6a08c447472a281`), started from `dev/2026-10-23-batch` (45c7a4a).
Every commit ends `[skip ci]`. Nothing is pushed, merged or deployed. Copy of Phase 1's approach
(`docs/world/expansion-phase1/NOTES.md`). **Resume from the first unchecked box.**

Worktree setup: `node_modules` is a junction to the main checkout's (`mklink /J node_modules ..\..\..\node_modules`).
The Natural Earth cache downloads itself into `scripts/world/.cache/` on the first `npm run world:build`.

## Checklist
- [x] 1. Ice line split: `ICE_LAT_N = 72`, `ICE_LAT_S = 70` (shared/world/geo.ts, scripts/world/lib/common.ts);
      `iceLatFor(lat)`, `isIceLat(lat)`; manifest `iceLatN/iceLatS` (old `iceLat` dropped, nothing read it);
      map.ts + minimapLand.ts per-hemisphere ice tint; client ice.ts one `IceLine` per pole (own period);
      WorldMap legend; tests updated. SDF tiles do not depend on the ice.
- [x] 2. 17 ports appended to `scripts/world/portDefs.ts`, regions `baltic`, `arctic`, `north_pacific`, nations
      `russia`, `sweden`, `denmark_norway`, `hawaii`; 7 named lanes; carved channels (`scripts/world/channels.ts`);
      `npm run world:build` (new land version bd01338429, ports 6fb26242b6, lanes fcac30feb9). data.test checks.
- [ ] 3. Runtime types: `PortNation`/`PortRegion` in shared/world/ports.ts, trade-screen region label.
- [ ] 4. Goods 14 Furs, 15 Whale Oil, 16 Naval Stores (group northern) + GOOD_MARKETS; market:sim.
- [ ] 5. Russia NPC faction (server factions, client flags), lane zones, fleets; display-only nations.
- [ ] 6. CITY_CUSTOM entries for 17 ports.
- [ ] 7. Label declutter check (60 ports).
- [ ] 8. Docs (WORLD_SPEC, DATA_PIPELINE, contexts, NPC README, city README, CLAUDE.md).
- [ ] 9. Verification: npm test, check, build, re-seed on old data, bot test, Playwright shots.

## Step 2 results (world build)
- 60 ports, 169 lanes, min lane clearance 69 (test asserts >= 60). Validation passed.
- **Carved channels** (land pixels -> water along a polyline, half-width 150 units, before the SDF):
  - Øresund (Kullen - Helsingør - Copenhagen/Malmö - Falsterbo): 97 pixels. Without it the Baltic is cut off at
    ocean-mask/lane clearance (Helsingør narrows are 1-2 px). St. Petersburg then failed "no dock water".
  - St. Lawrence (Pointe-des-Monts side -> Île d'Orléans): the 1:50m river is water but only 1-3 px at sdf>=100 on a
    diagonal, so the lane grid could not leave Québec's dock ("only 0 ports reachable"). The real estuary is
    20-25 km wide up to Kamouraska, so the carve mostly straightens it; the last ~60 km below Québec is widened.
- Town displacement from the real coordinate (dock distance from town in brackets):
  St. Petersburg **324** (487; town at the Neva mouth), Riga 0 (239), Stockholm 0 (422), Copenhagen 74 (165),
  Bergen 0 (303), Arkhangelsk 0 (427), Reykjavík 21 (157), Godthåb 51 (161), St. John's 0 (163),
  Québec 46 (198, thanks to the carve), York Factory 0 (168), Okhotsk 36 (147), Petropavlovsk 39 (228),
  Sitka 55 (237), Guam 0 (148), Honolulu 32 (153), Galápagos 19 (138).
- Straits that needed nothing: Gulf of Finland, Gulf of Riga (Irbe strait), Stockholm approaches, North Cape and
  the White Sea Gorlo (with the 72° ice), Hudson Strait/Bay, Sea of Okhotsk, Avacha Bay, Sitka Sound.
- Nearest-by-sea links of note: arkhangelsk -> bergen/reykjavik/copenhagen/amsterdam (round North Cape);
  york_factory -> godthab/st_johns/reykjavik/boston (Hudson Strait); okhotsk -> petropavlovsk/guam/macau/manila.
- Named lanes: london-arkhangelsk (Archangel convoy, 39.8k), amsterdam-st_petersburg (the Sound, 23.9k),
  copenhagen-reykjavik (25.2k), london-york_factory (HBC, 65.0k), saint_malo-quebec (55.4k),
  petropavlovsk-sitka (44.3k), acapulco-guam (galleon, 124.2k).
- Probe tools (scratchpad, not committed): `p2/dump.ts` dumps the SDF, `p2/ascii.ts lonMin latMax lonMax latMin step`
  prints `#` land / `.` <80 / `-` 80-99 / `o` >=100.

## Open issues / decisions for Theo
- Two carved channels change the land tiles (new land version; clients fetch new tiles). Øresund is widened to
  ~30 km (real 4 km at Helsingør); the St. Lawrence to ~30 km up to Île d'Orléans.
