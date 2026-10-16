# NPC2 progress (NPCs live on the real map)

Agent: NPC2 (opus). Branch: `worktree-agent-aab102dc9d9496a69`. Base: `npc2-base` (main + NPC1 merge, 334b9e9), then `git merge main` (W3 terrain, W4 ports) at 59dd936.

## Status: done (pending producer merge)
- [x] 1. W1 reconciliation: `npc/metric.ts` → `geoMetric` on shared/world/geo.ts (x wraps, z clamped, x / metricX at the mid latitude); steering `LandQuery` = `Pick<shared LandQuery, distance|normal>`; NpcSystem defaults to `world.land`. The 6 failing NPC1 tests now run in real coordinates (equator band on the all-water field; the tactics sim uses the geo metric). Bug fixed on the way: the lane follow point advanced in 50-unit steps and never reached a lane end that was not a multiple of 50, so NPCs circled the last point forever.
- [x] 2. Population: `npc/population.ts` (lanes.json + ports.json, `laneZone`, `liveFleets()`: 300 = 160 merchants, 55 navy, 65 pirates, 20 privateers). Director: per-fleet lane filters (spawn + every lane hand-over), `originFaction` merchants, groups/convoys (`group`, `leader`, `GROUP_SPACING`), wrecks and manual NPCs count against `maxActive`.
- [x] Land avoidance on real coasts: line of sight to the follow point, A* path back to the lane (`npc/nav.ts`), coast following fallback, avoidance tangent hysteresis + desired-direction tangent, unstick manoeuvre, re-projection onto the lane. Test: 100 NPCs × 3 simulated minutes on the real tiles.
- [x] 3. NPCs ON by default (`NPCS_ENABLED=0|false|off|no` disables). `gameState` uses `createLiveNpcSystem`. test:bots passes with NPCs on.
- [x] 4. Standing: `PlayerState.standing`, Redis JSON field, `restorePlayer`, `npcRepChange` → `flushStandings` → `updatePlayerStanding`, notoriety decay (online 10 s cadence, offline on reconnect), `standing` message (PROTOCOL.md "NPC2 clarifications").
- [x] 5. Client: `RemoteMeta.npc/faction/title`; `Ship` nameplate line "Spanish Navy — Galleon" + nation flag; `lib/world/factions.ts`; `net.standing`.
- [x] 6. Load: `live-world.test.ts` "200 players + 300 NPCs" (two layouts). LOD scan left linear (cheap).
- [x] 7. Docs: npc/README.md (live behaviour, population table, knobs, cost), SERVER_CONTEXT.md, PROTOCOL.md, CLIENT_CONTEXT.md.

## Numbers (desktop)
- Stuck test (100 NPCs, 180 s, real land): longest pin against a coast 3.0 s; max no-progress run 1 s beyond a 10 s window; 15–17 stuck NPC·s of ~7000 moving samples (0.2 %); 0 on-land ticks; ~20 unsticks; ~36 path plans. Before the fixes: 167 s and 50 % stuck.
- In-process load, 200 players + 300 NPCs (80 active), step + frames for 200 clients: 2.4 ms avg (spread over 27 ports), 2.6 ms (packed at the 5 starter ports); NPC system ~0.6 ms avg, ≤ 8 ms worst; path plan ≤ 1.1 ms; LOD pass ≤ 5 ms.
- Real server + WebSocket bots (bots on the same Windows desktop, dev mode, local Docker Redis):
  - `npm run test:bots` (30 bots, NPCs on): all assertions pass, 20 snapshots/s, worst gap 65 ms; server tick avg 1.5 ms with 80/296 NPCs active.
  - 200 bots + 300 NPCs, 75 s (`run-bot-test.ts --bots 200 --duration 75`): all assertions pass, 20 snapshots/s, worst gap 69 ms, 29 KB/s per bot; **server tick avg 9.2 ms**, NPC system max 7.9 ms. NPCs off, same run: 5.9 ms.
  - Before the socket cork fix (below) the NPC-on 200-bot run collapsed (19.6 ms, then 5 snapshots/s and 24 s stalls). A CPU profile showed ~30 % of the process in `writev`: every WebSocket message (each fire/hit event near the crowded starter ports, plus `ent`/`s`) was its own socket write. `gameState.runTick` now corks each client's socket around that tick's frames, so a client gets one write per tick. Same bytes and frames on the wire, no protocol change.
- Harness gotcha (pre-existing): on Windows `run-bot-test.ts` sometimes leaves the spawned server running after it exits, and a stale server on the port makes the next run test old code ("EADDRINUSE" in the log). Use a free `--port` and check for leftovers.

## Spec questions (minimal reading chosen)
1. **Merchants from pirate havens** sail as `merchants_guild`, not `pirates` (a pirate-flagged merchant would be fair game for every navy).
2. **Convoys**: members share lane, ship type (so speed) and faction, spawn 160 apart, leave port 1.5 s apart after the leader and take its lane. In the active tier each member steers on its own; they can drift apart in a fight.
3. **"Navy near their nation's ports"** = lanes that touch one of the nation's ports in the fleet's zone. A navy arriving at a foreign port with no such lane turns back on the same lane.
4. **Privateers**: English/French/Dutch in the Caribbean, Spanish (guarda costa) on the crossings. Hostility still comes from the static matrix (privateers are lawful, so they fight pirates); nation-vs-nation privateering needs the dynamic diplomacy hook.
5. **Standing to the client** is a separate low-rate `standing` message (not in `me`), so the 20 Hz snapshot is unchanged.
6. **Notoriety decay**: 2 per minute; offline time counts. Bounty is persisted and sent but nothing sets it yet (no bounty feature in the spec).
7. **"Stuck"** in the test = touching the coast with |speed| < 0.3 (any state but surrender/idle), plus < 15 % progress over 10 s while travelling. Hull centres on land are reported (0 in the final run).
8. Path plans are capped at 2 per tick across all NPCs; a capped NPC follows the coast until its turn.
9. The proposal's "≤ 8 NPCs in one player's view" density cap is not enforced (LOD only caps 80 active worldwide).

## Merge notes
- `server/game/npc/population.ts` reads `shared/world/ports.json` directly by text id (lanes use text ids); W4's numeric-id `shared/world/ports.ts` is not needed here.
- World edits are tagged `NPC2` (PlayerState.standing, standingVersion/standingSent, `standing` message in prepare, restorePlayer, toPlayerState). redisStorage: `standing` field + `updatePlayerStanding`. socketHandler: offline decay on reconnect.
- `gameState.runTick`: per-client socket cork around the frame sends (`ClientSocket._socket`); `flushStandings`; NPC counts in the `[tick]` log line.
- Client: OtherShips.tsx (2 props), Ship.tsx (flag group + title line), interpolation.ts (RemoteMeta fields), netClient.ts (`standing` case). Merged cleanly with W3.
- tsc: 59 errors after the merge, none new in touched files (Ship.tsx:104 Howl.volume and redisStorage getPlayer(parseInt) are pre-existing).
