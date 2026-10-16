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
| W3 | Rendering: floating origin for every object, camera-following ocean, then terrain chunks from SDF tiles (beach, grass, forest, rock), surf and shallow tint, ice wall, land splash effect | 1 (terrain after W1 and W2 merge) | agent (opus) | worktree-agent-a5da9a58c12c71d40 | part A merged; part B in-progress | terrain, see progress/W3.md |
| NPC1 | NPC core: controller field and guards in World, ent fields, steering→input, brain (state machine plus utility), threat table, faction model and static matrix, archetypes, LOD tiers and director skeleton, unit tests | 1 | agent (opus) | worktree | in-progress | see progress/NPC1.md |
| W4 | Ports integration: server reads ports.json, portsVersion re-seed, dock-radius checks (including trade), spawn at port, Redis player migration, client ports and towns at real sites | 2 (after W1 and W2) | agent (opus) | worktree | in-progress | see progress/W4.md |
| W5 | Navigation UI: world map (M), minimap with metric scaling, compass with heading and lat/lon, port distance and bearing | 2 (after W1 and W2) | agent (sonnet) | worktree | in-progress | see progress/W5.md |
| NPC2 | NPCs live: routes on lanes.json, director population, broadside combat, flee and surrender, pirates, navy and privateers, rep in Redis, fair-play rules, NPC load test (200 bots + 300 NPCs, tick < 25 ms) | 2 (after NPC1, W1, W2) | — | — | todo | — |
| Q  | Integration: full gate, bots, browser play-test (circumnavigate, coast slide, ports, NPC fights), docs, **single production deploy**, prod verification | 3 | producer + QA agent | main | todo | — |

## Log
- 2026-10-16 Plan approved. Spec and ledger written. Phase 1 (W1, W2, W3, NPC1) launching in parallel.
- 2026-10-16 Launched W1, W2, W3 (Part A floating origin; Part B terrain waits for W1+W2 merge), NPC1 in parallel worktrees (all opus).
- 2026-10-16 W3 Part A done (3eb543d, floating origin + camera-following ocean, 123 tests, build, bots PASS). Held unmerged: client assumes C=400000, must merge together with W1. Reconcile its local geo constants (TODO(W1)) after W1.
- 2026-10-16 W2 merged into main (6f1f300+f1c1d0a): 27 ports, 75 lanes, 1.47 MiB gzipped tiles (version fb6d8abef3), map PNGs; 125 tests pass. Told W1 about gzip encoding. Spec clarifications appended.
- 2026-10-16 W1 merged (d2f8c4e) then W3 part A merged, no conflicts. main: 173 tests pass, build OK. W1 bots PASS on real land. Launching phase 2: W3 part B (terrain), W4 (ports), W5 (navigation UI). NPC2 waits for NPC1.
