# NPC ships (`server/game/npc/`)

Built by card NPC1 (core systems). Contract: `docs/world/WORLD_SPEC.md` §8. Design: `docs/proposals/WORLD_AND_NPCS.md` §3.
**Status: disabled by default.** `gameState` only builds the system when `NPCS_ENABLED=1|true`. NPC2 turns it on and wires it to real lanes, ports and land.

## How NPCs plug into the World

An NPC is a normal `WorldPlayer` with `controller: "npc"`. It shares the eid space, the grid, physics, cannons and snapshot rows with players. Clients need no new netcode.

The changes to `server/game/world.ts` are all marked `NPC1`:

| Piece | What it does |
|---|---|
| `addNpc(init)` / `removeNpc(eid)` | Create or remove an AI ship. Ids are `npc:<n>`; `isNpcId()` guards connect and reconnect so no client can claim one. |
| `npcHook` | `(world, prevEvents) => void`. Runs inside `step()` after removals and right before movement. Synchronous, no await. |
| `setNpcInput(p, {th,ru,f})` | Sets the input that the movement pass applies this tick. `f` is consumed once. |
| Guards | NPCs never disconnect (`setConnected` is a no-op), never time out, and never accept queued inputs. `tryFire` does not need `connected`. |
| Effects | A sunk NPC emits `npcSunk`, never `playerSunk` or the leaderboard. A player sunk by an NPC gets `playerSunk.byNpc = true`. Gold an NPC collects emits no effect. `npcRepChange` carries reputation changes. |
| `hit` event | Gains a server-only `damage` field, which feeds the threat tables. |
| `ent` | Adds `npc: 1`, `faction` and `title` (see `shared/protocol.ts` `parseEntNpcMeta` and PROTOCOL.md "NPC1 clarifications"). |

## Modules

| File | Purity | Main exports |
|---|---|---|
| `metric.ts` | pure | `NpcMetric` {delta, distSq, offset}, `torusMetric`, `defaultMetric`. **TODO(W1):** switch `defaultMetric` to `shared/world/geo.ts` metricDelta. |
| `util.ts` | pure | `moveDir(r)`, `headingForDir(dx,dz)`, `bearingOf`, `clamp`, `mulberry32` |
| `steering.ts` | pure | `LandQuery`, `OPEN_SEA`; behaviours `seek/flee/arrive/pursue/evade/wander/avoidLand`; `arbitrate`, `withAvoidance`, `toSteer`, `toInput(ship, heading, speed, stats)` |
| `tactics.ts` | pure | `engage(self, target, {range, aimError}, reloading, metric, rng)` → {heading, speed, fire}; `leadPoint`, `beamError`, `inBroadsidePosition`, `firepower`, `shouldDisengage`, `DEFAULT_CANNON_RANGE` (600) |
| `threat.ts` | pure | `ThreatTable` (addDamage, addProximity, decay, top with hysteresis), `callForHelp` |
| `factions.ts` | pure | `FACTION_IDS`, `FACTIONS`, `RELATIONS`, `relation`, `areAllies`, `PlayerStanding`, **`baseHostility`**, `repChangesFor`, `applyRepChanges`, `emitRepChanges` |
| `archetypes.ts` | data | `ARCHETYPES` (merchant, navy, pirate, privateer, pirate_hunter stub), `titleFor`, `rollNpc` |
| `brain.ts` | pure | `decide(brain, arch, perception)`, `scoreStates`, `isDecisionTick`, the states |
| `lod.ts` | pure | `Lane`, `buildPolyline`, `pointAt`, `projectOnto`, `advanceRail`, `nextTier`, `ACTIVE_RADIUS` (2500), `DEMOTE_RADIUS` (2800) |
| `director.ts` | stateful, no World | `Director`: records, `topUp` (0.2 Hz), `stepRails` (2 Hz), `sunk` → respawn timer, `lod` → promote/demote lists |
| `fairplay.ts` | stateful, no World | `FairPlay`: shield, attacker slots, loot cap; `inSafeZone`, `classMatch`, `countsAsPlayerKill` |
| `index.ts` | glue | `NpcSystem` (attach, spawnActive, tick, stats, standings), `npcsEnabled()` |

## One tick of `NpcSystem.tick(prevEvents)`

1. **Events from the previous tick.**
   - A `hit` on an NPC adds damage × 2 threat and calls allies within 1500 for help.
   - If the shooter is a player, it is provoked (its new-player shield drops) and, on the first hit per NPC, its reputation changes and an `npcRepChange` effect is emitted.
   - A `sunk` NPC drops its loot, capped per killer per hour; if another NPC sank it, half drops. Its director slot gets a respawn timer.
2. **Director** (only if there are lanes): it tops up every region target every 5 s, spawning only more than 3000 from players. Rail records move every 0.5 s. LOD runs every 10 ticks:
   - a rail NPC within 2500 of a player is promoted, closest first, up to `maxActive` (80)
   - an active NPC not in combat with no player within 2800 is demoted back onto its lane
3. **Each active NPC.**
   - Sunk wrecks are removed after 10 s.
   - On its staggered 4 Hz tick (`(tick + eid) % 5 == 0`) it perceives (`world.visibleShips(p, senseRadius)`). It adds proximity threat from `baseHostility`, which fair play filters and which is scaled by ship-class match, then picks the top threat with 10 % hysteresis and runs `decide()`.
   - Every tick, its state maps to a desired velocity:

     | State | Behaviour |
     |---|---|
     | travel/patrol | follow the lane (or wander on a leash) |
     | engage | `tactics.engage` |
     | pursue | intercept |
     | flee | evade |
     | loot | arrive at gold |
     | surrender | stop |

   - The desired velocity is blended with land avoidance, then `toSteer` and `toInput` produce the input, which `world.setNpcInput` applies.

The cost was measured in tests on a desktop:
- 50 active NPCs and 10 players: about 0.25 ms per tick for the whole step plus frames.
- 300 persistent NPCs (80 active) and 200 players: about 2.1 ms per tick, of which the NPC system takes about 0.6 ms on average and 6.5 ms at worst (on the promotion burst).

## Physics conventions to remember

- The ship moves along `(−sin r, −cos r)` when sailing ahead, because velocity is negative. `rotationY = 0` is north (−z). `headingForDir` inverts this.
- `spawnBroadside` fires only along `r + π/2`, the **starboard** side. Tactics models a `Side`, but `GUN_SIDES = ["starboard"]`. If port guns are added to physics, add `"port"` there and `chooseSide` picks the cheaper turn.
- Balls don't inherit ship velocity. Lead = target velocity × flight time (900 units/s).

## Tuning

- **Difficulty:** `Archetype.aimError`, in radians of noise added to the beam check (navy 0.08, pirate 0.15, merchant 0.25).
- **How readily NPCs fight:**
  - `aggression` and `courage` per archetype
  - `COMBAT_ENTER` / `COMBAT_EXIT` (threat hysteresis)
  - `STAY_BONUS` and `MIN_DWELL_MS` (state hysteresis), in `brain.ts`
- **Engagement range:** `DEFAULT_CANNON_RANGE` (600). The hold band is `HOLD_MIN`–`HOLD_MAX` (0.6–0.85); while reloading the NPC kites to 0.85. The fire arc is `FIRE_ARC` (12°).
- **Population:**
  - `DEFAULT_TARGETS` and `DEFAULT_DIRECTOR` (`maxPersistent` 300, `maxActive` 80, `minSpawnDist` 3000, respawn 2–5 min)
  - Pass `director: { targets, laneRegion }` to `NpcSystem` for per-region fleets
- **Fair play:** `NEW_PLAYER_SHIELD_MS` (10 min), `MAX_ATTACKERS_PER_PLAYER` (2), `LOOT_CAP_PER_HOUR` (3000).

## Factions: the one plug point

`factions.baseHostility(npc, other)` returns a hostility from 0 to 1. Every hostility decision goes through it, including proximity threat and target choice; call-for-help uses `areAllies` from the same file. To add real faction play later:

1. **Per-nation reputation:** already in the model. `PlayerStanding.rep[faction]` plus `notoriety` and `bounty`. `playerRelation()` turns them into a −100 to 100 relation. NPC2 loads and saves `PlayerStanding` with the player in Redis, from the `npcRepChange` effects, and puts it in `NpcSystem.standings`.
2. **Dynamic diplomacy (wars, treaties):** pass a different `RelationMatrix` into `relation` / `baseHostility` / `areAllies`, for example a mutable matrix owned by a diplomacy module.
3. **Emergent "Spain likes you, so Portugal attacks you":** `repChangesFor(victim)` already spreads rep to the victim's allies and enemies. Combined with call-for-help this needs no AI changes.

## What NPC2 must do to make them live

- Construct `NpcSystem` with:
  - `lanes` from `shared/world/lanes.json`
  - `safeZones` from ports.json (the `dock` point and `safeRadius`)
  - `land`, the server's `LandField` (W1)
  - `metric`, the W1 geo metric (or update `defaultMetric`)
  - `director.targets` per region, plus `laneRegion`
- Set `NPCS_ENABLED=1` in the EB environment once the load test passes. The gate is 200 bots plus 300 NPCs at a tick under 25 ms.
- Persist `npcRepChange` (`gameState.runEffect` has a TODO), and load standings on connect.
- Client: show nameplates and flags from `ent.npc`/`faction`/`title`, read with `parseEntNpcMeta`. `RemoteMeta` does not carry them yet; that was left alone to avoid colliding with W1's interpolation work.
