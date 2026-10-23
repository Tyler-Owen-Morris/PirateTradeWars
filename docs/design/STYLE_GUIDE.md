# Pirate Trade Wars: UI style guide

Status: adopted 2026-10-23 (revision 2, after the art and UX reviews in
`docs/proposals/trade-redesign/REVIEWS.md`). It was worked backwards from the trade screen; the reference
implementations are `docs/proposals/trade-redesign/prototype.html` and the in-game `client/src/components/ui/trade/`.

**Relation to the theme layer** (`client/src/styles/pirate.css`, tokens `--ptw-*`, classes `ptw-*`;
`client/src/components/ui/pirate/*`): this guide **adopts** its palette, fonts, materials and focus ring, **extends** it
with ledger, selection and trade tokens/classes, and **overrides** it in the places marked *Override*. §15 lists every
change. Where this guide is silent, the theme-layer README rules.

---

## 1. Principles

1. **Grounded in the world.** Every surface is an object a captain would really hold: the harbourmaster's bill of
   goods on a plank counter, a bill of sale torn from a book, work orders pinned up, a sea chart, a ship's log. Draw it
   as that object (ruled paper, ink, wax, wood, brass) and name it after the object. Use in-world voice for headings,
   stamps and refusals ("the harbourmaster refuses"); use plain words for numbers, buttons and screen-reader labels.
2. **Obvious state, one grammar.** *Inked = selected*, everywhere: a solid ink fill or a solid ink rule marks the
   chosen cell, tab, filter, chip or work order. *Brass = the one commit button* (Sign) per screen; nothing else is
   brass. *Dotted = can't* (plus the reason in words).
3. **Nothing hides.** Fixed header, one scrolling list, a docked bill of sale whose Sign button is always on screen.
4. **Nothing carries over by surprise.** One selection value; changing tab, line or side replaces it.
5. **What you see is what is sent.** The amount box, the Sign label and the request always carry the same number.
6. **The sea stays the hero.** On desktop the counter sits on the scene with the ocean visible around it.

## 2. Banned (AI/web tells)

These are not allowed on in-world surfaces (anything parchment, wood or wax):

- `rounded-full` / pills, or any border-radius > 3px on paper or wood (round *objects* like a knob or a seal are fine).
- Filled rectangular badges ("CHEAP HERE" in a box, "PURCHASE" in a blue rectangle). Use ink annotations or a wax seal.
- `<kbd>` keycaps in-world (put keyboard help in a dismissible margin note).
- Unsegmented progress bars or barber-pole stripes (use a bar of crates, a plank tally).
- lucide icons or emoji on parchment or wood. Draw the few marks needed as ink SVG.
- Dashed borders as paper edges or "drop zones" (use torn edges, perforations, dotted *ink* for "can't").
- Blur shadows > 12px; glows; glassmorphism; `backdrop-filter`.
- More than one coin glyph per row; a coin glyph inside every price cell.
- Digits in IM Fell English SC (its "1" reads as "I"). All digits are Alegreya `.ptw-num`.
- Pirata One anywhere but the port / screen name.
- Bootstrap-style red alert boxes. Refusals are the clerk's note: wax rule + small seal.
- Brass on anything except the one Sign button.

### Lint rules (to add with the trade screen)

| Rule | Tool | Scope |
|---|---|---|
| no `lucide-react` import | eslint `no-restricted-imports` | `client/src/components/ui/trade/**`, `ui/pirate/**`, and every in-world screen as it is restyled |
| no raw hex colours | stylelint `color-no-hex` (or a grep in `npm run check:ui`) | everything except `client/src/styles/pirate.css` |
| no `rounded-full`, `rounded-(md\|lg\|xl\|2xl)` | grep in `npm run check:ui` | the same in-world folders |
| no `font-label` / `ptw-font-label` on an element whose text contains a digit | review checklist (not mechanical) | |

## 3. Materials vocabulary and recipes

| Surface | Object | Class / component | Recipe |
|---|---|---|---|
| Trade overlay | plank **counter** | `.ptw-counter` | wood grain (`--ptw-tex-grain`) over a 3-stop wood gradient, plank seams every 120px, iron nails at the corners; padding 18px desktop / 8px phone / 5px landscape; shadow `0 10px 12px rgb(0 0 0/.55)` |
| The list | **bill of goods** page | `.ptw-ledger-page` | parchment gradient + noise; torn edge on all four sides (CSS mask of the theme layer's torn tiles); contact shadow via `filter: drop-shadow(0 3px 3px rgb(0 0 0/.55))` on a wrapper (the mask clips box-shadow); red double margin rule at 31–36px |
| The action area | **bill of sale**, torn from a book | `.ptw-slip` | its own sheet, darker (`--ptw-slip` #dcc597), overlapping the page by 14px; perforated edge (left on desktop and landscape, top on phone) via a radial-gradient mask; drop shadow ≤ 4px blur |
| Shipwright | **work orders** pinned up | `.ptw-order` | parchment-lo chit, square corners, ±0.6° rotation, iron pin, shadow `0 2px 3px` |
| Hold gauge | **bar of crates** | `HoldCrates` | one cell per unit (cap ≤ 50; above that one cell per 2 units); full cells burnt-wood, the pending purchase hatched ink-blue, the pending sale hatched burn |
| Hull | **plank tally** | `HullPlanks` | 10 planks; damaged planks drawn broken (ink-off outline, cracked clip-path) |
| Refusal | **clerk's note** | `.ptw-note--refusal` | 3px wax-red rule on the left, faint wax wash, small wax-seal glyph, text in bad-ink |
| Success | **ink stamp** | `.ptw-stamp--buy/--sell` | double-ruled box, Fell SC, −8° tilt, 88% ink, uneven-ink mask (noise SVG); placed over the *name* column |
| Wanted | **wax blob seal** + italic "wanted" | `.ptw-mark--wanted` | 15px irregular wax blob SVG beside the word |
| Cheap here / pays well | **ink annotation** | `.ptw-mark--cheap/--dear` | italic note face; "cheap here" green ink with a wavy underline |
| Close | turned **wooden knob** | `.ptw-knob` | 44px round, wood gradient, cream ×; *not* brass |
| Sign | **brass plate** | `.ptw-btn--brass` (theme layer) | the only brass on the screen |
| HUD | instrument plates | `HudPanel` (theme layer) | never parchment over the sea |

## 4. Colour tokens

Existing theme-layer tokens plus **new** ones:

| Token | Value | Role |
|---|---|---|
| `--ptw-ink` | #2a1a0c | text, rules, **the selected fill** |
| `--ptw-ink-soft` | #5c3e1e | secondary text, labels, idle figures |
| `--ptw-ink-blue` **new** | #1f3a5a | purchase: "— Purchase", "Bought" stamp, hold-preview hatch |
| `--ptw-ink-off` **new** | #7d6748 | "can't" figures and disabled text (4.0:1) |
| `--ptw-parchment` / `-hi` / `-lo` | #ecdcb4 / #f7ecd2 / #d6bc88 | paper |
| `--ptw-slip` **new** | #dcc597 | bill of sale sheet (darker than the page, for depth) |
| `--ptw-sel-wash` **new** | #e8d29c | background of the selected row |
| `--ptw-hover-wash` **new** | rgb(122 74 26 / .08) | hover |
| `--ptw-ledger-rule` **new** | rgb(42 26 12 / .2) | row and column rules |
| `--ptw-ledger-margin` **new** | rgb(142 26 20 / .45) | red margin rule |
| `--ptw-leader` **new** | rgb(42 26 12 / .4) | dotted leaders |
| `--ptw-wood*`, `--ptw-iron` | theme | counter, knob, nails |
| `--ptw-brass*` | theme | Sign only |
| `--ptw-wax*`, `--ptw-wax-text` **new** #fbe9d6 | | sale, wanted, refusal, destructive confirm |
| `--ptw-good-ink` / `--ptw-bad-ink` | #265c22 / #8e1a14 | profit / loss (with a sign), "cheap here" |
| `--ptw-focus` | #ffe08a | focus ring, always inside an ink halo |

Colour judges the deal from the player's side: a low buy price is "cheap here", a high sell price "pays well".
Red appears for a sale only when it is **below what you paid**. Meaning is never colour alone.

### Contrast (WCAG 2.x, measured)

| Foreground | Background | Ratio |
|---|---|---|
| ink | parchment / slip #dcc597 / sel-wash #e8d29c | 12.4 / 10.0 / 11.3 |
| ink-soft | parchment / slip / sel-wash | 7.1 / 5.8 / 6.5 |
| ink-blue | parchment / slip | 8.5 / 6.9 |
| good-ink / bad-ink | parchment / slip | 5.9, 6.7 / 4.7, 5.4 |
| ink-off (can't, disabled) | parchment / slip | 4.0 / 3.2 (disabled text: exempt, kept ≥ 3) |
| parchment-hi | ink (selected cell) | 14.3 |
| ink | brass / brass-hi | 7.0 / 12.9 |
| wax-text | wax | 7.7 |
| cream | wood | 12.0 |
| wood-dark counter vs noon sky / bright sea | | 16.1 / 9.3 |
| parchment vs noon sky / bright sea | | **1.2 / 1.4**: never put parchment directly on the scene |
| focus #ffe08a vs parchment | | 1.1: the ring always sits inside a 2px ink halo |

Scrim behind any modal: `radial-gradient(ellipse at center, rgb(7 18 27/.35), rgb(7 18 27/.72))`.

## 5. Typography

| Role | Family | Use | Size desktop / phone |
|---|---|---|---|
| Display | Pirata One | **the port name only** (and equivalent screen titles) | 32 / 26 / 22 landscape |
| Label | IM Fell English SC | column heads, group heads, tabs, button *words*, stamp | 13–18 |
| Note **(renamed `--ptw-font-note`)** | IM Fell English italic | the clerk's annotations: subtitle, "not sold here", "cheap here", margin notes | 12–15 |
| Body | Alegreya | goods names (600), sentences, filter links (italic), reasons | 15–18 |
| Numerals | Alegreya `.ptw-num` (lining, tabular) | **every digit**, including inside Fell SC buttons (wrap the number in `.ptw-num`) | figures 19 / 18 bold; purse 22 / 19 |

## 6. Ledger cells (the price current)

The list reads like an 18th-century *price current*: `Sugar ........... 18 | 16`.

- Row: name (Alegreya 600) + marks + a dotted **leader** filling to the figures; then (desktop) "Aboard" (`5 paid 14`),
  then the **You buy** and **You sell** columns, separated by thin column rules. No border, no word, no coin per cell.
- **Cell** (`.ptw-cell`, a `<button>`; *renamed from my rev-1 `.ptw-tag`, which already exists in pirate.css as the ship
  card price label*): bare right-aligned figure. Hover: ink underline + faint wash. **Selected: inked box (ink fill,
  parchment text, ✓)**, the only boxed thing in the ledger. Hit area ≥ 44px (row height or a pseudo-element).
- States: *available* (ink, bold) · *idle* (ink-soft, regular: e.g. Sell when none aboard; pressing explains) ·
  *blocked* (ink-off figure + a two-word italic note in bad-ink: "hold full", "too dear", "sold out") · *not sold here*
  (italic note instead of a figure, not a button) · *low stock* note ("6 left").
- Phone: the leader and inline marks give way to a one-line detail under the name ("5 aboard · paid 14 · wanted").
- Row height: **40px desktop, 52px phone portrait, 44px landscape**.
- Group headings (Staples / Colonial / Luxuries / Northern; data-driven from the goods catalogue) are opaque, sticky
  only within their own section (so exactly one is stuck at a time), Fell SC 15–17px; the subtitle is dropped on phones.

## 7. Selection grammar and buttons

| Thing | Default | Hover | Selected / pressed (= **inked**) | Can't |
|---|---|---|---|---|
| Ledger cell | bare figure | underline + wash | ink fill, ✓, double ring | dotted-off figure + reason note |
| Tab (bookmark) | parchment-lo | — | ink fill | — |
| Filter ("Show") | italic link, dotted underline | — | ink, bold, solid 2px underline | — |
| Quantity chip | paper face, ink-soft rule, 2px bottom edge | lighter | ink fill (also while hovered) | dotted, ink-off |
| Work order | pinned chit | — | sel-wash + 2px ink outline; its "Order" button inked with ✓ | dotted button |
| **Sign** | **brass plate**, label states the deal ("Buy 14 Sugar · 252 g") | brighter | moves down 3px | dotted outline on bare paper + the reason in text |
| Sign while waiting | desaturated brass, quill, "Signing the ledger…" (`aria-busy`) | | | |
| Destructive confirm | wax ("Sign: sell 26 for 2,133 g") | | moves down | disabled for 400ms after arming |
| Tertiary | italic ink link ("Sell the whole hold…", "Keep my cargo") | wash | | ink-off |
| Close | wooden knob | | moves down | disabled while a trade is pending |

**Focus** (all): `0 0 0 2px ink, 0 0 0 5px focus, 0 0 0 7px ink`, `:focus-visible` only.

**Two-step confirms** (sell the whole hold, refit): the first press *arms*; the armed panel lists what will happen
(every line, and any sold below what was paid); the real confirm is a wax button **in a different place** from the
button just pressed (the spot under the finger becomes the harmless "Keep …"), and it ignores taps for **400ms**.

## 8. Quantity entry

`QuantityControl` = stepper `[−][box][+]` (44px), chips `1 · 10 · Max N` (Sell: `All N`), and on desktop only a
slider. Rules:
- The box is rewritten with the clamped value on every input: typing 999 with max 14 shows **14** at once and flashes
  the limit line. Empty or 0 marks the box invalid ("Enter an amount") and disables Sign. Enter never trades a number
  other than the one shown.
- Defaults: **Sell = all aboard. Buy = 1**, or 10 if the player last chose the 10 chip this session. Never Max by
  default.
- The limit line names the cap: "Max 14: limited by the room in your hold / your purse / the port's stock".
- A blocked line shows no amount controls at all, only the reason and a disabled Sign.

## 9. Motion and sound

| Event | Motion (≤ 450ms; transform/opacity only) | Sound (CC0 samples, SFX volume) |
|---|---|---|
| Open | counter slides up 12px + fades in (200ms) | paper rustle |
| Close | reverse (150ms) | — |
| Choose a line | manicule slides in (150ms) | quill tick |
| Signed: buy / sell | stamp 1.8→1 (230ms), hold, fade (1.9s total); purse rolls (450ms); crates fill | coins out / coins in |
| Refused | none | low thud |

Reduced motion: no slide, scale or roll; the stamp appears and fades. Prefer short CC0 samples
(`client/public/sounds/trade/*.mp3`, ≤ 20 KB each) over synthesised beeps.

## 10. Layout rules for overlays

- **Desktop and landscape: split.** Page (header, toolbar, list) on the left; the bill of sale as a separate sheet on
  the right (340px desktop, 280px landscape) with the Sign button at its foot (sticky in landscape, with content
  padded so the preview line is never under it).
- **Portrait phone:** page on top, the slip below it overlapping by 10px, `max-height: 41%` of the screen; stepper and
  chips on one row; no slider; the purse/hold preview on one line.
- **Density targets (verified with Playwright):** ≥ 8 rows visible at 1280×720 with the slip open; ≥ 4 at 667×375;
  ≥ 3 at 375×667 with the slip open.
- Only the list scrolls (`minmax(0,1fr)` grid row, `overscroll-behavior: contain`, `scroll-padding-top` = sticky heads).
- Safe areas via `env(safe-area-inset-*)`. Breakpoints are container queries on the overlay container.
- Z-order: world < HUD < scrim < overlay < toasts. While an overlay is open, unrelated HUD hotkeys are suspended.

## 11. Mobile rules

- Tap targets ≥ 44 × 44 (cells: row height; chips, stepper, tabs, knob 44; Sign 52, 46 landscape).
- The money-committing button is the bottom-most, full-width element in portrait.
- Filters become one native `<select>` ("Show: All (19)") on narrow screens: no sideways-scrolling toolbars.
- No hover-only information; keyboard help is hidden on `(hover: none)`.
- Text ≥ 13px; figures 18px.

## 12. Accessibility

- `role="dialog" aria-modal="true"`, labelled by the port name. **Focus trap**; focus goes to the list on open and
  back to the opener on close.
- **Roving tabindex:** the ledger is one Tab stop; ↑/↓ move between lines, ←/→ between the buy and sell columns.
- Focus is **restored** after every re-render (to the same control, or to the chosen cell / Sign).
- **One persistent live region** (`aria-live="polite"`) for results and refusals; it is never re-created.
- Blocked reasons are linked with `aria-describedby` (cell → its note; Sign → the limit and preview lines).
- Plain screen-reader labels ("Clear selection", "Close the trade screen", "Buy Sugar at 18 gold").
- Keys: ↑↓ ←→, **B / S only choose a side (never clear)**, + / − (Shift ×10), M max, Enter sign, Esc back
  (selection → screen), 1 / 2 offices, T close. Pointer re-press on the inked cell clears.
- **Pending lock:** while a request is out, cells, chips, tabs, filters, × and Esc are inert; the Sign button says why.

## 13. Do / don't

| Do | Don't |
|---|---|
| `Sugar ......... 18 \| 16` bare figures with leaders | boxes, coins and "Buy"/"Sell" words in every cell |
| "Buy 14 Sugar · 252 g" on the one brass button | "Confirm", brass chips, brass close buttons |
| Clamp and name the limit | accept 999 and fail later |
| Keep the result on the page (stamp, note, purse) | clear the selection before the server answers |
| "paid 14" in the row; profit only in the slip on a sale | a red "−2 ea" next to something you just bought |
| Wax seal + "wanted" | a red filled badge |
| A bar of crates | a progress bar |

## 14. Follow-ups (required, other screens)

- **Leaderboard** (`ui/Leaderboard.tsx`): lucide icons and bare parchment over the sea. Make it a guild roll /
  wanted board in a wood frame; medals from `.ptw-medal`; digits in `.ptw-num`.
- **Game over** (`ui/GameOver.tsx`): a sealed letter in a wood frame, no lucide, no bare parchment over the scene.
- **Port prompt** ("press T to trade", GameUI): a small `HudPanel` plaque; no `animate-pulse`.
- **Reference board** for future screens: an 18th-c. price current, a merchant's daybook, a bill of lading. Right:
  `after-*-buy.jpg`; wrong: `before-*.png`.

## 15. Changes to the theme layer

- **Tokens added:** `--ptw-ink-blue`, `--ptw-ink-off`, `--ptw-slip`, `--ptw-sel-wash`, `--ptw-hover-wash`,
  `--ptw-ledger-rule`, `--ptw-ledger-margin`, `--ptw-leader`, `--ptw-wax-text`, `--ptw-font-note` (+ IM Fell English
  italic in the font link).
- **Classes added:** `.ptw-counter`, `.ptw-ledger-page`, `.ptw-cell`, `.ptw-slip`, `.ptw-stamp`, `.ptw-mark--*`,
  `.ptw-order`, `.ptw-knob`, `.ptw-qchip`, `.ptw-note--refusal`.
- *Override:* `.ptw-ledger__row.is-selected` (a tint) is not enough in the trade ledger; use the inked cell.
- *Override:* disabled buttons lose their material (dotted outline on bare paper + reason) instead of fading.
- *Override:* parchment over the 3D scene always sits on a wood counter/frame and the scrim.
- *Override:* brass is reserved for the single commit button per screen (the theme layer's brass porthole and
  brass chips are not used on in-world screens).
- *Agree:* palette, fonts, `.ptw-num`, focus ring, `HudPanel` over the sea, no backdrop-filter, reduced motion.
