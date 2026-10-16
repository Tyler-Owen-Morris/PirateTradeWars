# N1 progress — shared physics + protocol + vitest

Branch: `worktree-agent-a9e0b5101ac0aec53`
Worktree: `C:\Users\theow\Documents\GitHub Projects\PirateTradeWars\.claude\worktrees\agent-a9e0b5101ac0aec53`

## Status: DONE — commit 680d90f (on top of main c97d65d), not pushed.

## Log
- Started. Worktree was at d51ff96; reset (clean) to main c97d65d. Read PROTOCOL.md / BUILD_STATE.md.
- Wrote shared/physics.ts (stepShip, wrap helpers, cannonball helpers, segmentHitsCircle).
- Wrote shared/protocol.ts (message types, entity rows, flags, constants, parseClientMessage).
- vitest@^2.1.9 devDep, `npm test` = `vitest run`, vitest.config.ts (standalone; aliases @shared, @).
- Tests: shared/__tests__/physics.test.ts (32), protocol.test.ts (13) — 45/45 pass.
- `npx tsc --noEmit -p .` = 113 errors (= baseline), none in touched files. Test files (excluded by
  tsconfig) type-check clean with a scratch config. esbuild bundles both files (platform=neutral).
- PROTOCOL.md: added "N1 clarifications" under §6: `me.eid` (optional), `sunk.eid` may be "me",
  `pong` = {t, c, st}, integer ball ids, goldCollected uses `t`, parseClientMessage rules,
  segmentHitsCircle replaces the 3D sphere test, rotation normalized to [-π, π).
- shared/SHARED_CONTEXT.md: listed the new files.

## Notes for N2/N3
- One `stepShip` call = one 50 ms tick. Use `shipPhysicsStats(shipType)` or
  `physicsStatsFromMaxSpeed(player.maxSpeed)`.
- `parseClientMessage(raw)` accepts the string frame directly; returns null for anything invalid.
- npm install skipped esbuild postinstall scripts (sandbox) but esbuild/vitest still work.

## Left / next step
- Nothing for N1. Producer: merge branch `worktree-agent-a9e0b5101ac0aec53` into main.
