# Netcode architecture overview

Read this first, then `PROTOCOL.md` (the wire/simulation contract), `LOAD_TEST.md` (bots) and
`BUILD_STATE.md` (history of the overhaul and measured numbers).

## Shape

```
 browser (React + Three.js)                       server (one Node process)
 +---------------------------+                   +------------------------------------------+
 | client/src/lib/net/*      |   JSON frames     | routes/routes.tsx  (ws server, 15s ping)  |
 |  NetClient (singleton)    | <---------------> | game/socketHandler.tsx                    |
 |  Predictor (own ship)     |   /game-ws        |   parseClientMessage -> handlers          |
 |  RemoteWorld (interp.)    |  input 20 Hz ->   | game/gameState.tsx  (wiring)              |
 |  BallSim, ServerClock     |  <- ent/gone/     |   FixedStepLoop (game/loop.ts, 20 Hz)     |
 | useSocket (zustand) -> UI |     events/s      |     World.step()  (game/world.ts, pure)   |
 +---------------------------+                   |     buildFrames(client) -> sockets        |
        both import                              |     drain world.effects (async, queued)   |
   shared/physics.ts, shared/protocol.ts         |          -> Redis, leaderboard, Segment   |
                                                 +------------------------------------------+
```

## Where things live
| Piece | File |
|---|---|
| Deterministic ship/cannonball physics, wrap helpers | `shared/physics.ts` |
| Message types, validation, snapshot row packing, constants | `shared/protocol.ts` |
| Authoritative world (players, input queues, balls, gold, grid, per-client views) | `server/game/world.ts` |
| Drift-free fixed-step loop | `server/game/loop.ts` |
| Loop + sockets + effects wiring | `server/game/gameState.tsx` |
| Message handlers (connect, input, trade, ...) | `server/game/socketHandler.tsx` |
| Heartbeat, graceful shutdown | `server/routes/routes.tsx` |
| Prediction/reconciliation, interpolation, clock, cannonballs, reconnect | `client/src/lib/net/*` |
| Bot load test | `scripts/bots.ts`, `scripts/run-bot-test.ts` |

The world core (`world.ts`) is I/O free and `step()` is synchronous: never add an `await` inside a tick.
Redis, leaderboard and Segment work is emitted as `world.effects` and drained fire-and-forget outside the tick.

## Changing physics safely
`shared/physics.ts` runs on BOTH sides: the server simulates every ship with it and the client re-runs it for
prediction. Any change alters both at once, so:
1. Keep `stepShip` pure and deterministic (same inputs give the same output); no `Date.now()`, no randomness.
2. Update `shared/__tests__` and the world tests, then run `npm test` and `npm run test:bots`.
3. A browser holding a stale client bundle against a new server will rubber-band. Avoid casual physics changes.
4. Units: speeds are "units per 1/60 s"; negative velocity is forward (see PROTOCOL.md section 2).

## Adding a new message type
1. Add the type to `shared/protocol.ts` (`ClientMessage` or `ServerMessage`). For client messages also add the
   case to `parseClientMessage` (clamp/validate every field; invalid frames are dropped silently).
2. Add a handler in `server/game/socketHandler.tsx` (client to server), or emit it from `World` (`events`, then
   `buildFrames` does per-client interest filtering), or from the wiring layer (server to client).
3. Handle it on the client in `client/src/lib/net/netClient.ts` (add to `NetEvents`) and wire it into
   `useSocket` / the UI.
4. Add unit tests (protocol parse, world behaviour); if it is high volume, check bytes/s with `test:bots`.
5. Document it in `PROTOCOL.md`.

## Interest management
Each tick the world rebuilds a wrap-aware spatial hash (cell 500). A client sees ships within
`INTEREST_RADIUS` 2000 and gold within 1000. The server tracks a known-set per client and sends `ent` (metadata,
once, on entry or change) and `gone` (on exit); snapshot rows `e` are compact number arrays. Gold rows are sent
every 10th tick. Other players' gold, cargo and inventory are never sent. Events go only to clients that can see
the actors (plus the shooter/target so they can clean up).

## Known limits and next steps
- **Single process by design.** The world is in memory and EB is pinned to 1 instance. If more than one process
  is ever needed, shard the world (e.g. by region/room with sticky routing). Do not just raise MaxSize.
- **Capacity.** 30 bots: 20 snaps/s, ~7.7 KB/s per client, tick ~1 ms. 200 bots (on the same desktop as the
  server): 19.3 snaps/s, ~21 KB/s per client, tick avg 16 ms of a 50 ms budget. Most cost is per-client JSON
  serialization. Production is a **t3.micro** (burstable, ~10% CPU baseline), which is the more urgent limit:
  watch CPU credits and the tick time (logged every 60 s) before worrying about JSON.
- **Wave 2 (deferred): Colyseus and/or binary encoding.** It would add binary deltas, managed interest and
  reconnection, but means rewriting every handler. The numbers above say it only matters past ~200 concurrent
  players; decide from real production metrics. Shared physics and client prediction/interpolation carry over.
- Unverified on Windows (verify on EB): SIGTERM graceful shutdown and the heartbeat terminate path.
- No protocol versioning yet.
