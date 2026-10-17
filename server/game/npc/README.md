# NPC ships (`server/game/npc/`)

Built by card NPC1 (core systems). Contract: `docs/world/WORLD_SPEC.md` §8. Design: `docs/proposals/WORLD_AND_NPCS.md` §3.
**Status: live, ON by default (NPC2).** `gameState` builds `createLiveNpcSystem(world)` unless `NPCS_ENABLED=0|false|off|no`. Built by NPC1 (core) and NPC2 (real map, population, navigation, standing persistence, client nameplates).

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
| `metric.ts` | pure | `NpcMetric` {delta, distSq, offset}; `geoMetric` (default: shared/world/geo.ts, x wraps, z clamped, x scaled by cos lat), `torusMetric` (logic-only tests) |
| `util.ts` | pure | `moveDir(r)`, `headingForDir(dx,dz)`, `bearingOf`, `clamp`, `mulberry32` |
| `steering.ts` | pure | `LandQuery`, `OPEN_SEA`; behaviours `seek/flee/arrive/pursue/evade/wander/avoidLand`; `arbitrate`, `withAvoidance`, `toSteer`, `toInput(ship, heading, speed, stats)` |
| `tactics.ts` | pure | `engage(self, target, {range, aimError, cannonCount?, aimSlack?}, reloading, metric, rng)` → {heading, speed, fire}; `leadPoint` (arc lead for turning targets), `displacement`, `fireTolerance`, `beamError`, `inBroadsidePosition`, `firepower`, `shouldDisengage`, `DEFAULT_CANNON_RANGE` (600) |
| `threat.ts` | pure | `ThreatTable` (addDamage, addProximity, decay, top with hysteresis), `callForHelp` |
| `factions.ts` | pure | `FACTION_IDS`, `FACTIONS`, `RELATIONS`, `relation`, `areAllies`, `PlayerStanding`, **`baseHostility`**, `repChangesFor`, `applyRepChanges`, `emitRepChanges` |
| `archetypes.ts` | data | `ARCHETYPES` (merchant, navy, pirate, privateer, pirate_hunter stub), `titleFor`, `rollNpc` |
| `brain.ts` | pure | `decide(brain, arch, perception)`, `scoreStates`, `isDecisionTick`, the states |
| `lod.ts` | pure | `Lane`, `buildPolyline`, `pointAt`, `projectOnto`, `advanceRail`, `nextTier`, `ACTIVE_RADIUS` (2500), `DEMOTE_RADIUS` (2800) |
| `director.ts` | stateful, no World | `Director`: records, `topUp` (0.2 Hz), `stepRails` (2 Hz), `sunk` → respawn timer, `lod` → promote/demote lists |
| `fairplay.ts` | stateful, no World | `FairPlay`: shield, attacker slots, loot cap; `inSafeZone`, `classMatch`, `countsAsPlayerKill` |
| `index.ts` | glue | `NpcSystem` (attach, spawnActive, promoteRecord, tick, stats, standingOf), `createLiveNpcSystem`, `npcsEnabled()` |
| `population.ts` | data | NPC2: `PORTS`, `LANES`, `laneZone`, `liveFleets()` (the population table), `portSafeZones`, `liveDirector` |
| `nav.ts` | pure | NPC2: `segmentClear`, `planPath` (bounded A* on the SDF back to a lane) |

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
     | engage | `tactics.engage`, then `aim` (F1 fire control, one tick ahead) |
     | pursue | intercept |
     | flee | committed course straight away from the threat (F1; was `evade`) |
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

## Combat fixes after Q1 (card F1, bug B2/B3)

Q1 saw a provoked pirate loop 375 → 1060 → 375 around a still player, never fire and never break off. What was actually wrong (each has a regression test in `__tests__/combat-b2.test.ts`, which runs the real World + NpcSystem):

| Problem | Fix |
|---|---|
| **Shots went wide.** The fire gate was ±12° of the beam plus ±aimError noise (≈ 100+ units off at 500), judged on the pose *before* the tick's rudder, but the World fires *after* movement and one tick of rudder is 0.15 rad. 1 hit in 28 volleys on a still target. | `tactics.fireTolerance(dist, cannons)`: the angle the 20-unit hit circle subtends (× 0.8) plus half the broadside fan. `NpcSystem.aim` re-checks the shot one tick ahead with the real `stepShip` for the planned rudder and 0/±1, and fires with the best one. Turning targets are led along their arc (`SteerTarget.turnRate` = the rudder they hold). Now ≈ 25–90 % hits depending on ship and target motion. |
| **The loop was a flee.** A pirate evading an attacker's *predicted* position while the attacker orbits it at broadside range sweeps its escape course round: it sails in circles (≈ 2 laps in 17 s) beside the attacker — the radial in/out Q1 measured from the player's seat (Q1's pirate was most likely fleeing a navy beyond its 2,500 filter). | A fleeing ship commits to a course straight away from where the threat is, re-aimed only when the threat gets more than `FLEE_REAIM_ANGLE` (90°) off dead astern. |
| **Lost the slot race.** Fair play caps attackers at 2 per player; a pirate the player hit could lose both slots to its neighbours, drop the player and sail off. | Self-defence: an NPC hit by a player may fight that player for `SELF_DEFENCE_MS` (60 s) regardless of the shield and the slot cap (`FairPlay.claim(…, force)`); safe zones still apply. |
| **Friendly fire** from a partner's stray ball added threat and called help against the partner, so pirate pairs turned on each other. | Hits from allies (`areAllies`) are ignored; allies are never a valid target (`canFight`). |
| **Hurt pirates fought on.** Disengage was hp < (1 − courage) × 0.6 and only +1 to the flee score, which a fight against a weaker ship (score up to ≈ 2.4) beat. | `shouldDisengage`: hp ≤ (1 − courage) × 0.7 (`DISENGAGE_HP_SCALE`): pirate 35 %, privateer 28 %, navy 7 %. Being that hurt adds `HURT_FLEE_BONUS` (3), which beats any fight score; being merely outgunned still adds 1. Merchants' surrender score is now 10+ so it still beats flee. |
| **Merchant dead in the water (B3).** A merchant arriving at its lane end docks (idles 20–60 s); in a port safe zone it cannot react to an attacker, so it sat still while being shot. | A hit marks the NPC under fire for `UNDER_FIRE_MS` (10 s): it will not dock, and a hit on a docked ship cancels the idle (it sails out on its next lane). |

Engagement geometry: TURN_SPEED is a fixed 0.05 rad/frame at any speed, so the turning radius is 20 × speed (sloop 80 … dreadnought 180), well inside the hold band; slowing down is not needed to tighten the turn. Far from the target the course is held `APPROACH_MAX_K` (π/3) off straight-at-it, a spiral that brings the target onto the starboard beam on the approach. Guns: physics fires starboard only, for players and NPCs alike (`spawnBroadside`), so `GUN_SIDES` stays `["starboard"]`. Known limit: a starboard-only sloop cannot catch a sloop running straight away at the same speed (a stern chase at equal speed never closes); it gets its broadside in on a crossing or head-on pass, and faster ships run slower ones down.

Measured in the browser (real server, F1): a pirate sloop vs a still player sloop fired 14–15 times in 30 s and hit 6–7 times; vs a circling player 12 shots / 10 hits; a brigantine vs a straight-sailing sloop 8 / 7 (sank it); at 30 % hp both ship types turned and ran within a second (510 → 1,700–1,970 units in 4–6 s).

## Tuning

- **Difficulty:** `Archetype.aimError` (navy 0.08, pirate 0.15, merchant 0.25): per volley, the NPC accepts up to rng × aimError radians of extra beam error (`ActiveNpc.aimSlack`, re-rolled after each shot). Pirates are now dangerous: a still player sloop is sunk by a pirate sloop in roughly 30–40 s. Raise `aimError` or lower `HIT_TOLERANCE_FRAC` to soften them.
- **Fire control:** `fireTolerance` (`HIT_TOLERANCE_FRAC` 0.8), `FIRE_RANGE_FACTOR` (1.5 × engage range = 900 units), `APPROACH_MAX_K`.
- **Breaking off:** `DISENGAGE_HP_SCALE` (0.7), `HURT_FLEE_BONUS` (3), `FLEE_REAIM_ANGLE` (90°), `SELF_DEFENCE_MS` (60 s), `UNDER_FIRE_MS` (10 s).
- **How readily NPCs fight:**
  - `aggression` and `courage` per archetype
  - `COMBAT_ENTER` / `COMBAT_EXIT` (threat hysteresis)
  - `STAY_BONUS` and `MIN_DWELL_MS` (state hysteresis), in `brain.ts`
- **Engagement range:** `DEFAULT_CANNON_RANGE` (600). The hold band is `HOLD_MIN`–`HOLD_MAX` (0.6–0.85); while reloading the NPC kites to 0.85. `FIRE_ARC` (12°) now only judges "in broadside position" (tests); firing uses `fireTolerance` (F1).
- **Population:**
  - `DEFAULT_TARGETS` and `DEFAULT_DIRECTOR` (`maxPersistent` 300, `maxActive` 80, `minSpawnDist` 3000, respawn 2–5 min)
  - Pass `director: { targets, laneRegion }` to `NpcSystem` for per-region fleets
- **Fair play:** `NEW_PLAYER_SHIELD_MS` (10 min), `MAX_ATTACKERS_PER_PLAYER` (2), `LOOT_CAP_PER_HOUR` (3000).

## Factions: the one plug point

`factions.baseHostility(npc, other)` returns a hostility from 0 to 1. Every hostility decision goes through it, including proximity threat and target choice; call-for-help uses `areAllies` from the same file. To add real faction play later:

1. **Per-nation reputation:** already in the model. `PlayerStanding.rep[faction]` plus `notoriety` and `bounty`. `playerRelation()` turns them into a −100 to 100 relation. NPC2 loads and saves `PlayerStanding` with the player in Redis, from the `npcRepChange` effects, and puts it in `NpcSystem.standings`.
2. **Dynamic diplomacy (wars, treaties):** pass a different `RelationMatrix` into `relation` / `baseHostility` / `areAllies`, for example a mutable matrix owned by a diplomacy module.
3. **Emergent "Spain likes you, so Portugal attacks you":** `repChangesFor(victim)` already spreads rep to the victim's allies and enemies. Combined with call-for-help this needs no AI changes.

## Live behaviour on the real map (NPC2)

### Population (`population.ts` `liveFleets()`, 300 persistent, ≤ 80 active)

Lanes get a zone from their two ports' regions (`laneZone`): **americas** (both ends Caribbean/Gulf or the American Atlantic coast), **atlantic** (Americas ↔ Europe/Africa crossings), **europe**, **africa**, **east** (Indian Ocean, East Asia, Acapulco).

| Fleet (region label) | Archetype | Count | Lanes | Faction |
|---|---|---|---|---|
| americas/merchant | merchant | 60 | americas | origin port's nation (pirate havens → merchants_guild) |
| atlantic/merchant | merchant | 30 | atlantic | origin port |
| europe/merchant | merchant | 30 | europe | origin port |
| africa/merchant | merchant | 12 | africa | origin port |
| east/merchant | merchant | 28 | east | origin port |
| americas/navy/{spain 10, england 8, france 4, netherlands 3} | navy | 25 | americas lanes touching that nation's ports | the nation |
| europe/navy/{england 5, spain 4, france 3, netherlands 3, portugal 3} | navy | 18 | europe lanes touching its ports | the nation |
| east/navy/{portugal 4, netherlands 4 (+africa), spain 4} | navy | 12 | east lanes touching its ports | the nation |
| americas/pirate/havens | pirate | 35 | americas lanes touching Nassau or Tortuga | pirates |
| americas/pirate/lanes | pirate | 6 | americas | pirates |
| atlantic/pirate | pirate | 12 | atlantic | pirates |
| east/pirate/sainte_marie | pirate | 12 | lanes touching Île Sainte-Marie | pirates |
| americas/privateer | privateer | 16 | americas | england / france / netherlands |
| atlantic/privateer | privateer | 4 | atlantic | spain |

About 63 % of the fleet is in the Caribbean/Gulf and on the crossings. A fleet's ships keep to its lanes forever: at every lane end the next lane is drawn from the fleet's lane filter (a navy that reaches a foreign port with no home lane turns around). Groups spawn from the archetype's `group` (merchant convoys 1–3, navy and pirate pairs) on one lane, `GROUP_SPACING` (160) apart, with the same ship type and faction; members leave port right after their leader and take the lane it took (`NpcRecord.leader`).

### Navigation on real coastlines (`index.ts` `followLaneOrWander` / `unstick`, `nav.ts`, `steering.ts`)

1. **Lane following** steers for a point `LANE_LOOKAHEAD` (250) ahead on the lane; the follow point is clamped to the lane end so arrivals always trigger. After any other state (fight, flight, unstick) it re-projects onto the nearest lane point.
2. **Line of sight.** If the straight line to that point comes within hull + `LOS_MARGIN` of land (spits, estuaries), it steers for the lane just ahead of the nearest lane point instead (`LOS_STEP` 60).
3. **Path back to the lane.** If that is also behind land (far off the lane after a chase), `planPath` runs a bounded A* (80-unit cells, ≤ 160×160) to it; at most `NAV_PLANS_PER_TICK` (2) plans per tick, replans every `NAV_REPLAN_MS` (5 s). No path → coast following (`wallFollow`, flips side after 40 s).
4. **Coast feelers** (`avoidLand`) slide along the coast tangent closest to the *desired* direction, with side hysteresis (`AvoidMemo`), so a goal straight behind a coast never makes the rudder see-saw.
5. **Unstick.** Two 1 s checks with < 15 % progress while touching the coast and wanting to move → 3 s of turning the bow along the land normal (reversing until within 60° of it).

Measured (`__tests__/live-world.test.ts`, 100 NPCs on random lanes, 3 simulated minutes, real tiles): longest pin against a coast 3 s, ≤ 1 s of no progress beyond a 10 s window, 0.2 % of samples stuck, 0 ticks with a hull centre on land, ~36 path plans (≤ 1.1 ms each).

### Player standing

`PlayerState.standing` (`{rep, notoriety, bounty}`, shared/protocol.ts `StandingState`) lives on the WorldPlayer; `NpcSystem.standingOf` creates it on first use and bumps `standingVersion` on every change, which sends the player a `standing` message. `gameState` persists it after `npcRepChange` effects; `redisStorage` stores it as JSON in the player hash; `restorePlayer` reads it back. Notoriety decays `NOTORIETY_DECAY_PER_MIN` (2) per minute, online and for offline time on reconnect. Bounty is stored and sent but nothing sets it yet.

### Live tuning knobs

- Population: `liveFleets()` counts and lane filters; `GROUP_SPACING`; `DOCK_MIN_MS`/`DOCK_MAX_MS`.
- Navigation: `LANE_LOOKAHEAD`, `LOS_MARGIN`/`LOS_STEP`, `NAV_*` (nav.ts `NAV_CELL`, `NAV_MAX_SIDE`, `NAV_MARGIN`), `WALL_*`, `UNSTICK_*`, steering `LAND_CLEARANCE`, `AVOID_SIDE_HYSTERESIS`.
- Standing: `NOTORIETY_DECAY_PER_MIN`, `NOTORIETY_DECAY_EVERY_TICKS`.
- Kill switch: `NPCS_ENABLED=0`.

### Cost

200 players + 300 NPCs (80 active) on the real map, vitest on a desktop: 2.4 ms per tick spread over all ports, 2.6 ms packed at the 5 starter ports (step + frames for 200 clients); NPC system ≈ 0.6 ms average, worst ≈ 8 ms (the first promotion burst). Real server with 200 WebSocket bots + 300 NPCs: 9.2 ms average tick (5.9 ms with NPCs off), all bot assertions pass, after `gameState` started corking each client's socket per tick (see SERVER_CONTEXT.md). The LOD pass is still a linear scan (300 records × players every 0.5 s, ≤ 5 ms worst at 200 players), so it was not moved to the grid.
