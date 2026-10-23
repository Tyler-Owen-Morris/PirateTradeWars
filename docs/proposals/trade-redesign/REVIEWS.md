# Trade redesign: specialist reviews (2026-10-23)

Two independent reviews of prototype @11c8c4a. Screenshots cited live in
`C:\Users\theow\AppData\Local\Temp\claude\C--Users-theow-Documents-GitHub-Projects-PirateTradeWars\b0db1ddb-f6e8-4e53-ba8e-8a02982d5325\scratchpad\review-art\` and `...\review-ux\`.

## Review 1: art direction (verdict: pass with required changes; "still a web data table dressed in parchment")

**Blockers**
- B1 Phone density: with the slip open at 375x667 ~1 row visible (sticky headings eat it); landscape ~1.5. Rule: >=3 rows on phone with slip open, >=8 on desktop. Phone slip <40% height, stepper+chips one row, no slider on phone (or on demand), purse+hold preview one line, one sticky heading at a time.
- B2 Rows are 38 bordered button boxes repeating Buy/Sell + coin; dashed boxes read as web drop zones. Make prices ledger cells like an 18th-c. "price current": bare figure, no border/word/coin per cell, dotted leaders from name to figures (`Sugar ......... 18 | 16`); hover = ink underline + faint wash; selected = inked box with check (the ONLY boxed thing); can't = ink-off figure + tiny italic note; keep 48px invisible hit area.

**Major**
- M1 Digits in IM Fell English SC are illegible ("1"/"10" render as "I"/"IO"). All digits in .ptw-num (Alegreya lining). Ban digits in Fell SC.
- M2 One selection grammar: selected = inked in, everywhere (tags, filters, chips, tabs, work orders). Brass = the single commit (Sign) button only, one per screen. No brass chips.
- M3 "Sell entire hold" plank is the idle CTA. Demote to tertiary ink link "Sell the whole hold..." with two-step arm.
- M4 Remove web components: rounded-full filter pills -> italic text links with counts, active one inked/underlined; "Cheap here"/"Wanted" badges -> wax-blob seal for Wanted, ink annotation for Cheap here; "Purchase/Sale/Work order" rectangles -> slip heading "Bill of Sale - *Purchase*" in ink-blue/wax-red italic; kbd hint row -> dismissible margin note or "?"; Bootstrap red alert -> wax-red clerk's note with small seal and red rule; plain/barber-pole hold bar -> segmented "bar of crates" (N cells, inked full, hatched preview); Shipwright rounded cards/progress -> pinned work-order chits, hull as plank tally.
- M5 Object-ness: visible plank counter (reuse .ptw-wood from ship selection) 16-24px desktop / 8px phone; torn/deckled page edge (.ptw-torn) + contact shadow; slip = separate darker overlapping sheet with own shadow and perforated edge (not border-top dashed); "Bill of Sale" tab currently overlaps the list. Give regions different values for depth.
- M6 Goods glyphs are lucide-style and 12 glyphs for 19 goods (shared). Either 19 distinct engraved spot illustrations (~28px, hatching, varied weight) or none. Drop per-cell coins.
- M7 Sticky headings stack/bleed over rows: opaque bg, only current group sticky, rows z-index below.
- M8 Landscape: slip preview line hidden under sticky brass button; reserve padding.
- M9 Coherence: `.ptw-tag` already exists in pirate.css (ship-card price label) - rename yours `.ptw-cell`. Leaderboard and game-over use lucide icons and bare parchment over sea: list as required follow-ups.

**Minor/nits**: stamp lands over the figures it reports - put it over the name column, rich ink ~85% with uneven-ink mask; hide keyboard cursor until arrows used; Pirata One only for the port name; less small-caps (Alegreya for tags/chips, Fell SC for column heads/buttons); CC0 sound samples not WebAudio beeps (coin, quill, stamp, paper rustle); spec open/close motion (~200ms slide onto counter); pennant flag not rectangle; rename "hand" font token to --ptw-font-note; port subtitle truncates on phone.

**STYLE_GUIDE edits requested**: "Banned (AI/web tells)" list (rounded-full/radius >3px on paper, filled rectangular badges, kbd on in-world surfaces, unsegmented progress bars, lucide/emoji on parchment/wood, dashed paper edges, blur shadows >12px, >1 coin per row, digits in Fell SC); make it lintable (eslint no lucide under in-world folders, stylelint no raw hex outside pirate.css, grep rounded-full); density/spacing scale (rows 40px desktop/52px phone, 8px grid, min visible rows); ledger-cell spec + rename; one selection grammar; material recipes with values; glyph spec (19 distinct or none); follow-ups for leaderboard/game over; reference board (price current, daybook, bill of lading) with right/wrong shots; open/close motion and sound, samples over synthesis.

## Review 2: UX/interaction (verdict: build it after fixes; core model right)

**Blockers**
- B1 Amount box can disagree with what trades: typed 999 (max 13) box shows 999, button "Buy 13"; empty box -> "Buy 9"; typed 0 + Enter bought 1. Rewrite the box with the clamped value on every input, or mark invalid with reason and disable Sign. Enter never trades a number other than shown.
- B2 Server race in `socketHandler.tsx` handleTrade: inventory read, await, absolute write -> concurrent sells pay twice, buys charge twice deliver once. Serialize trades per player on the server; Sell entire hold as ONE atomic server message; client sends one trade at a time.

**Major**
- M1 Too few rows: 1280x720 shows 4-5 rows (58px rows); landscape phone 3; portrait 3 with slip (slip 256px). Use the split layout (list left, slip right) on desktop too (~9 rows); ~46px rows, one detail line; drop group subtitles on phone; drop slider on portrait phone.
- M2 Phone hides the limit reason ("Max 14 - hold"); show it short.
- M3 Phone filter toolbar scrolls hidden (Wanted/Sold here off-screen). Use a "Show: All" menu or separate rows/no counts.
- M4 Two-step confirms can be double-tapped (armed button appears in the same spot). Move confirm or 400ms tap guard or press-and-hold; armed state lists lines and warns about sells below paid. Same for refit.
- M5 Esc/x/filters work while a trade is pending; lock them (or close keeping the pending trade and toast its result); add `ref` echo.
- M6 Focus: no focus trap; every slip render drops focus to body; 38 tags in Tab order; #status recreated each render. Trap focus, restore focus to chosen tag or Sign after render, list = one Tab stop with arrow keys (roving tabindex), one persistent live region, blocked reasons via aria-describedby.
- M7 Pressing B/S again on a selected line clears it; keyboard B/S should only choose; Esc clears (pointer re-click may toggle).
- M8 Profit hint shows red "-2 ea" right after buying (spread). Show "paid 18" in rows; profit/loss only in the slip on a sale; red only when selling below cost.

**Minor**: hold-full needs a general idle explanation + "In my hold" shortcut; tapping a line tradeable neither way should fall back to the side with a price; blocked line hides amount controls, shows only reason; distinguish "not available now" tags from "blocked for a reason" (15/19 Sell tags dashed); pressed Max chip not brass; landscape filter chips <44px, slider 36px; remember last chip per side per session (buy full hold = 2 taps); consider anchoring the ship server-side while trading instead of drifting out/auto-close.

**Nits**: Bill of Sale tab covers last row; sticky headings overlap first row; plain screen-reader labels ("Clear selection" not "Put the pen down"); Max chip label changes width; phone subtitle truncation.

**Missed current bugs**: local `error` only cleared in loadPortData (stale red alert); global socketError shows unrelated errors in trade; Sell tab lists goods the port doesn't trade at 0 gold; handleBuyMax/handleSellMax don't refresh inventory; the B2 race. "Price Trend" is actually diff from base price.

**Opinions on open questions**: 1 yes, separate buy/sell prices with ~8-12% spread; 2 Sell defaults to all, Buy defaults to 1 then remembers last chip per session, never Max by default; 3 keep Sell entire hold as atomic server message; 4 send expectedPrice, refuse only if moved against player, execute if in favour; 5 defer trends; 6 refit two-step, not same spot; 7 track avgPaid, show profit only on sales; 8 four groups fine, stable order ("Specie" optional); 9 in-world voice for headings/stamps/refusals, plain words for numbers/buttons/aria.
