# N2 progress — server netcode

Branch: `worktree-agent-ae798a5f5823ed2f6`
Worktree: `C:\Users\theow\Documents\GitHub Projects\PirateTradeWars\.claude\worktrees\agent-ae798a5f5823ed2f6`
(node_modules is a junction to the main checkout's node_modules; it is gitignored.)

## Done
- Reset worktree to main 113b0fa. Read PROTOCOL/BUILD_STATE/shared/server code. Baseline tests 45 pass.
- server/game/world.ts (pure core: players/eid, input queue, step, balls, gold, grid, events, effects, buildMessages).
- server/game/loop.ts (FixedStepLoop, drift-free, max 5 catch-up).
- server/game/gameState.tsx rewritten as wiring (world + loop + sockets + fire-and-forget effects + shutdown).
- server/game/socketHandler.tsx rewritten (parseClientMessage, input→queue, ping→pong, no flushSegment awaits, no world dumps).
- server/routes/routes.tsx heartbeat + graceful shutdown; server/index.ts reusePort off on win32 (producer request).
- segmentClient: shutdownSegment(). tsc: 111 errors total (baseline 113), none in touched files.

- server/game/__tests__/world.test.ts: 22 tests, all 67 pass. Tick budget 300 ships: 4.2 ms spread / 8.1 ms dense.
  Added World.buildFrames (cached per-tick row JSON) used by the wiring.

- segmentClient is a no-op without SEGMENT_WRITE_KEY (it threw at import before).
- E2E PASS (scratchpad e2e.mjs, 8 clients, local Redis, server on 5055 with a dummy STRIPE_SECRET_KEY because
  stripeRoutes throws without one): connect, no dumps in `connected`, ~20 snapshots/s, ent.id === playerId,
  pong {c,st}, X moves and Y sees the rows, ack a == last seq, disconnect → flag 2 and v coasts to 0. Server stopped.

- SERVER_CONTEXT.md "Netcode (server)" section; PROTOCOL.md "N2 clarifications" (frame order, a=-1 + seq reset
  on (re)connect, `me` unrounded, ball rounding/timing, hit/sunk recipients, congestion skip).
- npm test 66/66, npm run build OK, tsc 111 (baseline 113, no errors in touched files).
- COMMITTED 16e536d on branch worktree-agent-ae798a5f5823ed2f6 (not pushed).

## Status: DONE (awaiting producer merge)
## Not verified: graceful SIGTERM shutdown (Windows can't deliver SIGTERM/SIGINT to node), heartbeat
   terminate path (ws clients auto-pong). Check both on Linux/EB or in the N4 bot run.
