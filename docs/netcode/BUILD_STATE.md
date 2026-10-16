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
| N1 | `shared/physics.ts` + `shared/protocol.ts` + vitest setup + unit tests | agent-N1 (opus) | worktree (see progress/N1-shared.md) | in-progress | agent running |
| N2 | Server netcode: fixed tick, input queue, interest grid, events, heartbeat (depends N1) | agent-N2 (opus) | worktree | blocked on N1 | — |
| N3 | Client netcode: prediction, interpolation, socket rewrite (depends N1) | agent-N3 (opus) | worktree | blocked on N1 | — |
| N4 | Bot load/smoke test `scripts/bots.ts` + wire into CI (depends N1; integrates with N2) | agent-N4 (sonnet) | worktree | blocked on N1 | — |
| D  | Docs: PROJECT/SERVER/CLIENT/SHARED context files, architecture notes | agent-D (sonnet/haiku) | after merge | todo | after N2/N3 merge |
| R  | Producer: integrate, run tests + bots locally, push, deploy, verify prod | producer | main | todo | — |
| W2 | Colyseus migration — **deferred**, decide after Wave 1 metrics (see PROTOCOL.md §8) | — | — | deferred | — |

## Log
- 2026-10-16 Ledger created. replit merged into local main (cc7ac66).
- 2026-10-16 Launched agent-A (CI/CD, sonnet) and agent-N1 (shared physics/protocol, opus) in worktrees.
- 2026-10-16 Local Docker Redis `ptw-redis` running on :6379 for local/bot tests (REDIS_CONN_STRING=redis://localhost:6379).
- 2026-10-16 Card A merged (e555cda). Producer removed .platform nginx override (risk of duplicate directive breaking nginx; 15s heartbeat makes it unnecessary). NOTE: agent worktrees start at origin/main — agents must `git reset --hard main` first.
