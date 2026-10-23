# Netcode Overhaul — Build State (ledger)

Owner/producer: Claude (main session). Requested by Theo on 2026-10-16.
Goal: one shared world anyone can join, smooth movement, `main` deploys to AWS production.

**If you are resuming after a shutdown:** read this file, then `docs/netcode/PROTOCOL.md`, then the
progress file for any card that is `in-progress`. Each card's progress file says exactly where it stopped.

## Facts about production (verified 2026-10-16)
- Prod = Elastic Beanstalk app `PirateTradeWarsApp`, env `PirateTradeWarsEnv`, us-east-2, Node 20 on AL2023,
  ALB + nginx, t3.micro, ASG Min 1 / **Max 4** (the cause of split worlds). DeploymentPolicy AllAtOnce.
- `piratetradewars.com` A-alias → the EB env. ACM cert on the ALB :443 listener. Health: `/api/health`.
- Live version label `9486e65f77f5931929d0ebe041ac90d7f290d682` (= old `replit` head). **Rollback:**
  `aws elasticbeanstalk update-environment --environment-name PirateTradeWarsEnv --version-label 9486e65f77f5931929d0ebe041ac90d7f290d682 --region us-east-2`
- EB env vars: PORT, REDIS_CONN_STRING (Upstash), SEGMENT_WRITE_KEY, STRIPE_* , VITE_STRIPE_PUBLISHABLE_KEY.
- GitHub secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, REDIS_CONN_STRING, CYPRESS_RECORD_KEY, NGROK_URL.
- Local `.env` REDIS_CONN_STRING = **dev** Upstash DB. For load tests prefer local Docker Redis
  (`docker run -d --name ptw-redis -p 6379:6379 redis:7` → `REDIS_CONN_STRING=redis://localhost:6379`).
- Not touched (needs Theo): stray ASG `PirateTradeWarsASG` running a c7a.medium (`i-0bd5c19476416577d`, from the
  abandoned CodeDeploy setup), CloudFormation `PirateTradeWarsFrontendStack`, bucket `piratetradewars-deploy-bucket`.
- Baseline `npx tsc --noEmit` = 113 errors before this work. Gate = no NEW errors in touched files.

## Branches
- `main` (local, not yet pushed): merge of `replit` into `origin/main` (commit cc7ac66). `replit` is retired.
- Card branches come from worktrees off `main`; the producer merges them into `main`.
- Push rule: every push before the final deploy carries `[skip ci]`. The final push to `main` deploys.

## Cards
| ID | Card | Owner | Branch / worktree | Status | Next step |
|----|------|-------|-------------------|--------|-----------|
| A  | CI/CD: main → EB, retire CodeDeploy/CDK pipeline, MaxSize=1, WS timeouts, test gate | agent-A (sonnet) | merged into main | done | — |
| N1 | `shared/physics.ts` + `shared/protocol.ts` + vitest setup + unit tests | agent-N1 (opus) | merged into main | done | — |
| N2 | Server netcode: fixed tick, input queue, interest grid, events, heartbeat (depends N1) | agent-N2 (opus) | merged into main | done | — |
| N3 | Client netcode: prediction, interpolation, socket rewrite (depends N1) | agent-N3 (opus) | merged into main | done | — |
| N4 | Bot load/smoke test `scripts/bots.ts` + wire into CI (depends N1; integrates with N2) | agent-N4 (sonnet) | merged into main | done (verified) | — |
| D  | Docs: PROJECT/SERVER/CLIENT/SHARED context files, architecture notes | agent-D (sonnet/haiku) | merged into main | done | — |
| R  | Producer: integrate, run tests + bots locally, push, deploy, verify prod | producer + QA agent | main | done | netcode live: version 30b2f2a, 1 instance |
| I1 | Infra: move EB to t4g.small (Graviton/arm64) — verify arm64 bundle, then apply after netcode deploy | agent-I (sonnet) + producer applies | worktree (progress/I-infra.md) | done (verified t4g.small arm64) | — |
| I2 | Infra: Cloudflare (free) in front of piratetradewars.com — needs Theo: Cloudflare account/API token + registrar nameserver change | Theo + producer | — | in-progress | NS already on CF; need token perms Zone Settings + SSL |
| I3 | Infra: EB SingleInstance (drop ALB, ~$23/mo) with Cloudflare Origin cert on nginx; then release the 3 ALB EIPs + delete Route53 zone | agent-I prepares, producer applies | worktree | blocked on I2 | — |
| W2 | Colyseus migration — **deferred**, decide after Wave 1 metrics (see PROTOCOL.md §8) | — | — | deferred | — |

## Log
- 2026-10-16 Ledger created. replit merged into local main (cc7ac66).
- 2026-10-16 Launched agent-A (CI/CD, sonnet) and agent-N1 (shared physics/protocol, opus) in worktrees.
- 2026-10-16 Local Docker Redis `ptw-redis` running on :6379 for local/bot tests (REDIS_CONN_STRING=redis://localhost:6379).
- 2026-10-16 Card A merged (e555cda). Producer removed .platform nginx override (risk of duplicate directive breaking nginx; 15s heartbeat makes it unnecessary). NOTE: agent worktrees start at origin/main — agents must `git reset --hard main` first.
- 2026-10-16 Card N1 merged (113b0fa): 45 tests pass, npm ci OK. Launched N2 (server, opus), N3 (client, opus), N4 (bots, sonnet) in parallel.
- 2026-10-16 Card N4 merged. Harness lifecycle verified vs old server; asserts run at integration. Known: reusePort ENOTSUP on Windows (sent to N2); harness injects dummy SEGMENT/STRIPE keys in CI.
- 2026-10-16 Card N2 merged (f6facaf). 66 tests pass. Bot test (30 bots, 20 s) PASS: 20.0 snaps/s, worst gap 94 ms, 0% visibility asymmetry, ~7.7 KB/s/client, tick ~1 ms.
- 2026-10-16 Capacity (200 bots, 30 s, bots + server on same Windows desktop) PASS: 19.3 snaps/s, worst gap 802 ms (connect burst), 25 visible ships avg, ~21 KB/s/client, tick avg 16 ms (budget 50 ms). Most cost is per-client JSON serialization → Wave 2 (binary/Colyseus) only matters past ~200 concurrent; t3.micro (burstable, 10% baseline) is the more urgent limit.
- 2026-10-16 Unverified on Windows (verify on EB): SIGTERM graceful shutdown, heartbeat terminate path.
- 2026-10-16 Card N3 merged (fast-forward to 6b23344). 103 tests pass, build OK, bot test PASS (20 snaps/s, worst gap 64 ms, 0% asymmetry). Launched browser play-test agent (60 bots + 2 Playwright players) and docs agent D.
- 2026-10-16 Card D merged (8f487c7): PROJECT_CONTEXT deployment/testing, docs/netcode/README.md, root CLAUDE.md. Leftover legacy sections in SERVER_CONTEXT.md (Game Physics, Admin Routes) flagged, not blocking.
- 2026-10-16 Theo approved: delete strays, Cloudflare + drop ALB, t4g.small. DONE: deleted ASG PirateTradeWarsASG (c7a.medium i-0bd5c19476416577d terminated, ~$37/mo), bucket piratetradewars-deploy-bucket, CFN stack PirateTradeWarsFrontendStack. NOT stray: the 3 EIPs (16.59.66.41, 3.16.241.76, 3.20.92.222) are attached to the prod ALB — release only after I3. Left: piratetradewars-frontend-bucket (8 old objects, cents), CDKToolkit stack, CodeDeploy app (free). Unrelated ~$40/mo in us-west-2 (ALB/Fargate/RDS) — not PTW, untouched.
- Infra order: netcode deploy → I1 t4g.small (instance replace, short downtime) → I2 Cloudflare in front of ALB (no downtime) → I3 single-instance cutover (short downtime).
- 2026-10-16 Browser play-test (2 Playwright players + 60 bots, headless swiftshader ~9-12 fps): PASS for UI flow, WS rates (20 snaps/s), ent/gone/fire/hit, hidden-tab neutral input, reconnect keeps hp/gold, HUD; no console errors. Bugs: (1) camera lerp is per-frame → loses ship at low fps / after reconnect; (2) inputs/s < 20 at low fps. Card N3-fix launched (opus, progress/N3-fix.md). Deploy waits on N3-fix.
- 2026-10-16 N3-fix merged (23035ee): root cause = components calling clock.getElapsedTime() (advances THREE.Clock, shrinking R3F delta); camera now exp-smoothed + bounded. 115 tests, build, bots PASS. DEPLOYING: push to main without [skip ci]. Rollback = version 9486e65f77f5931929d0ebe041ac90d7f290d682.
- 2026-10-16 Deploy run 38969366438 FAILED in test job (300-ship tick 13.9 ms > 10 ms on GH runner) — nothing deployed. Found prod EB default scaling alarm (NetworkOut) flapping ASG 1↔2 several times/day = live split worlds. Producer applied MinSize=1/MaxSize=1 to prod via update-environment (no version change). Perf threshold relaxed to 25 ms (half tick). Redeploying.
- 2026-10-16 Theo supplied Cloudflare API token (stored in .env CLOUDFLARE_API_TOKEN, gitignored). Zone piratetradewars.com id b04bc41a29018b85041fdbf36458e4bb is ACTIVE (registrar GoDaddy, NS already on Cloudflare). CF DNS: 3 proxied A records → ALB EIPs. Token can edit DNS but NOT zone settings / SSL (error 9109) — asked Theo to add Zone Settings:Edit + SSL and Certificates:Edit.
- 2026-10-16 Card I (I1+I3 prep) done on branch worktree-agent-a74296e132b27313a (187248d): arm64 packaging step in deploy.yml (verified in linux/arm64 container), inert origin-cert hooks, runbook docs/infra/SINGLE_INSTANCE_CUTOVER.md. Merge AFTER netcode deploy verified; t4g apply only after a zip with arm64 binaries is live.
- NOTE for I3: CF A records point at the ALB EIPs — on SingleInstance cutover, change CF record to the instance EIP (or CNAME to EB env CNAME) BEFORE releasing ALB EIPs.
- 2026-10-16 NETCODE LIVE: deploy run 38969774757 succeeded, EB version 30b2f2ad, ASG 1/1/1, /api/health 200. Prod bot check (8 bots via wss://piratetradewars.com through Cloudflare, 25 s) PASS: 20 snaps/s, worst gap 91 ms, RTT ~100 ms. EB enhanced health shows Grey (agent not reporting) — pre-existing, investigate.
- 2026-10-16 CF token now has SSL and Certificates (origin cert API OK) but still NOT Zone Settings (9109) — asked Theo again. Merged card I (bbb3b41) and pushed to deploy the arm64-ready zip; next: apply t4g.small.
- 2026-10-16 Deploy run 38970447878 succeeded (bbb3b41 = arm64-ready zip live). Applied I1: InstanceTypes=t4g.small, SupportedArchitectures=arm64. EB replaced i-07bb6858309c4b82d with i-0234eb825c08906c3, "Environment update completed successfully" 21:45 UTC. Post-switch verification (instance type, ASG 1/1, health, prod bots) NOT yet run — Theo interrupted; do it next.
- 2026-10-16 Theo requested research + proposal (no build yet): (1) world map — seamless globe instead of jumping wrap, real land with collision, navigation UI; (2) NPC ships (fight/flee/attack) with a threat system as groundwork for factions. Research agents launched; proposal goes to docs/proposals/.

## Bug 2026-10-23: own ship jumps back, then warps forward ~10 km (FIXED on branch, not deployed)
Report (Theo, live): "I'll go a few km, then get jumped backwards, then warp forwards 10 km."
Notes/resume file: `docs/proposals/2026-10-23-netcode-jumps-NOTES.md`.

**Root cause: the server's "starved queue" rule.** When a connected player's input queue was empty at a
tick (its next input late by even a few ms), `World.step()` stepped the ship with the last input anyway
(a "phantom" tick, old PROTOCOL §5). When the late input arrived it was simulated as well, and nothing ever
paid the phantom back. The client predicts sim(inputs 1..n) and reconciles to `me` + replay(seq > a), so:
- every starved tick put the server one tick of travel AHEAD of the client's input history: a forward
  correction of 12 u (1.2 km) for a sloop, 27 u (2.7 km) for a dreadnaught, each one smoothed over
  ~0.12 s (looks like a surge/warp; several in a row after a TCP stall = "warp forward 10 km");
- after a stall, the burst of late inputs overflowed the 10-input queue (`MAX_INPUT_QUEUE`); dropped inputs
  were never simulated, so the client was corrected BACKWARDS by one tick per dropped input ("jumped
  backwards"), a hard snap above 150 u.
Uplink jitter, TCP head-of-line stalls (WiFi loss, Cloudflare -> ALB -> nginx), browser frame hitches
(tile loading, tab throttling) and server stalls all trigger it. The Q1 world QA "fake netcode snaps of up
to 1,250 units" under SwiftShader (docs/world/qa/Q1-REPORT.md) were this bug too (client hitches).

**Evidence.**
- `server/game/__tests__/ownShipSim.ts`: real client `Predictor` + real `World` + `FixedStepLoop` over
  simulated in-order TCP links (latency, jitter, stalls; 1 ms resolution). Old server, sloop, 30 s straight:
  uplink stall 400 ms -> 7 forward corrections of 12 u; uplink stall 800 ms -> 15 x 12 u forward then 72 u
  backward; server stall 1 s -> 132 u backward; client hitch 600 ms -> 11 x 12 u forward.
- Bots (`npm run test:bots`, new own-ship assertion): old server, 30 bots on localhost, 30 s -> max own
  correction 11.99 u. Fixed server, 60 bots, 75 s -> 0 corrections in 84 343 reconciles (held=190 starved
  ticks that would each have been a forward warp).
- Production (EB tail, 2026-10-23 18:35 UTC, read-only): `[tick] avg 0.43 ms`, `dropped=1`, npc max
  <= 1.8 ms. Server overload is not the trigger in prod; the network/client side is.
- Ruled out: wrap seam (all sims cross x = 0 with zero error: reconcile uses `wrappedDelta`, render space is
  float64 deltas), float precision (x < 400 000 in float64; render space is relative), clock sync (own
  ship does not use it), downlink stalls (no correction), land mismatch (client and server share
  `LandField` and the same tiles; only possible near a coast while a tile is still loading).

**Fix.**
- `server/game/world.ts`: an empty queue now HOLDS the ship (no step, `a` unchanged). Invariant: server
  state = stepShip over inputs 1..a. The late input is simulated on arrival; catch-up (2/tick when > 3
  queued) repays the pause. Hidden tab: the ship now holds instead of coasting.
- `shared/protocol.ts`: `MAX_INPUT_QUEUE` 10 -> 40 (2 s), so a burst after a stall < 2 s is simulated in
  full. Longer outages still cost one backward correction for the dropped inputs (bounded, tested).
- Diagnostics: `world.inputStats` (held / overflow / catchUp) and the max tick ms in the `[tick]` log;
  `?netdebug=1` client overlay (`client/src/lib/net/netDebug.ts`) with correction counts/magnitudes, snaps,
  ack stalls, pending, RTT, socket closes; `Predictor.diag`.
- Tests: `ownShipSim.test.ts` (9 lossy-link scenarios, zero correction; > 2 s outage bounded), world tests
  for hold + catch-up, bots assert own-ship correction <= 1 u.
- Trade-off: other players see a ship pause for a starved tick and then catch up at 2x for a tick or two
  (interpolation's 100 ms buffer hides most of it). Not addressed (pre-existing): a client sending > 20
  inputs/s gets up to 2x speed through catch-up; a token budget would close it.
- Unproven until live: the real uplink pattern from the owner's connection. Verify with `?netdebug=1`
  (corrections should stay ~0 on open water) and the `input held=` counter in the `[tick]` log.

## Log (continued)
- 2026-10-23 Own-ship jump bug: root cause found (phantom step on a starved input queue + 10-input cap),
  fixed on branch `worktree-agent-ad19e3e3e2b2b5b20`; npm test, test:bots, tsc pass. Not merged/deployed.
