# N3 — Client netcode: progress

- Branch: `worktree-agent-ad7589a518f7b72ba`
- Worktree: `C:\Users\theow\Documents\GitHub Projects\PirateTradeWars\.claude\worktrees\agent-ad7589a518f7b72ba`
- Base: main @ 113b0fa, then merged main (N2) after the N3 commit
- tsc: baseline 114 errors → 66 after N3 (no new errors; PlayerState type fixed)
- Worktree has no node_modules; run tools from the main checkout, e.g.
  `node ..\..\..\node_modules\vitest\vitest.mjs run`, `node ..\..\..\node_modules\vite\bin\vite.js build`

## Done
- client/src/lib/net/{controls,clock,prediction,interpolation,cannonballs,connection,netClient,index}.ts
- tests in client/src/lib/net/__tests__ (37 tests). Full suite passes.
- React rewired: types/index.ts, useSocket.tsx (no server/ import), useGameState.tsx, Player, OtherShips,
  CannonBall (CannonBalls), GameScene, Ship (getHp), HUD (reloadMs), App (net.setHidden)
- Aligned with the PROTOCOL "N2 clarifications": seq restarts per session, a=-1, no local entity pruning,
  ball timelines. "N3 clarifications" were added to PROTOCOL.md.
- vite build OK; CLIENT_CONTEXT.md "Netcode (client)" section

## Left
- Nothing for N3. The producer integrates and runs bots and a manual play test.

## Next step
- Producer: merge the branch into main.
