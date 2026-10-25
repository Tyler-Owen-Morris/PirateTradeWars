# Pirate Trade Wars - notes for Claude agents

Browser 3D multiplayer pirate game: sail an infinite wrapping ocean, trade at ports, fight, climb the gold
leaderboard. React + Three.js (@react-three/fiber) client, Node/Express + `ws` server, Redis storage.
Real-time model: authoritative 20 Hz server, client prediction (own ship) + interpolation (others).

## Layout
- `client/` React app (`client/CLIENT_CONTEXT.md`); netcode in `client/src/lib/net/`
- `server/` Express + WebSocket (`server/SERVER_CONTEXT.md`); world in `server/game/world.ts`
- `shared/` physics, protocol, schema used by both (`shared/SHARED_CONTEXT.md`)
- `scripts/` bot load test; `docs/netcode/` netcode docs; `infra/` DEPRECATED CDK; `.ebextensions/` EB config
- `PROJECT_CONTEXT.md` overview, deployment and testing

## Commands
- `npm run dev` - server + Vite client on port 5000 (needs Redis and env, see gotchas)
- `npm run build` - vite build + esbuild server bundle to `dist/`
- `npm test` - vitest unit tests
- `npm run test:bots` - boots a server on :5055 and runs headless bots with assertions (needs local Redis)
- `npm run check` - tsc (baseline has ~113 pre-existing errors; gate is no NEW errors in files you touch)

## Deployment rules
- A push to `main` DEPLOYS TO PRODUCTION (GitHub Actions `deploy.yml`: test job, then Elastic Beanstalk
  `PirateTradeWarsEnv`, us-east-2, https://piratetradewars.com). Put `[skip ci]` in the commit message to push without deploying.
- Single EB instance by design (world is in one process's memory). Never raise ASG MaxSize above 1 without sharding.
- NEVER run `cdk deploy` in `infra/` (abandoned; it would create a new VPC/ALB/ASG).
- The `replit` branch is retired. The rollback command is in `PROJECT_CONTEXT.md`.
- Never push release tags or trigger builds unless the user asks.
- **Free ships on/off** (`SHIPS_FREE` env var, `server/config.ts` `shipsFree()`): `true`/`1` = every ship free (Stripe
  create-payment-intent returns 409, ship cards show the price struck through + "Free"); unset/anything else = charge.
  The client reads it from `GET /api/config`. Toggle in production (restarts the app process, ~1 min; ships persist in Redis):
  `aws elasticbeanstalk update-environment --region us-east-2 --environment-name PirateTradeWarsEnv --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=SHIPS_FREE,Value=true`
  (`Value=false` to charge again). `deploy.yml` only passes the ASG MinSize/MaxSize option settings and `.ebextensions/`
  sets only health check and ALB idle timeout, so a deploy does not overwrite EB env vars. Confirm with the user first.
- **Game OFF/ON** ("turn the game off", "park the site", "turn it back on"): follow `docs/infra/GAME_OFF_ON.md`.
  OFF = EB environment terminated, domain on a static parked page (~$1/mo); ON = EB environment re-created from
  the saved template. The current state is at the top of that doc. Confirm with the user before switching.

## Netcode docs
`docs/netcode/README.md` (start here), `PROTOCOL.md` (contract), `LOAD_TEST.md` (bots), `BUILD_STATE.md` (history, numbers).
`shared/physics.ts` runs on both client and server: changing it changes both.
The ice lines are asymmetric (`ICE_LAT_N` 72, `ICE_LAT_S` 70 in `shared/world/geo.ts`, mirrored in
`scripts/world/lib/common.ts`); there is no single `ICE_LAT`. Use `iceLatFor(lat)` for per-hemisphere code.

## Gotchas
- `reusePort` is unsupported on Windows; `server/index.ts` skips it on win32.
- Local server runs need a dummy `STRIPE_SECRET_KEY=sk_test_dummy` (Stripe routes throw at import). `SEGMENT_WRITE_KEY` may be unset.
- Never test against the Upstash Redis in `.env` (a real DB). Use Docker: `docker run -d --name ptw-redis -p 6379:6379 redis:7`
  with `REDIS_CONN_STRING=redis://localhost:6379`. `test:bots` refuses `upstash` URLs.
- No `await` inside `World.step()` / the tick; side effects go through `world.effects`.
- Keyboard game input (drei KeyboardControls listens on `window`) must check `isTextEntryActive()`
  (`client/src/lib/stores/useInputFocus.ts`) so typing in chat or any text field never steers or fires.
- Global chat is in-memory only (`server/game/chat.ts`, PROTOCOL.md "Global chat"); a deploy clears it,
  including strikes and mutes. Players include kids: moderation is server-side in `server/game/chatFilter.ts`
  (`obscenity` + own lists; mild = masked, severe/personal-info = dropped, 3 drops = mute) and also gates new
  ship names. Add a false-positive test whenever you add a word.
- Local testing gold: `NODE_ENV=development DEV_START_GOLD=10000000 npm run dev` gives every new captain that much gold
  (`server/game/socketHandler.tsx`; ignored unless NODE_ENV=development).
- Agent worktrees may start at a stale commit: `git reset --hard main` first.
