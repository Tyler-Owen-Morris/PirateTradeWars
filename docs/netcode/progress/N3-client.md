# N3 — Client netcode: progress

- Branch: `worktree-agent-ad7589a518f7b72ba`
- Worktree: `C:\Users\theow\Documents\GitHub Projects\PirateTradeWars\.claude\worktrees\agent-ad7589a518f7b72ba`
- Base: main @ 113b0fa (reset done)
- tsc baseline in this worktree: 114 errors → after N3: 66 (no new errors; PlayerState type fixed)
- Worktree has no node_modules; run tools from the main checkout, e.g.
  `node ..\..\..\node_modules\vitest\vitest.mjs run`, `node ..\..\..\node_modules\vite\bin\vite.js build`

## Done
- client/src/lib/net/{controls,clock,prediction,interpolation,cannonballs,connection,netClient,index}.ts
- tests client/src/lib/net/__tests__ (34 tests; full suite 79 pass)
- React rewired: types/index.ts (PlayerState, RemoteShipSummary), useSocket.tsx (no server/ import; bridge
  to useGameState at 5 Hz), useGameState.tsx (otherPlayers summaries, real map size in calculateDistance),
  Player.tsx, OtherShips.tsx, CannonBall.tsx (CannonBalls), GameScene.tsx, Ship.tsx (getHp), HUD.tsx
  (reloadMs), App.tsx (net.setHidden on visibilitychange)
- vite build + esbuild server bundle succeed
- CLIENT_CONTEXT.md "Netcode (client)" section; PROTOCOL.md "N3 clarifications"

## Left
- Commit (see below). Integration with N2 server is the producer's job.

## Next step
- `git add -A && git commit` with `[skip ci]` + Co-Authored-By trailer. Do not push.
