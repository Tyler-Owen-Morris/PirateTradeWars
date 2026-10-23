# Trade redesign: progress notes

Resume here if the agent drops.

## Status (2026-10-23)
1. **Proposal rev 1** (11c8c4a): audit, `prototype.html`, STYLE_GUIDE, PROPOSAL.
2. **Rev 2 after reviews** (23d2b5d). `REVIEWS.md` holds the art and UX reviews. PROPOSAL §6 answers every
   finding.
3. **Merged** `dev/2026-10-23-batch` (d5aa8c0). That merge brings in the pirate theme layer
   (`styles/pirate.css`, `components/ui/pirate/`).
4. **Build: server** (ce8a025):
   - `server/game/trade.ts`: pure rules + KeyedQueue.
   - Per-player and per-port queues.
   - ~10% spread (`shared/market.ts`).
   - Stock taken and returned.
   - avgPaid.
   - `ref` / `expectedPrice`, `sellAll`, `tradeResult`.
   - Goods API view.
   - Removed the inventory PUT.
   - `GOOD_GROUPS`.
5. **Build: client** (3eba997):
   - `components/ui/trade/BillOfGoods.tsx` + `styles/trade.css` + `lib/trade/{logic,sounds}.ts`.
   - useSocket / useGameState / GameUI / TradingToast changes.
   - Bot test trade round trip (`scripts/tradeCheck.ts`).
6. **Docs + in-game screenshots**: the commit after 3eba997.
   - Docs: PROTOCOL "Trading clarifications", SERVER_CONTEXT, SHARED_CONTEXT, CLIENT_CONTEXT.
   - Screenshots: `ingame-*.jpg`.

## Verification (last run)
- `npm test`: 47 files, 457 tests pass. New: `server/game/__tests__/trade.test.ts`, `tradeSocket.test.ts`,
  `client/src/lib/trade/__tests__/logic.test.ts`, and the protocol cases.
- `npm run test:bots -- --port 5091` (Redis `ptw-redis`): 30 bots, all assertions pass, including "trade round trip ok".
- `npm run check`: 56 error lines. The baseline was 59; the drop is TradeMenu's errors, now gone. None are in the new files.
- `npm run build`: ok.
- Playwright in the real game (own server on :5083, never :5000) at 1280×720, 375×667 and 667×375:
  - buy max and sell work, with no console errors;
  - typing 999 is rewritten to the max;
  - Sign stays inside the viewport;
  - Esc closes the screen.
  - Visible rows with the slip open: desktop shows all 8 goods (room for ~11), phone 4, landscape 4.

## How to test again
- Scripts are in the scratchpad `pw/` folder (Playwright 1.64.1): `ingame.mjs` (needs a server on :5083), `proto2.mjs`
  (the prototype), `shrink.mjs` (PNG → JPG).
- Server: `PORT=5083 REDIS_CONN_STRING=redis://localhost:6379 STRIPE_SECRET_KEY=sk_test_dummy NODE_ENV=development npx tsx server/index.ts`.

## Deferred / follow-ups
- Sounds are synthesised cues; pick CC0 samples (coins, quill, stamp, paper).
- Anchor the ship server-side while the screen is open. Today `Player.tsx` sends neutral input and the
  screen closes if you drift out of the harbour.
- Lint rules from STYLE_GUIDE §2 (eslint `no-restricted-imports` for lucide, the stylelint / grep checks) are
  not wired up yet.
- Leaderboard and Game Over restyle (STYLE_GUIDE §14).
- `POST /api/update-prices` is unauthenticated: anyone can force a market move. Out of scope here; worth a card.
- The ~11 expansion goods only need `GOODS` entries with a `group`. A port that doesn't sell a good needs
  `notSold: true` on its market row (`shared/market.ts`). Redis `goods` are seeded only when empty, so the
  expansion card must seed the new goods.
