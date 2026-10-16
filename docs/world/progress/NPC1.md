# NPC1 progress (NPC core systems)

Agent: NPC1 (opus). Branch: worktree-agent-aa17aff9dccf7fe1e. Base: main @ 4153155.

## Status
- [x] reset to main, read spec/ledger/proposal/world.ts/protocol
- [x] node_modules: junction to the main checkout (`node_modules` is gitignored)
- [x] tsc baseline: 63 errors (only `server/game/shipTypes.tsx` among server/game + shared)
- [ ] world.ts plumbing (controller, addNpc/removeNpc, guards, npcSunk, AI hook)
- [ ] protocol ent fields + PROTOCOL.md
- [ ] npc modules: geo, steering, tactics, threat, factions, archetypes, brain, lod, director, fairplay, index
- [ ] tests + integration test (50 NPCs + 10 players, 60 s)
- [ ] docs: npc/README.md, SERVER_CONTEXT.md
- [ ] gates: npm test, build, test:bots, tsc

## Decisions
- NPC ids are `npc:<n>`; `isNpcId()` guards gameState.addPlayer (tempPlayerId) and reconnect.
- Guns: `spawnBroadside` fires only to +π/2 (starboard). Tactics supports a `sides` list but uses starboard only.
- Distances: `server/game/npc/geo.ts` `NpcMetric` (torus placeholder, TODO(W1) swap to shared/world/geo.ts metricDelta).

## Spec questions
(see bottom of file, appended as found)

## Next step
world.ts plumbing.
