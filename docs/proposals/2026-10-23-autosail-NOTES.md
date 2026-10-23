# Auto-sail (2026-10-23)

Client-only keyboard feature; wire input stays `th: 1`, no protocol/server change.

- State machine: `client/src/lib/net/autoSail.ts` (`AutoSail.update(fwd, back, nowMs)`, `reset()`), tests in `client/src/lib/net/__tests__/autoSail.test.ts`.
- Wiring: `Player.tsx` useFrame feeds keyboard-only forward/backward, ORs result into `forward`; resets on `player.sunk`, `isTrading`, focused input/textarea/contenteditable, unmount (game end). Blur is deliberately not handled.
- UI: `ui/AutoSailIndicator.tsx` (reads `stores/useAutoSail.ts`), mounted once in `GameUI.tsx`; line added to `HelpTooltip.tsx`.
- Rules: double-tap <=300 ms press-to-press engages; fresh forward press or backward cancels; cancel press is not a first tap (needs two more presses to re-engage).
- Status: done. npm test 345 pass; tsc errors unchanged vs baseline (59 lines, only line-number shifts in GameUI.tsx).
- PROTOCOL.md has no key-mapping section beyond the sign-convention note, so not changed.
