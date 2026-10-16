# World + NPC build: state ledger

Producer: Claude (main session). Approved by Theo on 2026-10-16: the wrapping-Earth plan, a 20-minute lap (C = 400k), the whole globe open, and **everything shipped together in one deploy**.

- Contract: `docs/world/WORLD_SPEC.md`
- Design rationale: `docs/proposals/WORLD_AND_NPCS.md`

**If you are resuming after a shutdown:** read this file, then WORLD_SPEC.md, then `docs/world/progress/<card>.md` for each card that is `in-progress`.

## Rules for every card
- Work in your own worktree, and run `git reset --hard main` first: worktrees can start at a stale commit.
- Write progress notes to `docs/world/progress/<CARD>.md` as you go: done, in progress, next step, gotchas. If the sandbox blocks writes to the main checkout, keep the file in your worktree and commit it on your branch.
- Commit on your branch with `[skip ci]` in every message. **Never push and never deploy.** The producer merges.
- Test with local Docker Redis (`redis://localhost:6379`, container `ptw-redis`), never the Upstash URL in `.env`.
- Gates before you report done:
  - `npm test` passes
  - `npm run build` passes
  - `npm run test:bots` passes
  - no new `tsc` errors in the files you touched
- Document your work: code comments, plus updates to `shared/SHARED_CONTEXT.md`, `server/SERVER_CONTEXT.md` and `client/CLIENT_CONTEXT.md` for the parts you changed.

## Cards
| ID | Card | Phase | Owner | Branch | Status | Next step |
|----|------|-------|-------|--------|--------|-----------|
| W1 | Coordinates and physics: geo.ts, metric motion, land.ts (LandField), no-damage collision in stepShip, sparse grid and metric distances in world.ts, ball-on-land, client net (prediction, interpolation, cannonballs), server tile loading, tests | 1 | agent (opus) | merged | done | — |
| W2 | World data pipeline: Natural Earth → SDF tiles and manifest, ports.json (~25 real ports with dock and spawn), lanes.json, world map texture; generator script plus generated artifacts | 1 | agent (opus) | merged | done | — |
| W3 | Rendering: floating origin for every object, camera-following ocean, then terrain chunks from SDF tiles (beach, grass, forest, rock), surf and shallow tint, ice wall, land splash effect | 1 (terrain after W1 and W2 merge) | agent (opus) | worktree-agent-a5da9a58c12c71d40 | merged | done (ice not browser-verified) | — |
| NPC1 | NPC core: controller field and guards in World, ent fields, steering→input, brain (state machine plus utility), threat table, faction model and static matrix, archetypes, LOD tiers and director skeleton, unit tests | 1 | agent (opus) | npc2-base (334b9e9) | done (in main via NPC2) | — |
| W4 | Ports integration: server reads ports.json, portsVersion re-seed, dock-radius checks (including trade), spawn at port, Redis player migration, client ports and towns at real sites | 2 (after W1 and W2) | agent (opus) | merged | done | — |
| W5 | Navigation UI: world map (M), minimap with metric scaling, compass with heading and lat/lon, port distance and bearing | 2 (after W1 and W2) | agent (sonnet) | merged | done (visual check in Q) | — |
| NPC2 | NPCs live: routes on lanes.json, director population, broadside combat, flee and surrender, pirates, navy and privateers, rep in Redis, fair-play rules, NPC load test (200 bots + 300 NPCs, tick < 25 ms) | 2 (after NPC1, W1, W2) | agent (opus) | merged | done | — |
| Q  | Integration: full gate, bots, browser play-test (circumnavigate, coast slide, ports, NPC fights), docs, **single production deploy**, prod verification | 3 | producer + QA agent | main | Q1 (world play-test, no NPCs) in-progress | see progress/Q1.md; Q2 after NPC2 merge |

## Log
- 2026-10-16 Plan approved. Spec and ledger written. Phase 1 (W1, W2, W3, NPC1) launching in parallel.
- 2026-10-16 Launched W1, W2, W3 (Part A floating origin; Part B terrain waits for W1+W2 merge), NPC1 in parallel worktrees (all opus).
- 2026-10-16 W3 Part A done (3eb543d, floating origin + camera-following ocean, 123 tests, build, bots PASS). Held unmerged: client assumes C=400000, must merge together with W1. Reconcile its local geo constants (TODO(W1)) after W1.
- 2026-10-16 W2 merged into main (6f1f300+f1c1d0a): 27 ports, 75 lanes, 1.47 MiB gzipped tiles (version fb6d8abef3), map PNGs; 125 tests pass. Told W1 about gzip encoding. Spec clarifications appended.
- 2026-10-16 W1 merged (d2f8c4e) then W3 part A merged, no conflicts. main: 173 tests pass, build OK. W1 bots PASS on real land. Launching phase 2: W3 part B (terrain), W4 (ports), W5 (navigation UI). NPC2 waits for NPC1.
- 2026-10-16 NPC1 done (48d6ac9; 61 tests; 300 NPCs + 200 players ~2.1 ms/tick). It was built on pre-W1 main, so 6 NPC tests fail against the new coordinates. Merged into branch npc2-base (334b9e9, pushed) and NOT into main, which stays green. NPC2 launched from npc2-base: reconcile, populate from lanes and ports, NPCs on by default, rep in Redis, nameplates, load test.
- 2026-10-16 W5 merged (98db238): minimap with land, world map on M, compass HUD with lat/lon and target port in nautical miles. 194 tests, build OK. Not visually verified yet (Q play-test). W4 must supply dock and nation in /api/ports and switch GameScene/Port distance checks to the dock (told W4).
- 2026-10-16 W3 part B merged (07c252b): terrain chunks from the SDF, shallow tint and surf, polar ice, dust on land hits. Fixed the dev double-gunzip in landTiles. main: 208 tests, build OK. Caribbean terrain seen in Chrome via Cypress; ice not yet. Port.tsx island removal left to W4.
- 2026-10-16 W4 merged (a073d22): 27 real ports with numeric ids, re-seed by portsVersion, regional prices, dock check within 300 (trade included), starter-port spawns, migration keeps gold, coastal towns. main: 229 tests, build OK. Notes: the game has no respawn (sunk = game over); safeRadius has no gameplay effect; agents collide on local bot-test ports, so use a unique --port. Island.tsx and PortCity.tsx are now unused.
- 2026-10-16 Q1 launched early: browser play-test of the world on main, without NPCs, server on port 5601. Q2 (NPCs) follows the NPC2 merge.
- 2026-10-16 NPC2 merged (4553842): 300 NPCs (160 merchants, 55 navy, 65 pirates, 20 privateers), at most 80 active, on by default (NPCS_ENABLED=0 turns them off). Fixed coastline sticking (167 s stuck -> none longer than 3 s). Standing saved in Redis, nameplates and flags, batched socket writes per tick. main: 311 tests, build OK. Producer bot run on port 5711 PASS: 20 snaps/s, worst gap 64 ms, tick avg 1.47 ms, 80/298 NPCs active. NPC2's local run with 200 bots + 300 NPCs averaged 9.2 ms. Open: the 8-NPCs-per-view cap isn't enforced; timing tests are flaky under load (watch the CI gate).
