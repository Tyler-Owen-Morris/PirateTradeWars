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
| R  | Producer: integrate, run tests + bots locally, push, deploy, verify prod | producer + QA agent | main | in-progress | browser play-test running (progress/R-playtest.md) |
| I1 | Infra: move EB to t4g.small (Graviton/arm64) — verify arm64 bundle, then apply after netcode deploy | agent-I (sonnet) + producer applies | worktree (progress/I-infra.md) | in-progress | agent preparing |
| I2 | Infra: Cloudflare (free) in front of piratetradewars.com — needs Theo: Cloudflare account/API token + registrar nameserver change | Theo + producer | — | waiting on Theo | Theo creates CF zone + token |
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
