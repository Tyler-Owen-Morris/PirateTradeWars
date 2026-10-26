# Pirate Trade Wars - Project Overview

## Introduction
Pirate Trade Wars is a browser-based multiplayer 3D pirate ship game where players explore a procedurally generated maritime world, engage in naval combat, trade goods between ports, and compete for positions on the leaderboard. The game ends when a player's ship is sunk, with their final gold amount determining their leaderboard position.

## Core Technologies
- **Frontend**: React, Three.js (@react-three/fiber), TypeScript
- **Backend**: Node.js, Express
- **Real-time Communication**: WebSocket (`/game-ws`) to an authoritative 20 Hz server, with client-side prediction and interpolation (see `docs/netcode/README.md`)
- **State Management**: Zustand
- **Data Storage**: Redis (`REDIS_CONN_STRING`) for players, names and the leaderboard. Live world state (ships, cannonballs, gold) is held in the memory of ONE server process. Drizzle/PostgreSQL schema files exist but are not used at runtime.

## Project Structure

The project is divided into three main sections:

1. **Client** (`/client/`) - The frontend application
   - For detailed information, see [CLIENT_CONTEXT.md](./client/CLIENT_CONTEXT.md)

2. **Server** (`/server/`) - The backend application
   - For detailed information, see [SERVER_CONTEXT.md](./server/SERVER_CONTEXT.md)

3. **Shared** (`/shared/`) - Code and types shared between client and server
   - For detailed information, see [SHARED_CONTEXT.md](./shared/SHARED_CONTEXT.md)

## Key Features

1. **Ship Navigation & Combat**
   - Real-time ship movement and rotation
   - Cannon firing mechanics
   - Ship-to-ship damage and sinking

2. **Trading System**
   - Multiple ports with dynamic good pricing
   - Buy/sell mechanics with inventory management
   - Price fluctuations over time

3. **Infinite Map**
   - Procedurally generated world with wrapping borders
   - Strategic port placement

4. **Multiplayer Functionality**
   - Authoritative 20 Hz server; clients predict their own ship and interpolate others
   - Leaderboard for competitive play

## Running the Project

1. Start the development server:
   ```
   npm run dev
   ```

2. The server will start on port 5000 and the client will be accessible via the browser

## Data Flow

1. **Authentication/Registration**:
   - Client sends `connect` (name, ship) or `reconnect` over `/game-ws`
   - Server validates, creates/restores the player (Redis) and replies `connected`/`reconnected`

2. **Input -> snapshot loop (20 Hz)**:
   - Client never sends position. Each 50 ms step it sends `{t:"input", s:seq, th, ru, f}`
   - Server queues inputs per player, and each tick runs the shared physics (`shared/physics.ts`) once per player
   - After the tick, each client gets `ent`/`gone` (entities entering/leaving its 2000-unit interest radius),
     events (`fire`/`hit`/`sunk`/`goldCollected`) and a snapshot `s` with its private `me` state, the last
     processed input seq `a`, and compact rows for nearby ships
   - Client re-simulates unacked inputs from `me` (reconciliation) and interpolates other ships ~100 ms behind

3. **Trading and upgrades**:
   - `trade`, `upgradeShip`, `repairShip`, `scuttle` are request/response messages handled outside the tick (async, Redis)

4. **Persistence side effects**:
   - Sinks, gold pickups and removals are queued as "effects" by the world and drained fire-and-forget to Redis/Segment, never awaited inside the tick

See `docs/netcode/PROTOCOL.md` for the exact contract and `docs/netcode/README.md` for the architecture overview.

## Deployment

- Push to `main` triggers `.github/workflows/deploy.yml`: a `test` job (install, `npm run build`, `npm test`,
  `npm run test:bots` with a `redis:7` service) gates a `deploy` job that zips the repo, creates an Elastic Beanstalk
  application version (label = commit sha) and updates environment `PirateTradeWarsEnv` (app `PirateTradeWarsApp`, us-east-2).
  It then waits for the environment and checks `https://piratetradewars.com/api/health`.
- **Single instance by design.** The world lives in one process's memory. The workflow pins ASG MinSize=MaxSize=1.
  Never raise MaxSize above 1 without first sharding the world (otherwise players land in separate worlds).
- Health check: `/api/health` (`.ebextensions/03_healthcheck.config`); ALB idle timeout 300 s for WebSockets (`04_alb_websocket.config`).
- Domain: piratetradewars.com (Route 53 alias to the EB environment, ACM cert on the ALB).
- Turning the game OFF (environment terminated, static parked page, ~$1/mo) and back ON: `docs/infra/GAME_OFF_ON.md`.
- Multi-arch zip: the deploy job adds linux-arm64 rollup/esbuild binaries next to the x64 ones so the same zip runs on t3 (x64) and
  t4g (arm64). Verified in a `linux/arm64` container (health + `/game-ws` connect).
- Planned single-instance + Cloudflare setup: `docs/infra/SINGLE_INSTANCE_CUTOVER.md`. `.platform/hooks/prebuild/01_fetch_origin_cert.sh`
  (also under `confighooks/`) installs the Cloudflare Origin cert from SSM (`/ptw/origin-cert|key`) and enables nginx :443 only if present;
  no-op otherwise.
- To push to `main` WITHOUT deploying, put `[skip ci]` in the commit message.
- Rollback to a previous version label (example: the pre-overhaul version):
  `aws elasticbeanstalk update-environment --environment-name PirateTradeWarsEnv --version-label 9486e65f77f5931929d0ebe041ac90d7f290d682 --region us-east-2`
- The `replit` branch is retired; `main` is the only deploy branch. `infra/` (CDK) is deprecated and not deployed: never run `cdk deploy`.

## Testing

- `npm test`: vitest unit tests (shared physics/protocol, world core, loop, client net layer).
- `npm run test:bots`: boots a server on port 5055, runs 30 headless bots for 20 s and asserts snapshot rate,
  gaps, ack progress, privacy and visibility symmetry (details in `docs/netcode/LOAD_TEST.md`). Needs Redis.
- Local Redis: `docker run -d --name ptw-redis -p 6379:6379 redis:7`, then `REDIS_CONN_STRING=redis://localhost:6379`.
  Do not test against the Upstash Redis in `.env`.
- Env var `SHIPS_FREE` (`true`/`1` = ships free, no Stripe charge; default unset = charge). Runtime-only, set on the EB
  environment (toggle command in `CLAUDE.md`); served to the client via `GET /api/config`.
- Admin dashboard env vars `ADMIN_PASSWORD_HASH` / `ADMIN_SESSION_SECRET` (optional; unset = `/admin` is off),
  `ADMIN_TZ`, `ADMIN_TRUSTED_PROXY_HOPS`: see `docs/admin/README.md`. For a local check, make a test hash with
  `npm run admin:hash -- 'test password'` and any 64-hex-char secret.
- Local server runs need a dummy `STRIPE_SECRET_KEY=sk_test_dummy` (the Stripe routes throw at import without it).
  `SEGMENT_WRITE_KEY` may be unset (no-op). `test:bots` injects the dummy keys itself.

## Future Development Areas

1. Ship upgrades and customization
2. More complex combat mechanics
3. Weather and environmental effects
4. Quests and missions
5. Social features (chat, crews, etc.)

## Additional Documentation
- See folder-specific context files for detailed implementation information
- Check `package.json` for all dependencies and scripts
- Refer to TypeScript types for data structure details