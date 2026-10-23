# Proposal: the trade screen as the port's bill of goods

Status: proposal, 2026-10-23. No game code has been changed.

- Prototype: `prototype.html` (one self-contained file; open it in a browser). Its top bar switches between desktop,
  phone and phone-landscape frames and between a noon and a night sea, simulates server failures, and shows the
  "before" screenshots.
- Style guide derived from this screen: `docs/design/STYLE_GUIDE.md`.
- Screenshots: `before-*.png` (the live client, captured with Playwright on dev/2026-10-23-batch) and `after-*.jpg`
  (the prototype).
- Progress notes: `NOTES.md`.

## 1. Critique of the current screen

Measured on `client/src/components/ui/TradeMenu.tsx` at 1280×720, 375×667 and 667×375.

| # | Problem | Evidence | Fix in this design |
|---|---|---|---|
| 1 | **Buy Max is off-screen.** The purchase panel is appended under the 8-row list, and the whole dialog scrolls (`max-h-screen overflow-y-auto`). | Buy Max top edge at y = 912 in a 720 px window; y = 980 on a 375×667 phone; in landscape neither the port name, the purse nor any button is visible (`before-mobile-land-2-selected.png`). | Grid layout with a fixed header, one scrolling list (`minmax(0,1fr)`), and a docked slip that holds every action. The primary button is always on screen, in all three frames. |
| 2 | **Selection leaks across Buy and Sell.** A single `selectedGoodId` is shared by both tabs and never reset on tab change. | Select Cotton on Buy, switch to Sell: "Sale Details" quotes Cotton at 38 g, a good not in the hold, while the one good owned shows "Select" (`before-desktop-3-sell-after-switch.png`). | No Buy/Sell mode. The selection is one value, `{goodId, side}`, set by pressing a Buy or Sell tag on a row. Changing tab, row or side replaces it; Esc clears it. |
| 3 | **Generic web-app styling.** Slate `bg-slate-800` dialog, orange header bar, shadcn tabs, lucide icons, "Select" buttons. Nothing in-world. | All before shots. | The port's bill of goods: ruled parchment with a red margin, in a wooden counter frame with brass fittings; price tags as the row actions; a bill-of-sale slip; ink stamps; a wax notice for wanted goods. |
| 4 | **Rows have one generic action, "Select".** The prices are not buttons, and the Buy and Sell prices are never visible together. | | Each row carries two price tags, `[Buy 18]` `[Sell 16]`. Pressing one is the choice. |
| 5 | **Trend colours are backwards for a buyer.** "Price Trend" = (current − base) / base; a 47 % *drop* is painted red on the Buy tab. | `before-desktop-2-selected.png` (Sugar ↓47 % red). | Colour judges the deal from the player's side: a low buy price is "Cheap here" (green ink), a high sell price is "Pays well". Always a word, never colour alone. |
| 6 | **Max fires immediately.** "Buy Max" and "Sell Max" send the trade on press, without showing how many or the total. | Code: `handleBuyMax` calls `sendTrade` directly. | Max is a quantity chip. It sets the amount; the brass button shows "Buy 14 Sugar · 252 g" and signs it. |
| 7 | **Selection cleared before the server answers**, and the errors land in a generic red `Alert` at the top of a scrolled dialog, often off-screen. | `handleTrade` resets state right after `sendTrade`; `socketError` is rendered above the purse. | Pending state ("Signing the ledger…") until `tradeSuccess` or `error`; the result line and errors appear in the slip, next to the button; the line stays chosen while more can be traded. |
| 8 | **No reason when you can't.** The quantity input accepts anything and errors after submit ("Not enough cargo space…"). | | The amount is clamped to the real maximum, with the limit named: "Max 14: limited by the room left in your hold". Blocked lines say why in the slip (hold full, purse short, sold out, not sold here, none aboard). |
| 9 | **Doesn't scale to 19 goods.** A flat list with no grouping; on a phone the four columns squeeze to 1/4 each. | `before-mobile-1-buy.png`. | Groups (Staples / Colonial / Luxuries / Northern) with sticky headings; filters (All, In my hold, Wanted, Sold here); two-column phone rows (name + meta, then the two tags). |
| 10 | **The hold is a number, not a picture.** There's no preview of what the trade does to gold or cargo. | | Hold meter with a hatched preview segment, and a "Purse 1,240 → 988 · Hold 26 → 40/40" line in the slip. |
| 11 | **Upgrade/repair hide in a third tab, "The Ship"**, styled as marketing cards with gradient strips; repair is a blue button. | `before-desktop-4-ship.png`. | A "Shipwright" bookmark with two work orders (repair, refit) confirmed through the same bill-of-sale slip. |
| 12 | **Accessibility gaps.** The close × is 16 px, tabs are 32 px tall, there's no `aria-pressed` on Select, and focus rings are the default. | | 44 px minimum targets, `aria-pressed` tags with full labels, an ink-haloed focus ring, `role=status` / `role=alert` results. |
| 13 | **Wrong sound, and a duplicate toast.** `tradeSuccess` plays `playPlayerHit()` (the hit sound). `TradingToast.ToastContainer` also listens to T and shows a second "Trading at …" toast. | `useSocket.tsx`, `TradingToast.tsx`. | Coin sounds (two falling for buy, three rising for sell, a thud on refusal). Retire `ToastContainer`'s T listener. |
| 14 | **Debug noise.** `console.log` on every inventory change and tab switch; the fallback goods use `Math.random()` prices when `/api/ports/:id/goods` fails. | `TradeMenu.tsx`. | Remove both. Never show invented prices: show "The harbourmaster's books are closed" with a Retry. |
| 15 | **Server: buying never reduces stock** (`handleTrade` checks `portGood.stock` but never writes it back), and buy price = sell price. | `server/game/socketHandler.tsx` `handleTrade`. | Out of scope for the UI, but the design assumes stock goes down and shows "sold out". See section 6. |

## 2. The design in one paragraph

You're the captain at the harbourmaster's counter. On the wood lies the port's **bill of goods**: one ruled page,
every good on its own line, grouped as the clerk would group them. Each line shows what the port **sells** it for and
what it **pays**, as two price tags, plus what you have aboard and what you paid. Press a tag: the line is marked
(wax ribbon, pointing hand, the tag inked in), and a **bill of sale** at the foot of the page fills itself in with
Purchase or Sale, the good, the amount, and what it does to your purse and hold. Adjust the amount with −/+, the chips
(1, 10, Max / Fill hold / All) or the slider. Press the brass plate that reads exactly what will happen
("Buy 14 Sugar · 252 g"). The clerk stamps the line **Bought** or **Sold**, coins clink, the purse rolls to the new sum.

## 3. Interaction spec

### 3.1 Model: one ledger, two actions per line (no Buy/Sell mode)

**Why no mode switch.** The mode switch is the root of complaint 2: state set in one mode silently applies in the
other. It also hides half the information a trader needs. Whether to buy Furs here depends on what they'd pay
elsewhere, and whether to sell depends on what you paid. A real bill of goods lists both. With two tags per line, the
side is chosen *by the same press* that chooses the good, so they can't disagree.

Cost of the choice: rows are wider. They fit on a 375 px phone as `[glyph][name + meta][Buy][Sell]`, with tags
68 × 48. The "In your hold" column folds into the meta line ("6 aboard · paid 70 · +58 ea").

### 3.2 State

```ts
type Side = "buy" | "sell";
interface TradeUi {
  tab: "goods" | "yard";
  filter: "all" | "hold" | "wanted" | "here";
  sel: { goodId: number; side: Side } | null;   // THE selection, one value
  qty: number;                                   // always clamped to [min(1,max), max]
  order: "repair" | "upgrade" | null;            // Shipwright tab selection
  pending: null | { kind: "trade" | "order"; sentAt: number; goodId?: number; side?: Side; qty?: number; price?: number };
  status: null | { kind: "ok" | "err"; text: string; side?: Side };
  sellAllArmed: boolean;
  cursor: number;                                // keyboard row cursor (index into visible rows)
}
```

Derived, never stored: `max(good, side)` and its reason (`limitFor` in section 5); `usedHold`; the preview of the
purse and hold.

### 3.3 Transitions

| Event | Effect |
|---|---|
| Press Buy/Sell tag | If it's the already-selected `{good, side}`: clear. Otherwise `sel = {good, side}`, `qty = default(side)`, clear `status`, scroll the row into view. |
| Tap the row body (name, meta) | Same as pressing **Sell** if you hold some, otherwise **Buy**. |
| Default quantity | **Buy: 1. Sell: all you carry.** (Open question Q2.) Either way, the brass button states the number. |
| −/+, chips, slider, typed digits | `qty = clamp(v)`; chips show pressed when equal; the slip preview updates. |
| Press the brass button / Enter | Only if `qty ≥ 1` and `qty ≤ max` and not pending. Send the trade; `pending` is set; the button reads "Signing the ledger…" (aria-busy). |
| `tradeSuccess` | Clear pending; stamp the row; play coins; the purse rolls; status line "Entered in the ledger: bought 14 Sugar for 252 g."; if more can be traded keep `sel` and reset `qty` to the default, else clear `sel`. |
| `error` while pending | Clear pending; show the wax slip with the server reason in plain words (table 3.5); keep `sel` and `qty` so the player can fix and retry. |
| No answer within 5 s | Clear pending; status "No word from the harbourmaster. Check your purse before trying again." (the server may have applied it). |
| Change tab | Clear `sel`, `order`, `status`, `sellAllArmed`, `cursor`. |
| Change filter | Keep `sel` (still valid; if the row is filtered out the slip still names it). Reset `cursor`. |
| Esc | Clear `sel`/`order` if set; else close the screen. |
| Leave port radius (client already tracks `isNearPort`) | Lock the slip: "You've sailed out of the harbour." Close automatically after 2 s, unless pending. |
| Prices refresh (server `updatePrices`, every few minutes) | Re-render; if the selected price changed, flash the unit price and show "Price changed: 18 → 20 g". |

### 3.4 Feedback

- **Stamp** on the row: "Bought" in ink-blue / "Sold" in wax-red, a double-ruled box tilted −9°, scaling 1.9 → 1
  (230 ms), held, then faded by 1.9 s. Reduced motion: no scale.
- **Sound:** buy = two coins with falling pitch; sell = three with rising pitch; refusal = a low thud; choosing a
  line = a quiet quill tick. Through `useAudio` and the SFX volume.
- **Purse** rolls to the new value (450 ms). The **hold meter** fills; while choosing, the pending amount shows as a
  hatched segment (blue hatch when adding, paper hatch when removing).
- The **HUD** gold and cargo update from the next snapshot, as today.

### 3.5 Errors and blocked states

Prevent first, explain second. Each case below has the same shape: the tag style, the reason sentence in the slip
(`.limit.block`), and a disabled brass plate carrying a short label.

| Case | Row tag | Slip says | Brass plate |
|---|---|---|---|
| Not sold here | no Buy tag; "not sold here" in the clerk's hand | (Sell still works) | n/a |
| Sold out | dashed Buy tag, price visible | "Sold out. The warehouse has no Hides today." | "Cannot buy" |
| Hold full | dashed Buy tags everywhere | "Your hold is full (40/40). Sell something first." | "Cannot buy" |
| Purse short | dashed Buy tag on that line | "Your purse is short: one costs 430 g and you have 120 g." | "Cannot buy" |
| None aboard | dashed Sell tag | "You carry no Sugar. Buy some first, or pick another line." | "Nothing to sell" |
| Partial limit | normal | "Max 14: limited by the room left in your hold (14)." / "…by your purse" / "…by the port's stock" | normal |
| Server "Too far from port" | n/a | wax slip: "The harbourmaster refuses: you have drifted out of the harbour. Sail back inside the ring at the pier to trade." | re-enabled |
| Server "Not enough stock / gold / cargo space" (a race) | n/a | wax slip with the same plain sentence as the client check, plus "The ledger has been brought up to date." (refetch goods) | re-enabled |
| Price moved (needs Q4) | n/a | "The price of Tobacco moved from 47 to 45 g while you haggled. Nothing was traded; check the new total and sign again." | re-enabled |

### 3.6 Bulk actions

- **Any amount:** the stepper, the chips, the slider and typed digits, all clamped.
- **All of one good:** the "Max N" / "Fill hold N" chip (Buy) or the "All N" chip (Sell). Sell defaults to all.
- **The entire hold:** "Sell entire hold · 26 for 2,133 g" (wood plank, shown when nothing is selected). The first
  press arms it, and it turns into a wax "Sign: sell all 26 for 2,133 g" plus "Keep my cargo". It disarms after 6 s.
  On the wire it's N `trade` messages, or a new message (Q3).

### 3.7 Keyboard (desktop)

| Key | Action |
|---|---|
| ↑ / ↓ | Move the line cursor. If a line is chosen, move the choice and keep the side. |
| B / S | Choose Buy / Sell on the cursor line (or switch the side of the chosen line). |
| ← / → (Shift: ×10) | Amount −/+ 1 (10). |
| M | Max / All. |
| Enter | Sign (from anywhere except the slip's own buttons and the close button). |
| Esc | Clear the choice, then close. |
| 1 / 2 | Goods / Shipwright. |
| T | Close (T opens it, as today). |

Ship controls are already neutral while trading (`Player.tsx` checks `isTrading`). The GameUI hotkeys (H, M, Tab)
must be ignored while `isTrading`, or M opens the world map over the counter.

### 3.8 Mobile and touch

- **Portrait (≤ 640 px wide):** full-bleed sheet. Header: port name, ×, then purse and hold on one line. One
  sideways-scrolling toolbar row (tabs, then filters). The list. The slip, whose bottom-most element is the full-width
  52 px brass plate (thumb zone); Cancel folds into the × in the slip's header.
- **Landscape / short (≤ 520 px tall, ≥ 560 px wide):** two columns. The list on the left; the slip as a right column
  (272 px) with its own scroll and the brass plate sticky at its bottom. The header is one line.
- Tags 68 × 48; every control ≥ 44 px; the filter chips get a 44 px hit area.

### 3.9 Shipwright (repair and refit)

The same page, second bookmark. Two work orders:

- **Caulk & patch the hull:** hull meter, the damage taken, the cost (`SHIP_STATS[type].repairCost`), an "Order
  repair" tag. "Sound hull" (disabled) when undamaged.
- **Refit as a {next}:** a stat comparison table (hold, hull, guns a side, speed, repair cost), the cost, an "Order
  refit" tag. Cargo stays aboard (verified: `World.setShipType` keeps `cargoUsed`).

Choosing an order fills the same slip ("Work order · Repair the hull · Purse 988 → 688 · Hull 118 → 150"), and the
brass plate signs it. Short of gold, the plate reads "Need 7,760 g more". Upgrade is not undoable, so (Q6) consider
the same two-step arm as Sell entire hold.

## 4. Visual direction (summary)

- **Object:** a parchment bill of goods (noise texture, burnt vignette, ink column rules, a red double margin line)
  inside a 10 px dark-wood counter frame with brass rivets. It sits over a radial scrim, so the sea stays visible on
  desktop.
- **Type:** Pirata One for place and goods names; IM Fell English SC for labels, tags and buttons; IM Fell English
  italic for the clerk's notes ("not sold here"); Alegreya for sentences and all figures (tabular lining).
- **States:** outlined tag = can press; inked tag with a ✓ = chosen; dashed = can't (and says why); brass plate =
  sign; wood plank = secondary; wax = destructive or error; dotted ink link = cancel.
- **Marks:** a red wax "Wanted" notice, a green-ink "Cheap here", an ink "Pays well", profit or loss in green or red
  ink with a sign.
- Full tokens, contrast ratios and component rules: `docs/design/STYLE_GUIDE.md`.

## 5. Component breakdown and implementation plan

Client only, unless marked **server**. Build on the theme layer (`client/src/components/ui/pirate/`,
`client/src/styles/pirate.css`) once it's merged.

| File | What |
|---|---|
| `client/src/components/ui/trade/BillOfGoods.tsx` (new; replaces `TradeMenu.tsx`) | The overlay: frame, grid layout, tabs, filters, keyboard map, focus management, close. Owns the `useTradeUi` state. Mount stays `{isTrading && <BillOfGoods/>}` in `App.tsx`. |
| `client/src/components/ui/trade/LedgerRow.tsx` | One good: glyph, name, marks, meta, hold column, `PriceTag` × 2. Memoised by `(good, portGood, held, paid, selSide)`. |
| `client/src/components/ui/trade/PriceTag.tsx` | `<button aria-pressed>` with the outline, inked and dashed states. |
| `client/src/components/ui/trade/BillOfSale.tsx` | The docked slip: idle hint and sell-all; the active deal; the work-order variant; the status / alert line. |
| `client/src/components/ui/trade/QuantityControl.tsx` | Stepper, chips and slider bound to one clamped number. Reusable (e.g. a future bank or crew screen). |
| `client/src/components/ui/trade/HoldMeter.tsx` | Hold gauge with the preview segment. |
| `client/src/components/ui/trade/ShipwrightOrders.tsx` | Repair and refit cards. |
| `client/src/components/ui/trade/Stamp.tsx` | The stamp animation, keyed by `tradeSuccess` timestamp. |
| `client/src/lib/trade/limits.ts` (+ `__tests__/limits.test.ts`) | Pure functions: `limitFor(good, side, {gold, used, cap, held})` → `{max, reason, blocked}`; `dealMarks(good)`; `previewAfter(...)`. Unit-tested: every row of table 3.5. |
| `client/src/lib/trade/useTradeUi.ts` | zustand slice or reducer for section 3.2, with the transitions in 3.3 (a reducer makes them testable). |
| `client/src/lib/trade/goods.ts` | Groups, glyph ids and display order for the 19 goods (keyed by good id; extends `GOODS` in `shared/gameConstants.ts`). |
| `client/src/components/ui/pirate/goodGlyphs.tsx` | Inline SVG sprite for the 12 container glyphs, the manicule and the doubloon. |
| `client/src/lib/stores/useSocket.tsx` | Route `tradeSuccess` / `error` / `upgradeSuccess` / `repairSuccess` to the trade UI as events (`tradeResult` with `{ok, action, good, quantity, price, total, message}`), instead of only setting `socketError`. Replace `playPlayerHit()` with `playCoins(action)`. |
| `client/src/lib/stores/useAudio.tsx` | `playCoins("buy" | "sell")`, `playThud()`, `playQuill()`. Either synthesised with WebAudio (as in the prototype) or three small samples. |
| `client/src/components/ui/GameUI.tsx` | Ignore H, M and Tab while `isTrading`; T toggles the screen. Restyle the "press T to trade" prompt as a small `HudPanel` plaque (no `animate-pulse`). |
| `client/src/components/ui/TradingToast.tsx` | Remove `ToastContainer`'s T listener (duplicate toast). |
| `client/src/styles/pirate.css` | The token and class additions listed in STYLE_GUIDE §13. |
| `client/index.html` | Add `IM+Fell+English:ital@0;1` to the Google Fonts link. |

**Data the screen needs, and where it comes from today:**

| Need | Today | Change |
|---|---|---|
| Port name, nation | `gameState.ports` (W4: `nation`, `region`) | none; show the flag from `nationColor`. |
| Price per good, stock | `GET /api/ports/:id/goods` → `{goodId, currentPrice, stock}` | **server:** split into `buyPrice` (port sells) and `sellPrice` (port pays), with `buyPrice: null` for goods not sold here (Q1). Add `wanted: boolean`. |
| "Usual" price for hints | `GOODS[].basePrice` (shared) | none; hints are computed client-side. |
| Price trend | not stored | optional, **server:** keep `prevPrice` per port good on `updatePrices` (Q5). |
| Player's hold and qty per good | `gameState.inventory` (`{goodId, quantity}`), `player.cargoUsed/cargoCapacity` | none. |
| What the player paid | not stored | **server:** store `avgPaid` per inventory row (weighted average updated on buy; unchanged on sell; reset at 0). Include it in `tradeSuccess.inventory` and `/api/players/:id/inventory`. Small change to `redisStorage.updatePlayerInventory`. Without it, the "paid" and profit hints are hidden. |
| Trade result | `tradeSuccess` / generic `error` | **protocol:** add an optional `ref` (client nonce) to `TradeMessage`, echoed in `tradeSuccess` and in a new `tradeError {ref, code, message}`, so the screen can tell its own failures from unrelated errors. `code` ∈ `too_far, no_stock, no_gold, no_space, not_sold, not_owned, price_changed`. |
| Price-changed guard | none | **protocol (optional):** `expectedPrice` on `TradeMessage`; the server rejects with `price_changed` if it differs (Q4). |
| Sell entire hold | n/a | Either loop `trade` sells client-side (simple, N messages, partial failure possible) or a new `sellAll {portId, ref}` message (atomic; Q3). |
| Stock decrement (bug) | buy never writes stock back | **server:** `updatePortGoodStock(port.id, goodId, stock − qty)` on buy (and + qty on sell, if ports should absorb what you sell). |

**Build order** (each step is shippable on its own):

1. `lib/trade/limits.ts` and the reducer, with tests. Fix the server stock bug.
2. `BillOfGoods` with the existing data (one price shown in both tags until the server split; avg-paid hidden):
   fixes complaints 1 to 4 at once.
3. The `tradeResult` routing, sounds and stamp; GameUI hotkey gating; remove the duplicate toast.
4. Shipwright tab.
5. Server: buy/sell prices, `avgPaid`, `wanted`, `ref` / `tradeError`; then hints and profit.
6. The 19-good catalogue (separate card; the screen already groups and filters).

**Tests:** vitest for `limits.ts` (every blocked and limited case) and for the reducer (tab change clears the
selection; same tag twice clears; Esc order; success keeps or clears the selection). A Playwright smoke test in
`scripts/` or `docs/world/qa/` style: open at a port at 1280×720, 375×667 and 667×375, and assert the brass button's
bounding box is inside the viewport after choosing a row and pressing Max. `npm run check`: no new tsc errors.

## 6. Open questions for the owner

1. **Separate buy and sell prices?** Today one `currentPrice` is used both ways, so a round trip in one port is free
   and both tags would show the same number. The design assumes a spread (the port sells ~10 % above what it pays).
   Keep one price, or add the spread with the new market model?
2. **Default amount.** Proposed: Buy defaults to 1, Sell defaults to *all you carry*. Or default both to 1, or both
   to max?
3. **"Sell entire hold":** keep it? If yes, client-side loop (simple) or an atomic server message?
4. **Price-moved guard:** should a trade fail if the price changed since the screen was drawn (`expectedPrice`), or
   just execute at the new price?
5. **Price trend:** worth storing the previous price per port good to show ▲/▼ since the last market move? The
   "Cheap here" and "Pays well" hints work without it (they compare to the base price).
6. **Refit confirm:** a 9,000 g refit is one press after choosing the order. Add a two-step arm like Sell entire hold?
7. **Track what the player paid (`avgPaid`)?** It powers "paid 70 · +58 ea" and the profit preview. It needs a small
   Redis change.
8. **Goods groups and names:** Staples (Fish, Wood, Cotton, Hides), Colonial (Sugar, Rum, Tobacco, Cacao, Coffee),
   Luxuries (Spices, Silk, Tea, Porcelain, Wine, Silver, Gold), Northern (Furs, Whale Oil, Naval Stores). OK, or should
   Silver and Gold get their own "Specie" group?
9. **Voice:** the copy is lightly in-world ("Sign", "the harbourmaster refuses", "Entered in the ledger"). More pirate,
   or plainer?
