# Bot load / smoke test (card N4)

Headless bots that speak the new protocol (`docs/netcode/PROTOCOL.md`, `shared/protocol.ts`) and measure
what the server delivers. Files: `scripts/bots.ts` (the bots), `scripts/run-bot-test.ts` (boots a server, runs
the bots with `--assert`, kills the server).

## Running locally
Needs Redis (`docker start ptw-redis`, `redis://localhost:6379`).

```
# Everything in one go (what CI runs): boot server on :5055, 30 bots, 20 s, assert
REDIS_CONN_STRING=redis://localhost:6379 npm run test:bots
npm run test:bots -- --bots 100 --duration 60 --json out.json

# Bots only, against an already running server
npm run bots -- --bots 20 --duration 30 --url ws://localhost:5055/game-ws [--assert] [--json out.json]
```
`bots.ts` options: `--bots` (20), `--url`, `--duration` s (30), `--warmup` s (3, excluded from gap stats),
`--assert`, `--json <file>`. Exit codes: 0 ok, 1 assertion failure (only with `--assert`), 2 usage / server
unreachable. `run-bot-test.ts` options: `--bots` (30), `--duration` (20), `--port` (5055), `--json`,
`--allow-remote-redis`. It refuses a `REDIS_CONN_STRING` containing `upstash` without that flag, injects dummy
`SEGMENT_WRITE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` if unset (the server throws at import
without them), waits up to 60 s for `GET /api/health` = 200, and kills the server tree (`taskkill /T /F` on Windows).

## CI
`.github/workflows/deploy.yml` test job runs `npm run test:bots --if-present` with a redis:7 service and
`REDIS_CONN_STRING=redis://localhost:6379`. A non-zero exit blocks the deploy job.

## What a bot does
Connects, sends `{type:"connect", name:"bot<run>_<i>", shipType:"sloop"}`, waits for `connected`, then sends
`input` at 20 Hz (seq increasing from 1; `th:1` 90% of steps, rudder re-rolled every 0.5-3 s, `f:1` 3%) and
`ping` every 2 s. Bots connect 25 ms apart. The server picks spawn positions, so bots do not cluster.

## Metrics (per bot, table + JSON)
| column | meaning |
|---|---|
| snap/s | snapshots (`t:"s"`) per second between first and last snapshot |
| KB/s | bytes/s received for snapshots, `ent`, `gone` and event messages |
| maxGap / avgGap | max / mean ms between consecutive snapshots, after the warmup |
| known | eids in the bot's known set at the end (`ent` added, `gone` removed) |
| seen | distinct eids ever seen in `e` rows; rows = max `e` rows in one snapshot |
| rttAvg / rttMax | ms, from `ping.c` echoed in `pong.c` |
| ack | first -> last `a` (acked input seq); must advance |
| events | counts of other messages (`fire`, `hit`, `sunk`, `goldCollected`, ...) |

Summary line adds averages, worst gap, and visibility symmetry (pairs of bots where A knows B, and how many
had B not knowing A).

## Assertions (`--assert`) and thresholds
Fail if any of:
- a bot never got `connected` (15 s), or its socket closed before the end of the run
- a bot's snapshot rate < 15/s (server nominal 20/s)
- any inter-snapshot gap > 1000 ms after warmup
- acked seq did not advance (`a` last <= first)
- a server `error` / `nameError` message arrived
- privacy/shape violation: `me` not an object, `e` not an array, any `e` row that is not an array of exactly
  7 numbers, or an `ent` message carrying gold/cargo/inventory fields
- visibility asymmetry above 15% (only checked with >= 10 bot-bot pairs). Spawns are random in a 10000x10000
  world with interest radius 2000, so "everyone sees everyone" cannot be asserted; but if A knows B, B should
  know A (allowing transient mismatch). The count is always reported.

## Protocol assumptions (verify at integration)
- `connected` arrives with `type` (not `t`); the bot reads `m.t ?? m.type`.
- Snapshot `me.eid` is optional; the bot only records it.
- The bot's own player id (`connected.playerId`) equals the `id` field in other bots' `ent` messages (used for symmetry).
- `ping` is sent as `{t:"ping", c}` and answered by `{t:"pong", c, st}`.
- The server accepts the `sloop` ship type and unique names of 3-32 chars.
