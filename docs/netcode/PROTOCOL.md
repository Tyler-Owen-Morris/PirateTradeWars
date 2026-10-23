# Netcode Protocol & Simulation Spec (Wave 1)

This is the contract between `shared/`, `server/` and `client/`. Cards N1–N4 implement it. If an
implementer must deviate, they write the deviation into their progress file AND update this doc.

## 1. Why (bugs this fixes)
- Split worlds: EB scaled to up to 4 instances, each with its own in-memory world → card A pins to 1.
- Client and server ran **different physics**: client `Player.tsx` used accel/drag (W = half speed),
  `GameScene.tsx` sent W = `-maxSpeed`, S = `+maxSpeed/2`, and the server applied the speed instantly.
- `Player.tsx` `useEffect` snapped the local ship to every server update (rubber-banding).
- `OtherShips` lerped toward the latest packet and `<Ship position=…>` re-applied raw positions each render.
- Server `tick()` was `async` and awaited Redis + Segment mid-loop under `setInterval` → overlapping/stalled ticks.
- Disconnected ships kept their speed for the 60s grace period (ghost ships).
- 10Hz full-`PlayerState` JSON to everyone within 2000 units (leaks gold/cargo), O(N²).
- `client/src/lib/stores/useSocket.tsx` imported `server/game/gameState` into the client bundle.

## 2. Simulation (shared/physics.ts) — identical on client and server
- Fixed step: `TICK_HZ = 20`, `TICK_DT = 0.05` s. Server runs exactly one step per tick.
  Inside a step, physics may sub-step at 1/60 s (3 sub-steps) for feel; must be deterministic given inputs.
- Units keep the existing convention: speeds are "units per 1/60 s"; displacement = velocity * dt * 60.
- Ship kinematic state: `{ x, z, rotationY, velocity }`. Heading vector = `(sin(rotationY), cos(rotationY))`
  (i.e. `(0,0,1)` rotated about Y, same as today). Position += heading * velocity * dt * 60.
- **Sign convention (preserved from the live game):** negative velocity = sailing forward (W key).
  W/Up = full ahead → target velocity `-maxSpeed`. S/Down = reverse → target `+maxSpeed * 0.5`.
  No throttle → decay to 0 with drag. Accelerate toward target (use the old Player.tsx constants as a
  starting point: accel 0.15/frame forward, 0.1/frame reverse, drag 0.97 + decel 0.03/frame).
- Rudder: A/Left = +turn, D/Right = −turn, `TURN_SPEED = 0.05` rad per 1/60 s (= 3 rad/s), as today.
- World wraps: `MAP_WIDTH`/`MAP_HEIGHT` from `shared/gameConstants.ts` (10000). Provide helpers:
  `wrap(v, size)`, `wrappedDelta(a, b, size)` (shortest signed delta), `wrappedDistSq(ax, az, bx, bz)`,
  `lerpWrapped(a, b, t, size)`, `lerpAngle(a, b, t)`.
- `stepShip(state, input, stats) → state` is a pure function. Unit tested for determinism and wrapping.
- Cannonballs: `stepBall`, speed 15 units/(1/60 s), lifetime 3000 ms, spawn rule identical to today's
  `fireCannonBall` (cannonCount balls, spread 0.1 rad, broadside `rotationY + π/2`, 10 units out).
  Position of a ball at time t is analytic: `p0 + dir * speed * 60 * t` (wrapped) — clients simulate locally.

## 3. Transport
- Same endpoint: WebSocket `/game-ws` (ws library), JSON text frames. Binary is a Wave 2 concern.
- Heartbeat: server pings every 15 s via ws ping; a socket missing 2 pongs is terminated.
  Server also sends `{t:"pong"}` in reply to client `{t:"ping",c:<clientTime>}` (used for RTT/clock offset).
- Every server→client message has `t` (type). Existing messages that the UI relies on keep their names
  (`connected`, `reconnected`, `tradeSuccess`, `upgradeSuccess`, `repairSuccess`, `gameEnd`, `error`,
  `nameError`, `welcome`) and payload shapes, EXCEPT that `players`/`cannonBalls`/`goldObjects` full dumps
  are removed from them (the first snapshot delivers world state). They may keep `type` instead of `t`
  for backward-compat; new messages use `t`.

## 4. Client → server
| msg | fields | notes |
|-----|--------|-------|
| `connect` / `reconnect` | unchanged | existing name/ship flow |
| `input` | `{t:"input", s:seq, th:-1|0|1, ru:-1|0|1, f:0|1}` | one per client sim step (20/s). `th=1` = W (ahead), `-1` = S (reverse). Server clamps values, ignores out-of-order seq, caps queue at 40 (= 2 s, drop oldest; was 10 before 2026-10-23). |
| `ping` | `{t:"ping", c:clientTimeMs}` | every 2 s |
| `trade`, `upgradeShip`, `repairShip`, `scuttle` | unchanged shape | W4: trade, upgrade and repair are rejected with `error "Too far from port"` unless the ship is within 300 (metric) of the port's dock. `portId` is the numeric id from `GET /api/ports` (1-based index in ports.json). |

The client never sends position, speed, direction or rotation. The server is authoritative.

## 5. Server tick (20 Hz)
- Drift-free loop: `performance.now()` accumulator + `setTimeout`, runs `while (acc >= TICK_DT)` steps,
  max 5 catch-up steps then drop. **No `await` inside the tick.** Redis/Segment writes go into a
  fire-and-forget queue drained outside the tick; errors are logged, never thrown into the loop.
- Per player per tick: consume ONE queued input; `stepShip`; record `lastSeq` processed. If the queue
  holds > 3 inputs, consume 2 (catch-up).
- **Empty queue = HOLD (changed 2026-10-23).** If a connected player's queue is empty (its next input is
  late), the ship does NOT step that tick: position, rotation and velocity stay as they are, and `a`
  does not advance. Invariant: a connected ship's server state is exactly `stepShip` over inputs
  1..`a` in order, which is what the client predicts, so reconciliation never corrects it (open water).
  The late input is simulated when it arrives (catch-up repays the pause). Until 2026-10-23 the server
  instead stepped with the last input (a "phantom" tick) and then ALSO simulated the late input, so
  every starved tick warped the client forward one tick of travel and the post-stall burst overflowed
  the 10-input queue and jumped it back (BUILD_STATE.md, bug 2026-10-23).
  - Consequence: a hidden tab (one neutral input, then silence) leaves the ship held in place, not
    coasting; client prediction resumes from the same state when the tab returns.
  - Inputs dropped by the queue cap (uplink outage > ~2 s) were never simulated: the client gets a
    backward correction for them. That is the only remaining starvation-related correction.
- Disconnected player (grace period): input forced to `th:0, ru:0, f:0` — ship coasts to a stop.
  Visible to others with a `disconnected` flag. Removed after GRACE_PERIOD as today.
- Spatial hash grid (cell 500) rebuilt each tick; used for interest, cannonball hits and gold pickup.
- Interest radius 2000 (as today) for ships, 1000 for gold.

## 6. Server → client snapshot (every tick)
```
{ t:"s", k:tick, st:serverTimeMs, a:lastProcessedInputSeq,
  me:{ x,z,r,v,hp,maxHp,gold,cargoUsed,cargoCapacity,sunk,canFire,reloadMs, shipType },   // full private self state
  e:[ [eid, x, z, r, v, hp, flags], ... ],   // other visible ships, numbers rounded (x,z 1 decimal, r 3 decimals)
  g?:[ [id, x, z, gold], ... ]               // gold objects in range, only every 10th tick
}
```
- `eid` = small integer entity id assigned by the server per player (stable for the player's life).
- `flags` bitfield: 1 = sunk, 2 = disconnected, 4 = firing.
- Entity metadata is sent once when an entity enters a client's view (and on change):
  `{t:"ent", eid, id, name, shipType, maxHp}`. On leaving view: `{t:"gone", eid}`. Server tracks the
  known-set per client. Other players' gold/cargo/inventory are NEVER sent.
- Events (sent immediately, to clients that can see them):
  - `{t:"fire", eid, k:tick, balls:[[id, x, z, dx, dz]...], spd, life}` — clients simulate the balls.
  - `{t:"hit", target:eid|"me", ball:id, hp}` — remove ball, show impact.
  - `{t:"sunk", eid}` ; `{t:"goldCollected", gold, newTotalGold}` (to the collector).

**N1 clarifications (implemented in `shared/protocol.ts`, which is the source of truth for shapes):**
- `me.eid` (optional number): the receiver's own entity id, so it can recognise its own `fire` events.
- `sunk.eid` may be `"me"` (like `hit.target`) when the receiver's own ship sank.
- `pong` is `{t:"pong", c:<echoed client ms>, st:<server ms>}`.
- Ball ids in `fire`/`hit` are integers; gold row ids are the existing string ids. `v` is rounded to 2 decimals.
- `goldCollected` moves to the `t` key like the other §6 events.
- Server validates every frame with `parseClientMessage` (accepts `t` or `type`, clamps th/ru/f, floors
  seq, drops unknown fields, rejects names > 32 chars and trade quantities < 1). Cannonball hits use
  `segmentHitsCircle` (2D, wrap-aware, `SHIP_HIT_RADIUS = 20`), replacing the old 3D sphere test.
- Ship rotation from `stepShip` is normalized to [-π, π).

**N2 clarifications (server behaviour the client can rely on; implemented in `server/game/world.ts`):**
- **Frame order.** Per tick, each client gets its frames in this order: `ent`/`gone` → events
  (`fire`/`hit`/`sunk`/`goldCollected`) → `s`. An `ent` always arrives before the first row, `fire`,
  `hit` or `sunk` for that eid.
  - Your own ship never gets an `ent`, and it is never in `e`. Use `me.eid` to recognise your own
    `fire` events.
- **Sequence numbers.**
  - `a` is `-1` until the first input of this connection is processed.
  - Seq tracking resets on every `connected`/`reconnected`, so a reconnecting client may restart its
    seq at 0. Replay inputs with `seq > a`.
- **`me` is NOT rounded:** x, z, r and v are full precision, for exact reconciliation. Only `e` rows
  are rounded.
  - `me.canFire` and `me.reloadMs` are computed with the server's simulation clock.
- **Fire events.**
  - `fire.balls` rows are `[id, x, z, dx, dz]`, with x and z rounded to 1 decimal and dx, dz to 4.
  - A ball fired at tick `k` is still at its spawn point in that tick's state, and moves 45 units
    per tick after that. Compute `p(t) = p0 + dir * spd * 60 * (t - t_k)`.
  - Events go to clients that can see the shooter, plus the shooter itself.
- **Hit and sunk events.**
  - `hit` goes to the target (`target:"me"`), to clients that see the target, and to the shooter even
    when the target is out of its view (so it can remove the ball).
  - `sunk` goes to the ship itself (`eid:"me"`) and to clients that see it.
- **Visibility of sunk and disconnected ships.** Both stay visible, with flags 1 and 2. Velocity is
  0 once sunk. A disconnected ship coasts to exactly 0.
- **`connected.playerId` equals the `id` field of that player's `ent` on other clients.**
- **Snapshots under congestion.** The server skips `s` (never events, `ent` or `gone`) for a socket
  whose send buffer is above 512 KB.
- **Invalid frames** are dropped without an `error` reply. Legacy business errors (trade, upgrade,
  etc.) still reply with `{type:"error"}`.

**NPC1 clarifications (NPC ships; WORLD_SPEC §8, implemented in `server/game/world.ts` + `shared/protocol.ts`):**
- An NPC is an ordinary entity: same eid space, same `e` rows, `fire`/`hit`/`sunk` events. It is never
  flagged DISCONNECTED (flag 2).
- Its `ent` carries three optional extra fields: `npc: 1`, `faction` (e.g. `"spain"`, `"pirates"`,
  `"merchants_guild"`) and `title` (nameplate text, e.g. `"Spanish Navy"`). Player ships never carry
  them. Read them with `parseEntNpcMeta(ent)`, which returns null for players and drops malformed or
  over-long (> 64 chars) strings.
- NPC `id`s start with `npc:`. The server refuses that prefix as a `connect` tempPlayerId or a
  `reconnect` id, so a client can never take over an NPC.

**NPC2 clarifications (live NPCs, player standing):**
- NPCs are ON by default (`NPCS_ENABLED=0` disables). Expect ~150 NPC ships worldwide, at most 80 in
  the world at once, and only those within ~2500 of some player; clients see them like any ship.
- **`standing` (server → client, low rate):**
  `{ t: "standing", rep: { [faction]: number }, notoriety: number, bounty: number }`, the receiver's own
  standing with the NPC factions. `rep` is −100…100 per faction id (`england`, `spain`, `france`,
  `portugal`, `netherlands`, `pirates`, `merchants_guild`); a missing faction means the default for new
  players (pirates −60, guild +10, nations 0). `notoriety` is 0…100 and decays 2 per minute; `bounty` ≥ 0.
  - It is sent when the standing first exists (the NPC system creates it the first time it evaluates the
    player), on every (re)attach, and whenever it changes (rep events, a whole-number notoriety step).
    It is never part of `s`, so `me` is unchanged.
  - Read it with `parseStanding()` (shared/protocol.ts), which drops unknown factions and clamps values.
- The standing is persisted as a JSON `standing` field in the `player:<id>` Redis hash, restored on
  `reconnect`, and offline time is credited to notoriety decay.

## 7. Client netcode
- **Own ship = prediction + reconciliation.** Client runs `stepShip` at the same fixed 20 Hz step with an
  accumulator in `useFrame`, sends each step's input with a seq, keeps unacked inputs. On snapshot:
  reset to `me` state, replay inputs with seq > `a`. Render = interpolate between the previous and current
  predicted step (render alpha) plus a decaying visual error offset (no snapping unless error > 150 units).
- **Remote ships = interpolation buffer.** Buffer snapshots per eid with server tick time; render at
  `serverNow - 100 ms` (2 ticks), wrap-aware lerp of position and angle-lerp of rotation. If buffer
  underruns, extrapolate ≤ 200 ms using velocity then hold. Positions are written to Three.js objects in
  `useFrame`, not via React props on every snapshot (React state only for set membership / metadata).
- Clock: estimate `serverTimeOffset` from snapshots (`st`) with smoothing; RTT from ping/pong.
- Cannonballs rendered from `fire` events, simulated locally, removed on `hit` or lifetime.
- Reconnect: exponential backoff (0.5 s → 8 s), then `reconnect` with stored id; inputs are
  zeroed while hidden (visibilitychange) so the ship coasts to a stop rather than keeping old speed.
- Remove `import { gameState } from "server/game/gameState"` from the client.

**N3 clarifications (client behaviour; implemented in `client/src/lib/net/`):**
- **Seq.** The client restarts its seq at 1 and drops all unacked inputs whenever the socket closes
  and on every `connected`/`reconnected`. It sends no inputs until the first snapshot of the session.
  `a = -1` replays every pending input.
- **Hidden tab.** One `{th:0,ru:0,f:0}` input is sent, then nothing until the tab is visible again.
- **Cannonball timelines.** A ball's spawn time is the estimated server time when its `fire` arrives
  (≈ that tick's `st`). Own balls are drawn on the undelayed timeline. Other ships' balls are drawn
  `INTERP_DELAY_MS` behind, like the remote ships. On `hit`, own balls vanish at once. Other balls keep
  flying until their delayed timeline reaches the hit moment.
- **Entities are never pruned locally.** Only `gone` removes one, because snapshots may be skipped
  under backpressure and `ent` is only re-sent when the entity re-enters view.
- **Self in events.** A `hit`/`sunk` whose id equals `me.eid` is treated as `"me"`. As a guard, an
  `ent`/row with the own eid is ignored.

**World clarifications (2026-10-16, card W1; contract in `docs/world/WORLD_SPEC.md`):**
- The 10000² torus is retired. x wraps at `WORLD_C` = 400 000; z ∈ [0, 200 000] does not wrap (polar
  ice is land). Positions and the wire format are unchanged (0.1 rounding).
- Motion and every distance in this document (interest radius, gold interest, hit radius, pickup) are
  METRIC: x deltas are scaled by `metricX = cos(lat)` (`shared/world/geo.ts`). Ball `dx/dz` in `fire`
  rows are a unit METRIC direction; `ballPositionAt` integrates x by 1/metricX exactly.
- `stepShip(state, input, stats, land?)` takes the land field; the client must pass the same land data
  for prediction to match (missing tiles = water; reconciliation fixes the difference).
- **New server → client event `splash`:** `{t:"splash", x, z, land: 1, ball}`. A cannonball hit land
  (or the ice) at (x, z) and was removed. Sent to clients within `INTEREST_RADIUS` (metric) of (x, z),
  after the view diff and before the snapshot, like other events. `ball` is the id from the `fire`
  row (an addition to the spec's `{x, z, land:1}`), so clients remove the ball exactly as on `hit`.

## 8. Wave 2 (deferred): Colyseus
Wave 1 fixes the transport-independent causes (split worlds, physics mismatch, snapping, tick stalls,
no interpolation). Colyseus would add binary delta encoding, `StateView` interest and managed reconnection,
but means rewriting every message handler. Decide after Wave 1 bot metrics (bytes/s per client, tick ms
at 200 bots). Shared physics + client prediction/interpolation carry over unchanged.
