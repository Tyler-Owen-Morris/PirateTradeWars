# 2026-10-23 Own-ship jumps (netcode) - progress notes

Bug (owner, live): own ship sails a few km, gets jumped backwards, then warps forward ~10 km.
Branch: `worktree-agent-ad19e3e3e2b2b5b20` (worktree `.claude/worktrees/agent-ad19e3e3e2b2b5b20`).
node_modules in the worktree is a junction to the main checkout's node_modules.
Full write-up (root cause, evidence, fix): `docs/netcode/BUILD_STATE.md`, section "Bug 2026-10-23".

## Status: DONE on branch (committed, not pushed/merged/deployed)
- [x] Read docs, prediction.ts, loop.ts, world.ts input queue, renderSpace, cameraFollow.
- [x] Prod logs (read-only EB tail, 2026-10-23 18:35 UTC): `[tick] avg 0.43 ms`, `dropped=1` (cumulative),
      npc max <= 1.8 ms -> server overload is not the trigger in prod.
- [x] Deterministic sim `server/game/__tests__/ownShipSim.ts` (real Predictor + World + FixedStepLoop,
      TCP-ordered links with jitter/stalls). Reproduced: forward 12 u per starved tick, backward 72-132 u
      after stalls (sloop). 1 unit ~ 100 m, sloop = 12 u per 50 ms tick.
- [x] Fix: `World.step()` holds a starved ship (no phantom step); `MAX_INPUT_QUEUE` 10 -> 40.
- [x] Tests: `ownShipSim.test.ts`, world.test.ts (hold + catch-up), protocol constant, netDebug.test.ts.
- [x] Bots: each bot runs the real Predictor with the server's land; asserts own correction <= 1 u.
      Old server: 11.99 u (30 bots, 30 s, localhost). Fixed: 0 / 84 343 (60 bots, 75 s).
- [x] Diagnostics: `?netdebug=1` overlay (`client/src/lib/net/netDebug.ts`), `[tick]` log adds max tick ms
      and `input held/overflow/catchUp`.
- [x] Docs: PROTOCOL.md §4/§5, SERVER_CONTEXT, CLIENT_CONTEXT, LOAD_TEST, BUILD_STATE.
- [x] npm test (all pass), test:bots on port 5071 (pass), tsc 59 errors = baseline 59 (none in touched files;
      CLAUDE.md's "~113" baseline is stale).

## Verification on the live site (after a deploy Theo approves)
1. Open https://piratetradewars.com/?netdebug=1 and sail open water for a few minutes: `corr>100m` should
   stay 0 (a few small ones near coasts while tiles load are OK). `ack stalls` shows how often the uplink
   starved; those used to be the forward warps.
2. EB tail log `[tick]` line: `input held=` counts starved ticks (each was a warp before), `overflow=`
   should stay ~0.

## Open / not done
- Speed-hack via > 20 inputs/s (catch-up 2/tick) is pre-existing; a per-player token budget would close it.
- Observers see a starved ship pause a tick then catch up; not measured beyond the bot test passing.
