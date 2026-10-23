# Trade redesign: progress notes

Resume here if the agent drops. This is a proposal task only: no game code changes.

## Status (2026-10-23)
- [x] Reset the worktree to `dev/2026-10-23-batch` (776e3b1). `node_modules` is a junction to the main checkout
      (gitignored).
- [x] Read the code: TradeMenu.tsx, TradingToast.tsx, the GameUI trade wiring, useSocket trade handling,
      shared/protocol.ts trade/upgrade/repair, server/game/socketHandler.tsx handleTrade/Upgrade/Repair,
      server/game/ports.ts.
- [x] Found the parallel theme layer: worktree `agent-a9c1ee7e030ab19ea` (uncommitted).
      - Files: `client/src/styles/pirate.css` (tokens `--ptw-*`, classes `ptw-*`) and
        `client/src/components/ui/pirate/*` (README.md documents them).
      - Fonts: Pirata One / IM Fell English SC / Alegreya.
      - It explicitly leaves TradeMenu to this effort.
- [x] "Before" screenshots of the live client: `before-*.png`.
- [x] `prototype.html`, tested with Playwright at 1280×720, 375×667 and 667×375: no horizontal scroll, the primary
      button stays in the viewport, keyboard flow works, the error simulations work, no console errors.
- [x] `docs/design/STYLE_GUIDE.md`
- [x] `PROPOSAL.md`
- [x] Committed `[skip ci]`. Not pushed.
- [ ] NEXT: two UI reviewers will critique the prototype; revise `prototype.html`, STYLE_GUIDE and PROPOSAL.

## How to work on the prototype
- `prototype.html` is the only source. The "before" screenshots are inlined as JPEG data URIs inside the
  `<section class="before">` `<img>` tags (long lines; don't touch them).
- It has no doctype or html/head/body tags (the Artifact host adds them). To test locally, wrap it:
  `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>…</body></html>`.
- Layout uses container queries on `.device` (`container-name: dev`):
  - phone: `max-width: 640px`
  - landscape split: `max-height: 520px and min-width: 560px`
- Test scripts (scratchpad, not committed): Playwright 1.64.1 in `<scratchpad>/pw/`.
  - `proto.mjs`: 3 viewports, buy max, sell, shipwright.
  - `keys.mjs`: keyboard flow, error sims, sell-all.
  - `shrink.mjs`: PNG to JPG.

## Facts found in code (used in the critique)
- One `selectedGoodId` is shared by the Buy and Sell tabs, and a tab switch never clears it. So the Sell panel opens
  on a good you don't own (complaint 2).
- `DialogContent` has `max-h-screen overflow-y-auto`, and the detail panel is rendered BELOW the list. Measured Buy
  Max top: y=912 @1280×720, y=980 @375×667 (complaint 3).
- "Buy Max" and "Sell Max" fire immediately. The selection is cleared before the server answers.
- The trend colour is inverted for buyers.
- `tradeSuccess` plays `playPlayerHit()`.
- `ToastContainer` duplicates the T toast.
- Server `handleTrade` buy: checks stock but never decrements it. One price serves both buy and sell. No avg-paid is
  stored.
- `World.setShipType` keeps `cargoUsed`, so cargo stays aboard on an upgrade.
- `Player.tsx` is already neutral while `isTrading`, but the GameUI hotkeys (M/H/Tab) still fire.
