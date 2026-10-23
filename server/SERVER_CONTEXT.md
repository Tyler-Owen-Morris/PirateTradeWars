# Server Architecture - Pirate Trade Wars

## Overview
The server is a Node.js application using Express for HTTP endpoints and WebSockets for real-time game communication. It manages game state, player interactions, trading mechanics, and data persistence.

## Netcode (server)

The contract is `docs/netcode/PROTOCOL.md`; the wire shapes are in `shared/protocol.ts` and the
physics in `shared/physics.ts`. Both are shared with the client.

- **World core, `game/world.ts`.** A pure, Redis-free `World` class with no I/O. It is unit tested in
  `game/__tests__/world.test.ts`.
  - Players are keyed by id. Each has a small integer `eid` that is never reused, plus a per-player
    input queue.
  - It also holds the cannonballs and gold objects, and a SPARSE spatial hash grid (`SpatialGrid`, a
    `Map` of non-empty `GRID_CELL` = 500 coordinate-unit cells, 800 × 400 over the Earth) that is
    rebuilt every tick. `query(x, z, r)` takes a METRIC radius and widens the x span by 1/metricX at
    the query edge nearest the pole; x wraps, z is clamped.
  - **Wrapping Earth (docs/world/WORLD_SPEC.md, card W1).** x wraps at `WORLD_C` = 400 000, z is
    0 (north pole) … `WORLD_H` = 200 000 and does not wrap (polar ice at |lat| > 70). Every gameplay
    distance (interest, hits, gold pickup, splash interest, port radius) is metric
    (`metricDistSq` in `shared/world/geo.ts`).
  - The world holds a `LandQuery` (`new World({ land })`; default `ALWAYS_WATER_TEST_FIELD` = ocean +
    polar ice) and passes it to `stepShip`: no-damage coast collision (push-out + slide).
  - `spawnPoint(center?, jitter?, minWater?)` returns a water point with land distance > `minWater`
    (default `SPAWN_MIN_WATER` 60); if no jittered candidate qualifies it returns the deepest one seen
    (counting the centre). Default centre is the Caribbean (lat 18, lon −75), jitter ±5000 metric.
  - `starterSpawn(port?)` (card W4): a random starter port (Port Royal, Nassau, Tortuga, Havana,
    Bridgetown; `STARTER_PORTS`), a point within ±`PORT_SPAWN_JITTER` (150) of its `spawn` with land
    distance > `PORT_SPAWN_MIN_WATER` (150), and `rotationY` facing out to sea (`seawardRotation`: the
    land normal, or away from the town where the field is flat). `createPlayer` uses it when no x/z
    is given. There is no respawn: a sunk player starts over as a new player.
  - `restorePlayer` relocates records that `needsRelocation` (no `worldVersion === WORLD_VERSION`, i.e.
    the old 10000² torus, or a position on land) to `starterSpawn()`, keeping gold, ship type and
    stats, hp and cargo (the inventory is a separate Redis key and is untouched). `worldVersion` is
    persisted in the Redis player hash.
  - `step()` advances exactly one 50 ms tick. It is synchronous and has no `await`.
  - Time inside the world is simulation time: `timeMs = tick * 50`. Reload, ball lifetime, gold
    lifetime and the grace period all use it.
- **Tick order (`World.step`):**
  1. Removals: disconnected players past `GRACE_PERIOD` (60 s), and dead players. NPCs are skipped
     here, because the NPC system owns their lifecycle.
  1b. The NPC AI hook (`npcHook`), when one is set. See "NPC ships" below.
  2. Movement. A sunk ship stays put.
     - A connected ship consumes one queued input, or two if more than 3 are queued (catch-up).
       Then it runs `stepShip`. If the queue is empty the ship HOLDS (no step, `a` unchanged), so the
       server state is always `stepShip` over inputs 1..a, exactly what the client predicts. Do not
       reintroduce "repeat the last input" here: it was the 2026-10-23 own-ship jump bug
       (docs/netcode/BUILD_STATE.md). `world.inputStats` (held / overflow / catchUp) is in the
       `[tick]` log line, with the max tick ms.
       The fire flags of the consumed input(s) are OR-ed (broadsides: `FIRE_ALL`/`FIRE_PORT`/`FIRE_STARBOARD`).
     - A disconnected ship gets neutral input, so it coasts to 0.
  3. Rebuild the grid.
  4. Cannonballs: `stepBall` (metric straight line), a metric `segmentHitsCircle` hit test against
     ships near the ball, and armor `round(dmg * (1 - armor/100))`. A ship that reaches 0 hp is sunk,
     drops its gold, and emits a `playerSunk` effect. A ball whose half-tick or full-tick position is
     on land (`ballHitsLand`, incl. ice) is removed and emits a `splash` event `{ball, x, z}`.
  5. Spawn new broadsides with `spawnBroadside(p, n, side)`. Broadsides (2026-10-23): each ship has a
     port and a starboard battery, each gated by `reloadTime` on its own (`lastFiredPort` /
     `lastFiredStarboard`, `sideReady`, `reloadLeftMs`); `fireSides` picks which fire, and each side
     volley is its own `fire` event with `side`. A ball fired
     at tick k is still at its spawn point at tick k.
  6. Gold: it expires after 60 s. Any ship within 50 units picks it up.
  7. Derived flags: `firing` (for 6 ticks after a broadside) and `canFire` (either side loaded).
     The snapshot `me` carries `reloadPortMs` / `reloadStarboardMs` (+ legacy `reloadMs` = min).
- **Events and effects.**
  - `world.events` holds this tick's `fire`/`hit`/`sunk`/`splash`/`goldCollected`. `splash` goes to
    clients within `INTEREST_RADIUS` (metric) of the splash point as `{t:"splash",x,z,land:1,ball}`.
  - `world.effects` holds Redis, leaderboard and Segment work: `playerSunk`, `goldCollected`, and
    `playerRemoved` (persist or release the name). The wiring layer drains it.
- **Per-client view.** `attachClient(id)` gives a client a known-entity map (eid → metaVersion).
  `buildFrames(id)` (or `buildMessages` for tests) returns the frames in send order:
  1. `ent` for every ship that entered the client's `INTEREST_RADIUS` (2000) or whose metadata
     changed (upgrade), and `gone` for every ship that left.
  2. The events the client can see.
  3. The snapshot `s`, with `me` (full private self state, unrounded, includes `eid`), `a`
     (lastSeq, or -1 before the first input on this connection), the `e` rows, and every 10th tick
     `g` gold rows within 1000.

  Other players' gold, cargo and inventory are never sent. Each ship's row JSON is cached once per
  tick, and the snapshot frame is assembled from those cached strings.
- **Land tiles, `game/landLoader.ts`.** `loadLandSync()` runs when `gameState.tsx` builds the World,
  i.e. at boot before the loop starts. It reads `manifest.json` + every tile from
  `dist/public/world/land` (production) or `client/public/world/land` (dev); `LAND_DIR` overrides.
  Supports the manifest's `encoding: "gzip"` (`t_<tx>_<ty>.bin.gz`, `zlib.gunzipSync`) and raw `.bin`.
  `allWater`/`allLand` tiles are not read. No manifest or mismatched raster → all-water fallback with
  a warning (the game still runs, without continents); an unreadable tile → water with a warning.
  Boot log: `[land] loaded <version> from <dir>: N data tiles, …`.
- **Loop, `game/loop.ts`.** `FixedStepLoop` is drift-free: a `performance.now()` accumulator plus a
  self-rescheduling `setTimeout`, with at most 5 catch-up steps per wake; any further backlog is
  dropped.
- **Wiring, `game/gameState.tsx`.** It owns the single `World` and the loop, and maps playerId → socket.
  - `runTick` = `world.step()` → send each socket its `buildFrames()` (it skips only the snapshot
    when `bufferedAmount` > 512 KB) → run the drained effects through `background()`. That is
    fire-and-forget with `.catch(log)` and never awaited in the tick.
  - Every 60 s it logs the average tick time.
  - Measured with 300 ships: about 4 ms per tick spread over the map, and about 8 ms with everyone
    packed into one area.
- **Socket handling, `game/socketHandler.tsx`.**
  - Every frame goes through `parseClientMessage`. Invalid frames are dropped silently.
  - `input` → `world.queueInput` (out-of-order seqs are ignored; the queue is capped at 10, dropping
    the oldest).
  - `ping` → `{t:"pong", c, st}`.
  - `chat` → `handleChat` (synchronous, message path, never the tick): only the attached socket of a
    live player ship (`gameState.isRegisteredSocket`, not sunk/dead) may chat. `gameState.chat`
    (`game/chat.ts` `ChatService`) checks the mute, applies a per-player token bucket (burst 5, 1/s;
    throttled → one private `sys` notice per 3 s), `collapseRepeats`, then kid-safe moderation
    (`game/chatFilter.ts` `moderateText`, built on the `obscenity` npm package plus our own lists):
    mild profanity is masked with asterisks; slurs/hate, sexual content, threats/self-harm and
    child-safety hits (links, emails, phone numbers, age/location/off-site-contact requests) drop the
    whole line and send the sender alone "Mind your tongue, sailor — that message was not sent."
    3 drops in 10 min → 10-min mute, doubling per repeat mute up to 1 h (doubling resets after 24 h
    quiet). Strikes/mutes are in memory, keyed by player id (survive reconnects, not restarts). Drops
    are logged as `[chat] dropped player=<id> category=<cat> hash=<sha256[:12]>` (never the text), mutes
    as `[chat] muted player=<id> minutes=<n> level=<k>`. It stamps the server-side name and keeps a
    30-line in-memory ring buffer. Accepted lines go out with `gameState.broadcast(json)` to every
    attached socket. After `connected`/`reconnected` the socket gets `{t:"chatHistory", lines}`. Nothing
    is in Redis; a restart clears chat. New ship names at `connect` go through `isNameAllowed` (same
    filter; anything not clean → `nameError` "That ship name isn't allowed..."); existing names are not
    re-checked on reconnect. Tests: `game/__tests__/chatFilter.test.ts` (filter, false-positive list,
    names), `chat.test.ts` (policy, escalation), `chatSocket.test.ts` (handler).
    To tune the filter: add words to `EXTRA_PATTERNS`, innocent words to `SAFE_TERMS`, phrases to
    `PHRASE_RULES` / `PII_RULES`, and a test case for each.
  - connect, reconnect, trade, sellAll, upgradeShip, repairShip and scuttle (trading: see "Trade Processing") are async
    with Redis, outside the tick), but on the world's live player objects.
  - `connected`/`reconnected` no longer carry the `players`/`cannonBalls`/`goldObjects` dumps. The
    socket is attached after that message, so the next tick's snapshot delivers the world.
  - A socket that closes only detaches its player if it is still that player's registered socket.
- **Heartbeat and shutdown, `routes/routes.tsx`.**
  - The server sends a ws ping every 15 s and terminates any socket that misses 2 pongs.
  - On SIGTERM/SIGINT it stops the loop, persists all players (`updatePlayerState`), flushes Segment
    (`closeAndFlush`), closes sockets with code 1012, and exits. A hard 10 s timeout covers a hang.
- **Without env keys:** `segmentClient` is a no-op when `SEGMENT_WRITE_KEY` is unset. Note that
  `stripeRoutes` still throws without `STRIPE_SECRET_KEY`, so a local run needs a dummy
  `sk_test_...` value.
- **Run locally:**
  `STRIPE_SECRET_KEY=sk_test_dummy REDIS_CONN_STRING=redis://localhost:6379 PORT=5055 npx tsx server/index.ts`
  - Use the local Docker Redis (`ptw-redis`), never the `.env` Upstash.
  - `reusePort` is skipped on Windows.

## NPC ships (`game/npc/`, cards NPC1 + NPC2)

Full details are in `game/npc/README.md`; the contract is WORLD_SPEC §8.

- **On by default (NPC2).** `gameState` builds `createLiveNpcSystem(world)` unless `NPCS_ENABLED=0|false|off|no`:
  the real lanes (`shared/world/lanes.json`), port safe zones, the live fleets (`npc/population.ts`, ~150
  persistent NPCs, ≤ 80 active) and the World's `LandField`.
- **An NPC is a `WorldPlayer` with `controller: "npc"`** (id `npc:<n>`, the same eid space).
  - It is never disconnected, never times out, never takes queued inputs, and is never persisted
    (`persistAll` skips it).
  - Connect and reconnect refuse `npc:*` ids.
- **Tick order addition: step 1b.** `world.npcHook(world, prevEvents)` runs after removals and before
  movement. The NPC system writes each NPC's `{th, ru, f}` with `world.setNpcInput`. It is
  synchronous and seeded, with no I/O.
- **Effects.**
  - `npcSunk` replaces `playerSunk` for NPCs, so the leaderboard never sees an NPC.
  - `playerSunk.byNpc` marks a player sunk by an NPC; it is excluded from player-kill stats.
  - `npcRepChange`: the NPC system has already applied it to the player's in-memory standing;
    `runEffect` marks the player dirty and `flushStandings` writes the standing once per player per tick
    (`redisStorage.updatePlayerStanding`, fire-and-forget).
  - An NPC that collects gold emits no `goldCollected` effect.
- **Player standing (NPC2).** `PlayerState.standing` = `{rep, notoriety, bounty}`, created on first use by
  `NpcSystem.standingOf`, saved as a JSON `standing` field of `player:<id>` (every `updatePlayerState` and
  each rep change), restored by `World.restorePlayer` (validated with `parseStanding`). Notoriety decays 2/min
  online (every 10 s) and for the offline time on `reconnect` (`decayNotoriety` in socketHandler). The
  client gets its own standing as a low-rate `standing` message (PROTOCOL.md "NPC2 clarifications").
- **`ent`** gains `npc: 1`, `faction` and `title` for NPCs.
- **Combat (F1, after Q1 B2/B3).** NPC fire control checks each shot one tick ahead with the real
  `stepShip` and a hit-circle tolerance (`NpcSystem.aim`, `tactics.fireTolerance`); hurt NPCs break off
  at hp ≤ (1 − courage) × 0.7 on a committed escape course; an NPC a player hit may fight back past the
  attacker-slot cap (self-defence, 60 s); ally friendly fire is ignored; a hit cancels dock idling. See
  `game/npc/README.md` "Combat fixes after Q1".
- **Broadsides (2026-10-23).** NPCs have both batteries. They fight with the side facing the target
  (`tactics.chooseSide`, `SIDE_SWITCH_MARGIN` 25° hysteresis, kept in `ActiveNpc.gunSide`), use that
  side's reload, and fire only it (`FIRE_PORT`/`FIRE_STARBOARD`). Sustained damage is about unchanged;
  the first hit comes sooner (see `docs/proposals/2026-10-23-broadsides-NOTES.md`).
- **Tiers.** Only *active* NPCs (a player within 2500) are World ships. Rail and docked NPCs are
  director records, so they cost nothing per tick.
- **Navigation on real coasts (NPC2):** lane following with a line-of-sight check, coast feelers with
  tangent hysteresis, an A* path back to the lane when it is behind land (`npc/nav.ts`, ≤ 2 plans per tick),
  coast following as a fallback, and an unstick manoeuvre. 100 NPCs × 3 simulated minutes on the real
  map: longest pin against a coast 3 s.
- **Measured (vitest, desktop):** 200 players + 300 NPCs (80 active) on the real map ≈ 2.4–2.6 ms per tick
  for step + frames; the NPC system ≈ 0.6 ms average. Real server with 200 WebSocket bots + 300 NPCs:
  9.2 ms average tick (5.9 ms with NPCs off), all bot assertions pass.
- **Socket cork (NPC2):** `runTick` corks each client's TCP socket around that tick's frames, so a client
  gets one write per tick however many `fire`/`hit` events it sees. Without it, NPC fights near crowded
  ports spent ~30 % of server CPU in per-message `writev`.

## Ports (card W4)

- **Data:** `shared/world/ports.ts` wraps the generated `shared/world/ports.json` (27 real ports, card W2):
  `GamePort = { id (1-based index, numeric on the wire), key ("port_royal"), name, nation, region, lat, lon,
  x/z (the town, on land), y: 0, dock {x,z} (water), spawn {x,z} (deep water), safeRadius }`.
  `PORTS_VERSION` = the ports hash in `shared/world/versions.json`.
- **Seeding, `game/ports.ts`:** `initializeGameState` calls `seedPorts(redisStorage)`: when the Redis key
  `portsVersion` differs from `PORTS_VERSION` (or is missing), `redisStorage.replacePorts` rewrites the
  `ports` hash (id -> JSON GamePort), deletes `port:<id>:goods` for every old and new id, and stores the new
  version, in one MULTI. Then `seedGoods` writes every GOODS id missing from the `goods` hash (by id, via
  `redisStorage.putGood`; it used to seed only an empty hash, so new goods never reached a live server), and
  `ensurePortGoods` gives every port a row for every good (whole markets for new ports, the missing rows for new
  goods) and restocks low goods the port sells. GOODS ids are append-only, so player inventories stay valid.
- **Markets (New Horizons phase 1, 2026-10-23):** prices, stock and `notSold` come from the market model
  `shared/world/goodMarkets.ts` (`GOOD_MARKETS`: per good, its sources and where it is wanted; price rises with
  sea-lane distance from the nearest source, 0.6x to 2.0x, x1.3 where wanted; exotic goods are `notSold` away from
  their sources, stock 0, but every port still buys them). The 5-minute `updatePrices` runs `ensurePortGoods` +
  `updatePortMarkets`, which also re-syncs each row's `notSold` with the model (`redisStorage.updatePortGoodNotSold`).
  `npm run market:sim` prints the best routes. To check a re-seed against an old world:
  `REDIS_CONN_STRING=redis://localhost:6379/7 npx tsx scripts/market/seed-old-world.ts <old ports.json> <old version>`,
  then boot the server on that DB (docs/world/expansion-phase1/NOTES.md).
- **Interaction gate:** trade, upgradeShip and repairShip (`socketHandler.withinPort`) need the metric distance
  from the ship to the port's **dock** <= `PORT_INTERACTION_RADIUS` (300); otherwise `error "Too far from port"`.
  Trade had no distance check before W4.
- **Safe zone:** `safeRadius` (600, around the dock) is stored and served but has no gameplay effect; before W4
  it was only (mis)used as the interaction radius, and there was never a no-damage zone. Kept as data for later.
- **API:** `GET /api/ports` returns the GamePort list sorted by id (the client also bundles `PORTS` as a fallback).
- Tests: `game/__tests__/ports.test.ts` (seeding with a fake store, goods seeding by id, missing goods rows, notSold
  sync, spawns on the real land, migration), `game/__tests__/goodsCompat.test.ts` (protocol + inventory back-compat
  with goods 9-13),
  `game/__tests__/portActions.test.ts` (dock gate through the real socket handler, Redis mocked),
  `shared/world/__tests__/ports.test.ts`.

## Directory Structure

- `/game/` - Game logic
  - `gameState.ts` - Core game state management
  - `shipTypes.ts` - Ship configurations
  - `socketHandler.ts` - WebSocket message handling
- `index.ts` - Server entry point
- `routes.ts` - HTTP API routes
- `storage.ts` - Data storage interface
- `vite.ts` - Development server configuration

## Game State Management

The game state is managed by the `GameState` class in `gameState.ts`:

1. **Core State**:
   - Players (position, rotation, health, etc.)
   - Cannonballs (position, direction, damage)
   - Ports (static locations)
   - Game time and update timestamps

2. **Update Loop** (see "Netcode (server)" above):
   - `World.step()` - one fixed 50 ms tick (20 Hz), driven by `FixedStepLoop`
   - per-client frames (`ent`/`gone`, events, snapshot `s`) sent right after each step
   - `updatePrices()` - Updates port prices and stock (5-minute intervals, `game/ports.ts`)

3. **Player Management**:
   - Registration and removal
   - Movement and rotation
   - Health and damage
   - Sinking mechanics

## WebSocket Communication

Socket handling in `socketHandler.ts`:

1. **Message Types**:
   - `connect` / `reconnect` - Player registration
   - `input` - `{t:"input", s, th, ru, f}` throttle/rudder/fire intents (never positions)
   - `ping` - RTT probe
   - `chat` - `{t:"chat", text}` global chat (see "Socket handling" above)
   - `trade`, `upgradeShip`, `repairShip`, `scuttle` - port and ship actions
   (authoritative list: `shared/protocol.ts`, `parseClientMessage`)

2. **Socket Management**:
   - Each connected client gets a unique ID
   - Messages parsed and validated
   - Replies sent directly; world state goes out per client as interest-filtered snapshots after each tick. The only global broadcast is chat (`gameState.broadcast`)

## Data Storage

The game uses a flexible storage system defined in `storage.ts`:

1. **Storage Interface**:
   - `IStorage` defines all data operations
   - Production implementation is `redisStorage.tsx` (Redis via `REDIS_CONN_STRING`); `MemStorage` is legacy
   - A PostgreSQL/Drizzle schema is defined but unused

2. **Entity Types**:
   - Users (authentication)
   - Players (game state)
   - Ship Types (ship configurations)
   - Ports (trading locations)
   - Goods (tradable items)
   - Port Goods (stock and prices)
   - Player Inventory (owned goods)
   - Leaderboard (high scores)

## HTTP API Routes

Express routes in `routes.ts`:

1. **Player Routes**:
   - `/api/players` - Player management
   - `/api/players/:id/inventory` - Inventory access

2. **Game Data Routes**:
   - `/api/ship-types` - Available ships
   - `/api/ports` - Port information
   - `/api/ports/:id/goods` - Port goods and prices

3. **Admin Routes**:
   - Update port prices and stock
   - Modify game parameters

## Trading System

The trading system spans multiple components:

1. **Port Management** (see "Ports (card W4)"):
   - 27 real ports from shared/world/ports.json; interaction within 300 of the dock
   - Dynamic goods with regional prices and fluctuation
   - Stock management (supply/demand)

2. **Trade Processing** (2026-10-23; contract: docs/netcode/PROTOCOL.md "Trading clarifications"):
   - `game/trade.ts`: pure `applyTrade` / `applySellAll` (validation, spread via `shared/market.ts`
     `sellPriceOf`, stock taken on buy / returned on sell, `avgPaid` per inventory row, `expectedPrice`
     guard) and `KeyedQueue`. `playerQueue` serializes every port action of a player (trade, sellAll,
     upgrade, repair); `portQueue` serializes each port's goods writes (redisStorage's
     `updatePortGoodPrice/Stock` and `createPortGood` run through it too). Tests: `__tests__/trade.test.ts`
     (rules), `__tests__/tradeSocket.test.ts` (the race, ref/legacy replies, sellAll, with a slow fake Redis).
   - `socketHandler.tsx` `doTrade` / `doSellAll`: load port goods + inventory, re-check the dock radius,
     decide and apply to the live player (gold, cargoUsed) in one synchronous block, then persist with
     `redisStorage.saveTrade` (inventory + cargoUsed + gold in one MULTI) and `setPortGoods`.
     Requests with `ref` get `tradeResult`; legacy requests get `tradeSuccess` / `error` as before.
   - `GET /api/ports/:id/goods` adds `buyPrice` / `sellPrice` / `wanted` (`portGoodView`).
     `PUT /api/players/:id/inventory` was removed (unauthenticated cargo writes).
   - The bot test runs a trade round trip (`scripts/tradeCheck.ts`).

3. **Price Fluctuation**:
   - Automated price changes
   - Supply-demand mechanics
   - Price bounds to prevent extremes

## Game Physics

Simple physics system for ships and projectiles:

1. **Ship Movement** (`shared/physics.ts` `stepShip`, see "Netcode (server)"):
   - Linear velocity with speed caps; velocity is a metric ground speed
   - Rotation with turning radius
   - x wraps around the globe; z is closed by the polar ice
   - No-damage land collision: push-out along the land normal + slide (`hullRadius` per ship type)

2. **Collision Detection**:
   - Cannonball-to-ship collisions (metric)
   - Cannonball-to-land: removed with a `splash` event
   - Damage application
   - Ship sinking mechanics

## Database Integration

Persistence is Redis (`redisStorage.tsx`). The Drizzle/PostgreSQL schema in `shared/schema.tsx` is not used at runtime.
Live world state is in-process memory, so the server must run as a single instance (see PROJECT_CONTEXT.md "Deployment").

## Known Limitations and Considerations

1. Single process: no horizontal scaling without sharding the world
2. Capacity: ~200 bots tested on a desktop; the t3.micro (burstable CPU) is the practical limit, see docs/netcode/README.md
3. Socket disconnection handling
4. Database scaling for production

## Developer Tips

1. **Adding New Ship Types**:
   - Update `shipTypes.ts`
   - Add client-side model and assets

2. **Modifying Trading**:
   - Adjust price fluctuation in `gameState.ts`
   - Update goods in `shipTypes.ts`

3. **Tuning Game Balance**:
   - Ship stats in `shipTypes.ts`
   - Combat parameters in `gameState.ts`