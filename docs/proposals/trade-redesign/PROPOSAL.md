# Proposal: the trade screen as the port's bill of goods

Status: BUILT on the worktree branch (2026-10-23): `client/src/components/ui/trade/BillOfGoods.tsx`, `server/game/trade.ts`; in-game screenshots `ingame-*.jpg`. Revision 2 of the design, after the art and UX reviews (`REVIEWS.md`). The owner adopted the reviewers’
answers to the open questions and asked for it to be built; implementation notes live in `NOTES.md`.

- Prototype: `prototype.html` (self-contained; `#bare` in the URL hides the prototype bar). The bar switches frames
  (desktop 1280×720, phone 375×667, landscape 667×375), noon/night sea, simulates refusals, a moved price and a
  timeout, and shows the "before" screenshots.
- Style guide: `docs/design/STYLE_GUIDE.md`.
- Screenshots: `before-*.png` (live client), `after-{desktop,phone,land}-{idle,buy,sell,shipwright}.jpg` (prototype
  rev 2), `ingame-*.jpg` (the built screen).

## 1. Critique of the current screen

| # | Problem | Evidence | Fix |
|---|---|---|---|
| 1 | **Buy Max off-screen**: the purchase panel is appended under the list and the whole dialog scrolls. | Buy Max at y=912 in a 720px window, y=980 on 375×667; in landscape nothing actionable is visible. | Split layout: list scrolls, the bill of sale is a docked sheet whose Sign is always on screen. |
| 2 | **Selection leaks across Buy/Sell**: one `selectedGoodId` for both tabs, never reset. | Sell tab offers Cotton you don't own (`before-desktop-3-sell-after-switch.png`). | No mode: one value `{goodId, side}` chosen by pressing a price. |
| 3 | **Generic web styling**. | all before shots | Bill of goods on a plank counter (STYLE_GUIDE). |
| 4 | Rows have one generic "Select" button; buy and sell prices never visible together. | | Both prices on every line; the price *is* the button. |
| 5 | "Price Trend" is the difference from the base price, coloured backwards for a buyer. | Sugar ↓47% red on the Buy tab | "cheap here" / "pays well" judged from the player's side. |
| 6 | Max trades immediately. | `handleBuyMax` | Max is a chip; Sign states the deal. |
| 7 | Selection cleared before the server answers; errors land in a generic alert, often off-screen. | `handleTrade` | Pending lock + `ref` echo; the result stays in the slip. |
| 8 | No reason when you can't; the box accepts anything. | | Clamped amount with the limit named; blocked lines say why. |
| 9 | Doesn't scale to 19 goods. | `before-mobile-1-buy.png` | Data-driven groups, sticky headings, "Show" filter. |
| 10 | Hold is a number only. | | Bar of crates with a hatched preview. |
| 11 | Upgrade/repair as marketing cards. | `before-desktop-4-ship.png` | Shipwright: pinned work orders, same Sign. |
| 12 | Accessibility: 16px close, 32px tabs, no `aria-pressed`, default focus. | | 44px targets, focus trap, roving tabindex, live region. |
| 13 | Trade success plays the cannon-hit sound; `ToastContainer` duplicates the T toast. | `useSocket.tsx`, `TradingToast.tsx` | Coin sounds; remove the duplicate. |
| 14 | Debug logs; invented `Math.random()` prices when the goods request fails. | `TradeMenu.tsx` | Removed; show "the books are closed" + Retry. |
| 15 | The local `error` is only cleared in `loadPortData` (a stale red alert survives). | UX review | Errors live in the slip and are cleared on every new choice. |
| 16 | The global `socketError` shows unrelated errors in the trade screen. | UX review | Trade results are matched by `ref` (`tradeResult`); other errors don't reach the screen. |
| 17 | The Sell tab lists goods the port doesn't trade, at 0 gold. | UX review | The port buys everything in the catalogue; a good without a row shows "not traded here". |
| 18 | `handleBuyMax` / `handleSellMax` don't refresh the inventory. | UX review | The inventory comes from `tradeResult` (authoritative). |
| 19 | **Server race** in `handleTrade`: read inventory, `await`, absolute write; concurrent sells pay twice, buys charge twice and deliver once. | UX review B2 | Trades are queued per player on the server. |
| 20 | Buying never reduces port stock; buy price = sell price. | `socketHandler.tsx` | Stock decrements; ~10% spread. |

## 2. The design in one paragraph

You stand at the harbourmaster's counter. On the plank lies the port's **bill of goods**, a torn parchment page that
reads like a price current: `Sugar ........... 18 | 16`, what the port sells at and what it pays, with what you have
aboard and what you paid. Tap a price: it is inked in with a tick, a pointing hand marks the line, and the **bill of
sale** beside it (a separate sheet torn from a book) fills in: Purchase or Sale, the amount (−/+, 1, 10, Max/All),
the limit, what it does to your purse and hold, and on a sale your profit. The single brass plate reads exactly what
will happen ("Buy 14 Sugar · 252 g"); press it and the clerk stamps the line, coins clink, the purse rolls.

## 3. Interaction spec

### 3.1 State

```ts
type Side = "buy" | "sell";
interface TradeUi {
  tab: "goods" | "yard";
  filter: "all" | "hold" | "wanted" | "here";
  sel: { goodId: number; side: Side } | null;   // THE selection
  qty: number | null;                            // null = the box is empty/0 (invalid, Sign disabled)
  order: "repair" | "upgrade" | null;
  arm: "sellAll" | "refit" | null; armAt: number;
  pending: { ref: number; kind: "trade" | "sellAll" | "repair" | "upgrade" } | null;
  status: { kind: "ok" | "err"; text: string; side?: Side } | null;
  cur: { row: number; col: Side };               // roving focus in the ledger
  lastBuyChip: 1 | 10;                           // session memory, never Max
}
```

### 3.2 Transitions

| Event | Effect |
|---|---|
| Press a price (pointer) | Same `{good, side}` as selected → clear. Otherwise select it; `qty` = default; clear status. |
| B / S, Space, Enter on a cell (keyboard) | Choose only; never clears. |
| Tap a line's name | Sell if aboard; else buy if it can be bought; else the side that has a price (explains). |
| Default amount | Sell: all aboard. Buy: 1 (or 10 if the 10 chip was last used). Never Max. |
| −/+, chips, slider | `qty` = clamp(v, 1, max). |
| Typing | Digits only. > max → rewritten to max at once, the limit line flashes. Empty/0 → invalid, Sign disabled. |
| Sign / Enter | Only if `qty` is valid and equals the box. Sends one request with a `ref`; `pending` locks the screen. |
| `tradeResult ok` (matching ref) | Stamp, coins, purse roll, ledger note; keep the line if more can be traded, else clear. |
| `tradeResult` refused | Clerk's note with the reason; keep the line and amount. |
| No answer in 5s | Unlock; "No word from the harbourmaster. Check your purse and hold before you try again." |
| Tab change | Clears selection, order, arm, status. |
| Esc | Pending: ignored ("The clerk is still writing"). Else: armed → disarm; selection → clear; else close. |
| Leaving the dock radius | The server refuses with `too_far`; the client also shows "You've sailed out of the harbour" and closes when not pending. (Anchoring the ship while trading is a follow-up.) |

### 3.3 Refusals and blocked states

| Case | Cell | Slip | Sign |
|---|---|---|---|
| Not sold here | "not sold here" note, no button | — | — |
| Sold out / hold full / purse short | ink-off figure + "sold out" / "hold full" / "too dear" | the reason sentence, no amount controls | "Cannot buy" (disabled) |
| None aboard | ink-soft figure (idle) | "You carry no Sugar…" | "Nothing to sell" |
| Partial limit | normal | "Max 14: limited by the room in your hold" | normal |
| Server `too_far` | | "The harbourmaster refuses: you have drifted out of the harbour…" | re-enabled |
| `price_changed` (moved against you) | | "The price of Tobacco moved from 47 to 45 g against you. Nothing was traded…" | re-enabled |
| `no_stock` / `no_gold` / `no_space` / `not_owned` (races) | | the same plain sentence + ledger refreshed | re-enabled |

### 3.4 Bulk and two-step actions

- All of one good: Max / All chip. The whole hold: "Sell the whole hold…" (ink link) → armed panel lists every line
  and flags any below what you paid → wax "Sign: sell 26 for 2,133 g" **in a different spot** from the link, inert for
  400ms; "Keep my cargo" sits where the link was. One atomic `sellAll` message.
- Refit: "Review the refit · 9,000 g" (brass) → armed panel → wax "Sign: pay 9,000 g" on the *left*, "Keep my ship" on
  the right (under the finger), 400ms guard. Repair is one step.

### 3.5 Keyboard

↑/↓ line · ←/→ buy/sell column · B / S choose a side · + / − amount (Shift ×10) · M max/all · Enter sign · Esc back ·
1 / 2 offices · T close. Tab is trapped in the screen; the ledger is one Tab stop (roving tabindex). The game's other
hotkeys (M map, H help, Tab leaderboard) are ignored while trading.

### 3.6 Layout

Desktop: page left + bill of sale right (340px); 9 rows visible at 1280×720 with the slip open. Landscape: the same
split (280px), Sign sticky; 4 rows. Portrait: slip under the page (≤ 41% height), stepper + chips on one row, no
slider; 4 rows with the slip open.

## 4. Implementation plan

### 4.1 Server and protocol (backward compatible)

| Change | Where | Notes |
|---|---|---|
| **Per-player trade queue** | `server/game/socketHandler.tsx` → new `server/game/trade.ts` | Every trade / sellAll / repair / upgrade for a player runs through one promise chain, so the read-modify-write never interleaves. Redis I/O stays outside `World.step()`. |
| **Pure trade logic** | `server/game/trade.ts` | `applyTrade(state, req)` / `applySellAll(...)` compute the result (or a refusal code) from plain data; the handler loads, applies, saves. Unit-tested. |
| **Spread ~10%** | `shared/market.ts` (new) | `sellPriceOf(buyPrice) = max(1, round(buyPrice × 0.9))`. Stored `currentPrice` stays the port's *selling* price; the port pays `sellPriceOf`. Both sent in `/api/ports/:id/goods` as `buyPrice` / `sellPrice` (+ legacy `currentPrice`). |
| **`ref` + `expectedPrice`** | `shared/protocol.ts` `TradeMessage` | Optional. The server refuses with `price_changed` only if the price moved *against* the player (buy price up, sell price down); in their favour it executes at the better price. |
| **`tradeResult`** | protocol | `{type:"tradeResult", ref?, ok, action, code?, message, good?, quantity?, price?, total?, gold, inventory}`. Sent *in addition to* the legacy `tradeSuccess` / `error` for old clients. |
| **Atomic `sellAll`** | protocol + `trade.ts` | `{type:"sellAll", portId, ref?, lines?:[{goodId, quantity, expectedPrice}]}`; all-or-nothing. |
| **avgPaid** | `redisStorage` inventory rows | `{goodId, quantity, avgPaid}`: weighted average on buy, unchanged on sell, dropped at 0. Old rows read as `avgPaid: undefined`. |
| **Buying reduces stock** (selling adds) | `trade.ts` + `updatePortGoodStock` | |
| **Goods catalogue** | `shared/gameConstants.ts` `GOODS` + `GOOD_GROUPS` | Each good has a `group`; the UI groups by data, so the expansion's goods slot in. |

### 4.2 Client

| File | What |
|---|---|
| `client/src/components/ui/trade/BillOfGoods.tsx` | replaces `TradeMenu.tsx`: counter, page, tabs, filter, keyboard, focus trap, close |
| `trade/LedgerRows.tsx`, `trade/BillOfSale.tsx`, `trade/Shipwright.tsx`, `trade/HoldCrates.tsx` | parts |
| `client/src/lib/trade/logic.ts` (+ tests) | `limitFor`, `defaultQty`, `parseTyped`, `rowSide`, marks, grouping |
| `client/src/lib/trade/useTradeUi.ts` | the state + transitions above |
| `client/src/styles/trade.css` | the `.ptw-counter/.ptw-cell/.ptw-slip/...` classes, imported after pirate.css |
| `useSocket.tsx` | `sendTrade(…, ref, expectedPrice)`, `sendSellAll`, `tradeResult` event; coin sound instead of the hit sound |
| `GameUI.tsx` | suspend M/H/Tab while trading; T toggles |
| `TradingToast.tsx` | remove the duplicate T listener |

### 4.3 Tests

Server: race (two concurrent sells pay once), spread, sellAll atomicity, expectedPrice (against → refuse, in
favour → execute), stock, avgPaid. Client: amount parsing and clamping, defaults, selection transitions. Bot test: a
trade round trip. Playwright in the real game at 1280×720, 375×667, 667×375.

## 5. Decisions (adopted from the reviews) and what's still open

Adopted: separate buy/sell prices with a ~10% spread · Sell defaults to all, Buy to 1 (remembers 10), never Max ·
keep "Sell the whole hold" as one atomic message · `expectedPrice`, refuse only against the player · trends deferred ·
refit two-step, confirm not in the same spot · track avgPaid, profit only on sales · four groups, stable order ·
in-world voice for headings/stamps/refusals, plain words for numbers, buttons and aria.

Still open (not blocking):
1. Sounds: commission/pick CC0 samples (coins, quill, stamp, paper). The build ships with short synthesised cues.
2. Anchor the ship server-side while the trade screen is open, so you can't drift out mid-trade?
3. Goods glyphs: none for now; 19 distinct engraved spot illustrations later if an artist is available.

## 6. Review response

| Finding | Change (or why not) |
|---|---|
| Art B1 phone density | Portrait slip ≤ 41%, stepper+chips one row, no slider, one-line preview, one sticky heading: 4 rows with the slip open (was ~1). |
| Art B2 boxed tags | Bare figures in ruled columns with dotted leaders; the inked cell is the only box; 44px+ hit area. |
| Art M1 digits in Fell SC | Every digit is `.num` (Alegreya), including inside Fell SC buttons; banned in the guide. |
| Art M2 one selection grammar | Inked = selected (cells, tabs, filters, chips, work orders); brass = Sign only; close is a wooden knob. |
| Art M3 sell-all CTA | Demoted to the italic ink link "Sell the whole hold…" with a two-step arm. |
| Art M4 web components | Pills → italic "Show" links / native select; badges → wax seal / ink annotation; kind boxes → "Bill of Sale — *Purchase*"; kbd row → dismissible margin note; alert → clerk's note; bar → bar of crates; cards/progress → pinned chits + plank tally. |
| Art M5 object-ness | Plank counter with nails, torn page with contact shadow, the slip a darker separate sheet with a perforated edge. |
| Art M6 glyphs | Dropped (none rather than 12 shared lucide-style); per-cell coins dropped. |
| Art M7 sticky headings | Opaque, section-scoped (one stuck at a time), rows below them. |
| Art M8 landscape preview hidden | Sticky Sign with a fade and reserved padding; the preview line stays visible. |
| Art M9 `.ptw-tag` clash; leaderboard/game over | Renamed `.ptw-cell`; follow-ups listed in STYLE_GUIDE §14. |
| Art minors | Stamp over the name column, 88% ink with an uneven mask; cursor shows only on keyboard focus; Pirata only for the port name; Alegreya for chips; samples preferred (open item 1); open motion 200ms; pennant flag; `--ptw-font-note`; short phone subtitle. |
| Art guide edits | Banned list + lint rules, density targets, ledger-cell spec, one grammar, material recipes, glyph rule, follow-ups, reference board, motion/sound: all in STYLE_GUIDE. |
| UX B1 amount box | Box rewritten with the clamped value on every input; empty/0 invalid with Sign disabled; Enter checks box == amount. Verified (999→14; empty → "Enter an amount"; 0+Enter trades nothing). |
| UX B2 server race | Per-player trade queue on the server; atomic `sellAll`; the client sends one request at a time (pending lock). |
| UX M1 too few rows | Split on desktop too, 40px rows: 9 rows at 1280×720; 4 landscape; 4 portrait with slip. |
| UX M2 phone limit hidden | Limit line shown on phone (short). |
| UX M3 hidden filters | Native "Show: All (19)" select on narrow screens. |
| UX M4 double-tap confirms | Confirm in a different spot + 400ms guard; armed panel lists lines and below-cost sells; same for refit. |
| UX M5 pending | Cells, chips, tabs, filters, ×, Esc inert while pending; `ref` echo; 5s timeout. |
| UX M6 focus | Focus trap, roving tabindex, focus restored after renders, one persistent live region, `aria-describedby` for reasons. |
| UX M7 B/S toggling | B/S/Space/Enter only choose; pointer re-press clears. |
| UX M8 profit hint | Rows show "paid 14"; profit/loss only in the slip on a sale; red only below cost. |
| UX minors | Hold-full idle note + "Show what's aboard"; line tap falls back to the side with a price; blocked line hides the amount controls; idle vs blocked cells distinguished; pressed chip inked not brass; landscape controls ≥ 44px, no slider; last chip remembered; stable Max chip width. Ship anchoring: open item 2. |
| UX nits | No overlapping slip label; opaque headings; plain aria labels; short phone subtitle. |
| UX missed bugs | Rows 15–19 in §1; fixed in the build. |
