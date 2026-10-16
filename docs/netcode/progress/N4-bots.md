# N4 bots progress

Branch: worktree-agent-a7fc5266b68c1f554
Worktree: C:\Users\theow\Documents\GitHub Projects\PirateTradeWars\.claude\worktrees\agent-a7fc5266b68c1f554

Done: scripts/bots.ts, scripts/run-bot-test.ts, npm scripts, tsconfig include scripts/**, docs/netcode/LOAD_TEST.md.
Typecheck: 113 errors (baseline), none in scripts/. Dry run with no server: clean exit 2 with message.
Lifecycle verified against old-protocol server on Windows (needed a local reusePort patch, reverted): boot, health, bots, kill, port freed.
Left: commit, then producer runs `npm run test:bots` against the N2 server.
Findings: server/index.ts `reusePort: true` throws ENOTSUP on Windows; segmentClient/stripeRoutes throw at import without env keys (harness injects dummies).
