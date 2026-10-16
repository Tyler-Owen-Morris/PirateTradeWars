# NPC1 progress (NPC core systems)

Agent: NPC1 (opus). Branch: `worktree-agent-aa17aff9dccf7fe1e`. Base: main @ 4153155.

## Status: done (pending producer merge)
- [x] reset to main; read the spec, ledger, proposal, world.ts and protocol
- [x] node_modules: a junction to the main checkout (gitignored)
- [x] tsc baseline: 63 errors. Still 63 after the work, none in touched files.
- [x] world.ts plumbing (controller, addNpc/removeNpc/setNpcInput, npcHook, guards, npcSunk/npcRepChange, byNpc, ent fields)
- [x] protocol ent fields + `parseEntNpcMeta` + PROTOCOL.md "NPC1 clarifications"
- [x] socketHandler and gameState guards (`npc:` ids refused), persistAll skips NPCs, `NPCS_ENABLED` gate
- [x] npc modules: metric, util, steering, tactics, threat, factions, archetypes, brain, lod, director, fairplay, index
- [x] tests: 8 files in `server/game/npc/__tests__/` (61 tests); full suite 183/183
- [x] docs: `server/game/npc/README.md`, SERVER_CONTEXT.md "NPC ships", PROTOCOL.md
- [x] gates: npm test, npm run build, npm run test:bots (see the log below), tsc

## Numbers (desktop, vitest)
- Tactics sim, brigantine against a sloop:
  - stationary target: in broadside position at tick 90 (4.5 s), then holds it 100 % of the time
  - target sailing straight at 4 u/f: tick ~378 (only 1 u/f faster), then holds it about 60 % of the time
  - circling target: tick ~80
- 50 active NPCs plus 10 players, 60 s: avg ~0.25 ms per tick (step plus frames), NPC system at most ~1 ms. About 500 NPC broadsides, about 500 ball hits, 4 sinks; every brain state was seen.
- 300 persistent NPCs (80 active) plus 200 players: avg ~2.1 ms per tick. The NPC system averages ~0.6 ms, peaking at ~6.5 ms on the initial promotion burst.
- The existing 300-ship benchmark still passes: ~4–5 ms spread out, ~7–8 ms packed.

## Merge hotspots with W1 (world.ts)
All NPC1 edits are tagged `NPC1`:
- `WorldPlayer`: 3 fields added after `seenStamp`.
- `WorldEvent.hit`: added `damage?`. `WorldEffect`: added `playerSunk.byNpc?`, `npcSunk` and `npcRepChange`.
- New exports before `NewPlayerInit`: `NewNpcInit`, `NPC_ID_PREFIX`, `isNpcId` and `NpcTickHook`. The World fields `npcHook` and `nextNpcId` sit before `nextEid`.
- **The `addNpc` block before `getPlayer` uses `wrap(init.z, this.mapHeight)`. W1 must turn this into a z clamp** once z stops wrapping.
- `insert()` adds `controller: "player"`.
- `setConnected` and `queueInput` each have a one-line guard.
- `step()`:
  - `prevEvents` captured before `this.events = []`
  - an NPC skip at the top of the removals loop
  - hook call 1b
  - an NPC branch at the top of the movement forEach
- The `tryFire` guard line.
- `applyHit`: the npcSunk/byNpc block, around the `playerSunk` push.
- `stepGold`: one `continue` line for NPC collectors.
- `prepare()`: the `ent` line now builds an `EntMessage` with the optional NPC fields.
- The NPC modules never use raw coordinates. Every distance goes through `npc/metric.ts` (`TODO(W1)`: point `defaultMetric` at shared/world/geo.ts). `steering.LandQuery` is a local structural type, and W1's `LandField` should satisfy it.

## Spec questions (minimal reading chosen, recorded here)
1. **Guns are starboard only.** `spawnBroadside` fires along r + π/2 only, so tactics fight from starboard. A `Side` type exists; adding `"port"` to `GUN_SIDES` enables port guns once physics supports them.
2. **"Cannon range."** `SHIP_STATS.cannonRange` (150–300) is unused by the sim and smaller than a turning circle, while balls fly 2700. NPCs use `DEFAULT_CANNON_RANGE = 600`, overridable per archetype, and hold at 0.6–0.85 of that.
3. **"Pirates hostile to all"** means every *other* faction (−100). The pirates' relation to themselves is +100.
4. **Default player rep:** pirates −60 (hostility 0.6 once the 10-minute shield ends), nations 0, guild +10. Lawful nations add hostility for notoriety and for any bounty (−40).
5. **Rail and docked NPCs are director records, not World ships.** They are promoted at 2500 and demoted beyond 2800 when not in combat. Docked NPCs are never promoted (they are in port).
6. **Loot.** An NPC's loot lives on its record, and its World gold stays 0. NpcSystem drops loot on a sink or surrender, capped per killer per hour (3000). An NPC-on-NPC kill drops 50 % uncapped.
7. **Rep events.** The first hit per NPC per player is "attack": −5 to the victim faction, −2 to its allies, +1 to its enemies. A sink is "sink": −20, −10 and +5. Notoriety rises +2 per lawful attack and +10 per lawful sink.
8. The proposal's "frigate" maps to galleon, and "brig" to brigantine.
9. **Client `RemoteMeta` was not changed** (W1 is editing interpolation). Clients read the NPC fields with `parseEntNpcMeta`.
10. **LOD nearest-player distance is a linear scan**, 300 records × players every 0.5 s. That is fine at 200 players; NPC2 can move it to the grid if the load test says so.

## Next step (for NPC2)
See "What NPC2 must do" in `server/game/npc/README.md`.
