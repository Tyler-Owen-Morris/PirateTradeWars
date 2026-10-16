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
  - It also holds the cannonballs and gold objects, and a wrap-aware spatial hash grid (`GRID_CELL`
    = 500) that is rebuilt every tick.
  - `step()` advances exactly one 50 ms tick. It is synchronous and has no `await`.
  - Time inside the world is simulation time: `timeMs = tick * 50`. Reload, ball lifetime, gold
    lifetime and the grace period all use it.
- **Tick order (`World.step`):**
  1. Removals: disconnected players past `GRACE_PERIOD` (60 s), and dead players.
  2. Movement. A sunk ship stays put.
     - A connected ship consumes one queued input, or two if more than 3 are queued (catch-up).
       If the queue is empty, it reuses the last input with `f:0`. Then it runs `stepShip`.
     - A disconnected ship gets neutral input, so it coasts to 0.
  3. Rebuild the grid.
  4. Cannonballs: `stepBall`, a `segmentHitsCircle` hit test against ships near the ball, and armor
     `round(dmg * (1 - armor/100))`. A ship that reaches 0 hp is sunk, drops its gold, and emits a
     `playerSunk` effect.
  5. Spawn new broadsides with `spawnBroadside`, gated by `reloadTime` from SHIP_STATS. A ball fired
     at tick k is still at its spawn point at tick k.
  6. Gold: it expires after 60 s. Any ship within 50 units picks it up.
  7. Derived flags: `firing` (for 6 ticks after a broadside) and `canFire`.
- **Events and effects.**
  - `world.events` holds this tick's `fire`/`hit`/`sunk`/`goldCollected`.
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
  - connect, reconnect, trade, upgradeShip, repairShip and scuttle work as before (they are async
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
   - `updatePrices()` - Updates port prices (5-minute intervals)

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
   - `trade`, `upgradeShip`, `repairShip`, `scuttle` - port and ship actions
   (authoritative list: `shared/protocol.ts`, `parseClientMessage`)

2. **Socket Management**:
   - Each connected client gets a unique ID
   - Messages parsed and validated
   - Replies sent directly; world state goes out per client as interest-filtered snapshots after each tick (there is no global broadcast)

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

1. **Port Management**:
   - Fixed locations with safe zones
   - Dynamic goods with fluctuating prices
   - Stock management (supply/demand)

2. **Trade Processing**:
   - Buy/sell validation
   - Inventory updates
   - Gold transfers
   - Stock adjustments

3. **Price Fluctuation**:
   - Automated price changes
   - Supply-demand mechanics
   - Price bounds to prevent extremes

## Game Physics

Simple physics system for ships and projectiles:

1. **Ship Movement**:
   - Linear velocity with speed caps
   - Rotation with turning radius
   - Map wrapping at boundaries

2. **Collision Detection**:
   - Cannonball-to-ship collisions
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