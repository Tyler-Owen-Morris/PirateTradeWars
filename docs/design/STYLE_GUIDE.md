# Pirate Trade Wars: UI style guide

Status: proposal (2026-10-23). It was worked backwards from the trade screen redesign
(`docs/proposals/trade-redesign/`). The prototype `docs/proposals/trade-redesign/prototype.html` is the reference
implementation of every rule below.

**How it relates to the theme layer.** A parallel effort, "pirate theme layer", adds `client/src/styles/pirate.css`
(tokens `--ptw-*`, classes `ptw-*`) and `client/src/components/ui/pirate/*` (`PirateButton`, `ParchmentPanel`, ...).
This guide **adopts** its palette, fonts, materials and focus ring unchanged. It **extends** them with ledger,
selection and trade tokens, and it **overrides** them in three places, marked "Override" below. Each extension and
override is listed in the section "Changes to the theme layer" at the end. Where this guide is silent, the
theme-layer README rules.

---

## 1. Principles

1. **Grounded in the world.** Every surface is an object a ship's captain would really hold or look at. The trade
   screen is the harbourmaster's bill of goods on a wooden counter, not a "dialog". Name each surface after its object
   (see Materials) and draw it as that object: ruled paper, ink, brass, wax, wood. Words are in-world too ("Sign",
   "Purse", "Hold", "not sold here", "the harbourmaster refuses"), with plain English for the facts (numbers, limits,
   reasons).
2. **Obvious state.** At any moment the player can answer three questions without hunting:
   *What have I chosen? What will happen if I press the big button? Why can't I?*
   - The thing that's selected is drawn **inked in** (solid dark fill), not just tinted.
   - The primary button's label states the whole action: "Buy 14 Sugar · 252 g".
   - Every blocked action says why, in words, next to where you'd press it.
3. **Nothing hides.** Headers and the action area are fixed. Only the list scrolls. A primary action never sits below
   the fold, on any screen size.
4. **Nothing carries over by surprise.** Changing a tab, a row or a side resets what depended on it. There is no
   hidden "mode".
5. **Numbers are instruments.** Gold, cargo and prices use tabular figures. They sit where the eye expects them
   (purse top-left, hold meter next to it), and they preview the result of the action before you commit.
6. **The 3D world stays the hero.** Overlays leave the ocean visible around them on desktop. On phones they go full
   bleed but keep the wooden frame, so the screen still reads as an object set down over the sea.

## 2. Materials vocabulary

Pick the object first, then the material.

| Surface in the game | In-world object | Material (class / component) | Notes |
|---|---|---|---|
| Trade screen | Harbourmaster's **bill of goods** on the counter | wood frame `.ptw-wood` + ruled parchment `.ptw-ledger-page` | red double margin rule, ink column rules |
| Trade quantity + confirm | **Bill of sale** chit, perforated top | `.ptw-slip` (parchment-lo, dashed top edge) | always docked; "Bill of Sale" label on the perforation |
| Shipwright (repair, refit) | **Work orders** pinned on the same counter | `.ptw-order` cards on the ledger page | same slip confirms them |
| Price or action on a row | **Price tag** / ruled ledger box | `.ptw-tag` | outline = can press; inked = chosen; dashed = cannot |
| Purse (gold) | Coin purse + doubloon | coin glyph + `.ptw-num` | top-left of every port screen |
| Hold (cargo) | Hold gauge, a brass-cased **bar of crates** | `.ptw-meter--hold` | shows a hatched preview of the pending trade |
| "Wanted" | Red **wax notice** pasted on the line | `.ptw-mark--wanted` | always paired with the word |
| Success feedback | **Ink stamp** "Bought" / "Sold" on the line | `.ptw-stamp` | plus coin sound, purse roll |
| Errors | **Wax-red slip** from the harbourmaster | `.ptw-alert` (theme layer) | `role="alert"` |
| HUD over the sea | Brass and dark-wood **instrument plates** | `HudPanel` (theme layer) | never parchment over the sea |
| World map | **Sea chart** | `SeaChartBackdrop` | |
| Chat | **Ship's log** | `HudPanel` + `.ptw-ledger` rows | |
| Leaderboard | **Wanted board** / guild roll | parchment + `.ptw-medal` | |
| Game over, purchases | **Sealed letter** | `ParchmentPanel torn` + `WaxSeal` | |
| Close / round icon buttons | **Brass porthole** knob | `.ptw-btn--porthole` | 44 px minimum |

Don't: generic rounded cards, glassmorphism, gradients that aren't a material, lucide icons in body text, emoji.

## 3. Colour tokens

All tokens are on `:root` in `client/src/styles/pirate.css`. The first block exists in the theme layer; **new** marks
an addition proposed here.

| Token | Value | Role |
|---|---|---|
| `--ptw-ink` | #2a1a0c | text, rules, the **selected** fill |
| `--ptw-ink-soft` | #5c3e1e | secondary text, labels, the dashed "cannot" outline |
| `--ptw-ink-blue` **new** | #1f3a5a | purchase marks: "Purchase" tag, "Bought" stamp, hold-preview hatching |
| `--ptw-ink-off` **new** | #7d6748 | disabled text on parchment (4.0:1, see below) |
| `--ptw-parchment` / `-hi` / `-lo` | #ecdcb4 / #f7ecd2 / #d6bc88 | paper |
| `--ptw-sel-wash` **new** | #e3c98a | background of a selected row or order |
| `--ptw-hover-wash` **new** | rgb(122 74 26 / .09) | hover on rows and plain buttons |
| `--ptw-ledger-rule` **new** | rgb(42 26 12 / .2) | row rules |
| `--ptw-ledger-margin` **new** | rgb(142 26 20 / .45) | the red double margin line |
| `--ptw-wood` / `-dark` / `-black` | #3b2414 / #20130a / #120a05 | frame, secondary buttons |
| `--ptw-brass-hi` / `brass` / `-lo` | #f6e0a0 / #c9a24d / #7a571e | primary button, porthole, slider thumb |
| `--ptw-wax` / `-hi` / `-lo` | #8e1a14 / #d0453a / #540a08 | sale marks, "Wanted", errors, destructive |
| `--ptw-wax-text` **new** | #fbe9d6 | text on wax |
| `--ptw-good-ink` / `--ptw-bad-ink` | #265c22 / #8e1a14 | profit / loss, "Cheap here" |
| `--ptw-cream`, `--ptw-gold` | #f5e9cc / #f2c35b | text and figures on wood and on the HUD |
| `--ptw-focus` | #ffe08a | focus ring (always with a dark halo) |

**Meaning is never colour alone.** Buy vs sell is said in words ("Buy", "Sell", "Purchase", "Sale") and by position
(Buy is always the left tag). Profit carries a sign ("+58 ea"). Wanted is a word on a seal.

**Colour semantics for prices.** Colour judges the deal from the player's side, never the raw direction of the
price: a low *buy* price is good (green "Cheap here"), a high *sell* price is good ("Pays well"). The current screen
gets this backwards (it paints a 47% drop red on the Buy tab).

### Contrast (WCAG 2.x, measured)

Over parchment (all body text at least 4.5:1, AA):

| Foreground | Background | Ratio |
|---|---|---|
| ink #2a1a0c | parchment #ecdcb4 | 12.4 |
| ink | parchment-lo #d6bc88 (slip) | 9.1 |
| ink | sel-wash #e3c98a | 10.4 |
| ink-soft #5c3e1e | parchment / sel-wash / parchment-lo | 7.1 / 6.0 / 5.3 |
| ink-blue #1f3a5a | parchment / sel-wash | 8.5 / 7.2 |
| good-ink #265c22 | parchment / sel-wash | 5.9 / 4.9 |
| bad-ink / wax #8e1a14 | parchment / sel-wash | 6.7 / 5.6 |
| burn #7a4a1a | parchment | 5.5 |
| ink-off #7d6748 (disabled) | parchment | 4.0 (disabled text is exempt; we still keep it above 3:1) |
| parchment-hi #f7ecd2 | ink (selected tag) | 14.3 |
| ink | brass #c9a24d / brass-hi | 7.0 / 12.9 |
| wax-text #fbe9d6 | wax | 7.7 |
| cream #f5e9cc | wood #3b2414 | 12.0 |
| gold #f2c35b | wood / wood-dark | 8.8 / 11.0 |

Over the 3D ocean (the overlay's edge has to separate from the scene):

| Pair | Ratio | Rule |
|---|---|---|
| parchment vs bright noon sky #e8f3f8 | **1.2** | Parchment must **never** touch the sea directly. |
| parchment vs bright sea #7cc4dc | **1.4** | Same. |
| wood-dark frame vs noon sky / sea | 16.1 / 9.3 | So every parchment overlay sits in a wood frame of at least 6 px... |
| parchment vs night sea #07121b | 13.9 | ...and the scrim (below) darkens the scene behind it. |
| cream HUD text vs noon sky / sea | 1.1 / 1.6 | HUD text is never bare on the scene; it sits on `HudPanel` (10:1). |
| focus #ffe08a vs parchment | 1.1 | So the ring always has a 2 px ink halo inside it (`0 0 0 2px ink, 0 0 0 5px focus, 0 0 0 7px ink`). |

**Scrim:** a modal overlay dims the world with `radial-gradient(ellipse at center, rgb(7 18 27 / .35), rgb(7 18 27 / .7))`.
That's darker at the edges, so the sea stays visible but the frame always separates. No `backdrop-filter`: it
costs a full-screen blur every frame on a WebGL page.

## 4. Typography

| Role | Family | Size desktop / phone | Use |
|---|---|---|---|
| Display | Pirata One (`--ptw-font-display`) | 34 / 26 px port name; 28 / 24 slip title; 22 / 20 group heads | names of places, goods in the slip, section heads. Never for numbers or sentences. |
| Label | IM Fell English SC (`--ptw-font-label`) | 13 to 19 px, letter-spacing .03 to .1em | buttons, tags, tabs, column heads, marks |
| Hand **new** | IM Fell English italic (`--ptw-font-hand`) | 14 to 15 px | the clerk's notes: subtitles, "not sold here", group notes. Short phrases only. |
| Body | Alegreya (`--ptw-font-body`) | 16 to 17 px (minimum 14 for meta lines) | sentences, reasons, good names in rows (600 weight, 19 / 17 px) |
| Numerals | Alegreya with `.ptw-num` (lining + tabular) | prices 20 / 18 px bold, purse 22 / 19 px bold | every figure that updates or sits in a column |

Rules: one display line per surface region; no all-caps body text (small caps come from the label face); never set
the display face below 18 px; reasons and errors are full sentences in body type.

## 5. Iconography

- **Ink glyphs** for goods: 24 px, `stroke: currentColor`, 1.6 px stroke, no fill, drawn like a woodcut, in
  `ink-soft`. There is one glyph per kind of container: fish, log, bale, hide, sack, bottle, leaf, jar, bolt, chest,
  ingot, barrel. Goods that ship the same way share a glyph (sugar, cacao and coffee use the sack). Keep them as an
  inline SVG sprite (`client/src/components/ui/pirate/goodGlyphs.tsx`, new).
- **The manicule** (☞, `#g-hand`) in the margin points at the selected line. It's period-correct and unmistakable.
- **The doubloon** marks gold. It always sits next to a number, never alone.
- Interface icons (×, warning, quill) use 2 to 2.6 px strokes. Lucide is fine for plumbing, but keep it out of
  in-world surfaces.
- Icons never replace words on a primary or destructive action.

## 6. Buttons and controls

Every state is distinct by **shape or fill**, not by colour alone.

| Kind | Material | Class | Default | Hover | Pressed | Selected | Disabled |
|---|---|---|---|---|---|---|---|
| **Primary** (one per region) | brass plate with rivets, ink text | `.ptw-btn--brass` | raised: 3 px brass-lo bottom edge | brightness 1.06 | moves down 3 px, inset shadow | n/a | **dashed ink-off outline on bare paper**, no rivets; the reason is shown in text next to it |
| **Busy** | brass, desaturated | `aria-busy="true"` | quill icon + "Signing the ledger…" | none | none | n/a | not clickable |
| **Secondary** | carved wood plank, cream text | `.ptw-btn--wood`, `.ptw-qchip` | raised 2 to 3 px | lighter grain | moves down | **turns to brass, ink text, pressed in** (e.g. the "Max" chip when the amount is max) | opacity .45 |
| **Tertiary** | ink link (dotted underline) | `.ptw-btn--rope` | text | hover wash | none | n/a | ink-off |
| **Destructive** | red wax | `.ptw-btn--wax` | raised | none | moves down | n/a | n/a. Two-step: the first press arms it and changes the label to "Sign: …", which disarms after 6 s |
| **Row action** | ledger price tag | `.ptw-tag` | 1.5 px ink outline, translucent paper | paper-hi with a 2 px ink bottom edge | moves down 1 px | **inked in: solid ink fill, paper-hi text, a ✓ before the label, and a double ring (sel-wash + ink)** | **dashed ink-soft outline**, price still readable; pressing it explains why in the slip |
| **Tab** | bookmark | `.ptw-tab` | parchment-lo, ink-soft | none | none | paper-hi, ink, red wax lip on top | n/a |
| **Filter chip** | ink-ruled pill | `.ptw-chip` | outline | none | none | solid ink, paper text | n/a |
| **Icon / close** | brass porthole knob | `.ptw-btn--porthole` | 44 px round | none | moves down 2 px | n/a | n/a |

**Focus** (all of the above): `box-shadow: 0 0 0 2px var(--ptw-ink), 0 0 0 5px var(--ptw-focus), 0 0 0 7px var(--ptw-ink)`,
on `:focus-visible` only. It is visible on parchment, wood, brass and the sea.

**Quantity control** (one component, `QuantityControl`): stepper `[−][ n ][+]` (44 px cells, typed entry with
`inputmode="numeric"`), quick chips `1 · 10 · Max N` (on Sell: `All N`; when the hold is the limit: `Fill hold N`),
and a range slider with a brass coin thumb. All three edit the same number and always stay in step. The value
is clamped to `[1, max]` as you type; you can't request more than you can trade.

## 7. Selection and hover

- **Row selected** = sel-wash background, 2 px ink rules above and below, a red wax ribbon down the left margin, a
  manicule in the margin (it replaces the goods glyph), and the chosen tag inked in. That's five cues; no player
  will miss it.
- **Keyboard cursor** (moving with ↑/↓ before anything is chosen) = a 2 px dotted ink-soft outline. It is
  deliberately weaker than selection.
- **Hover** = hover-wash only. Hover never looks like selection.
- **One selection per screen**: `{ goodId, side }` as one value. Selecting anything replaces it; changing tab clears
  it; pressing the inked tag again clears it; Esc clears it.
- The selected row is kept in view: it is scrolled to the nearest edge whenever the slip changes height.

## 8. Motion and sound

| Event | Motion (≤ 450 ms, transform and opacity only) | Sound (synthesised or a small sample, SFX volume) |
|---|---|---|
| Choose a line | manicule slides in 6 px (150 ms) | soft quill tick |
| Trade signed (buy) | "Bought" ink stamp: scale 1.9 → 1 with a −9° tilt (230 ms), holds, fades (1.9 s total); purse rolls to the new value (450 ms, ease-out cubic); hold bar grows | two coins, falling pitch (coins leave the purse) |
| Trade signed (sell) | "Sold" wax-red stamp, the same motion | three coins, rising pitch (coins arrive) |
| Refused / error | none; the wax slip appears in place | one low thud |
| Hold preview | hatched segment slides (200 ms) | none |

**Reduced motion** (`prefers-reduced-motion: reduce`): no scale, no slide, no number roll. The stamp appears at full
size, holds, then fades. Every transition becomes ~0 ms. Sound is unaffected and follows the game's SFX mute.

Remove today's misuse: `tradeSuccess` currently plays `playPlayerHit()` (the cannon-hit sound).

## 9. Layout rules for overlays

- **Structure:** a fixed header (place, purse, hold, close), a fixed toolbar (tabs, filters), a single scroll region
  (`overflow-y: auto; overscroll-behavior: contain; min-height: 0` inside a grid row of `minmax(0, 1fr)`), and a
  fixed docked action area. Nothing below the action area. The page never scrolls; only the list does.
- **Size:** desktop `width: min(960px, 100% - 32px); height: min(800px, 100% - 32px)`, centred, so the sea shows
  around it. Under 640 px wide (phones): full bleed with a 6 px wood frame.
- **Short screens** (height ≤ 520 px and width ≥ 560 px, i.e. phone landscape): two columns. The list is on the left,
  the slip on the right (272 px) with its own scroll, and its primary button is `position: sticky; bottom: 0`.
  The header collapses to one line.
- **Safe areas:** pad the frame with `env(safe-area-inset-*)` (top and bottom in portrait, left and right in
  landscape for the notch).
- **Sticky headings** inside the list: the column head sticks at `top: 0`, and each group heading sticks inside its
  own `<section>`, so headings never pile up. Set `scroll-padding-top` to their combined height so keyboard scrolling
  doesn't hide rows under them.
- **Breakpoints follow the overlay, not the window:** use container queries on the overlay's container
  (`container-type: size`). This works for the game's full-screen overlay and for embedded previews.
- **Z-order:** world < HUD < scrim < overlay < toasts. While an overlay is open, HUD hotkeys other than its own are
  suspended.

## 10. Mobile rules

- Tap targets ≥ 44 × 44 px (tags 68 × 48, chips 44, stepper cells 44, primary button 52 tall). Filter chips are 36 px
  visually, with a 44 px hit area from a pseudo-element.
- **Thumb reach:** the action that commits money is the bottom-most, full-width element in portrait. "Cancel" folds
  into the × at the top of the slip, out of the thumb's path.
- Row actions sit at the **right** edge (right-thumb reach). The row's name area is also tappable (it sells if you
  hold some, otherwise it buys).
- Show no hover-only information. Hide keyboard hints on `(hover: none)`.
- Long lists: group headings stick; filters scroll sideways in one row with a fade at the right edge (never a page
  scroll).
- Text never below 14 px on phones; numbers in tags 18 px.
- No horizontal page scroll at 320 to 375 px; the prototype is checked at 375 × 667 and 667 × 375.

## 11. Accessibility

- The overlay is `role="dialog" aria-modal="true"`, labelled by the port name and described by the subtitle. Focus
  moves into the list on open and returns to the trigger on close. Esc steps back (clears the selection, then closes).
- Tags are `<button aria-pressed>` with a full label ("Buy Sugar at 18 gold"; "Sell Furs at 128 gold, you carry 6").
- "Not sold here" is text, not a disabled button. Unavailable-but-explainable actions use the dashed style, stay
  focusable, and explain the reason on activation.
- The slip's result line is `role="status" aria-live="polite"`; errors are `role="alert"`.
- The hold meter has an `aria-label` that includes the preview ("Hold 26 of 40 used, 40 after this trade").
- Keyboard map (trade screen): ↑/↓ line, B buy, S sell, ←/→ amount (Shift ×10), M max or all, Enter sign, Esc back,
  1/2 tabs, T close. The game's ship controls are already neutral while trading (`Player.tsx` checks `isTrading`).
- Respect `prefers-reduced-motion`, and the SFX mute.

## 12. Do / don't

| Do | Don't |
|---|---|
| Write the action and its price on the primary button: "Sell 6 Furs · 768 g". | "Confirm", "Submit", "OK". |
| Show both prices on every line (what you'd pay, what they'd pay). | Split buying and selling into tabs that hide each other. |
| Clamp the amount and say what limits it ("Max 14: limited by the room left in your hold"). | Let the player type 50, then reject it with an error. |
| Keep the result on screen (stamp, status line, the purse) and keep the line chosen if more can be traded. | Clear the selection the instant the request is sent, before the server answers. |
| Say "not sold here" in the clerk's hand where the price would be. | Show a greyed-out "Buy" button with no reason. |
| Put each overlay on a material with a wood frame over the sea. | Put a bare parchment or translucent dark box over the ocean. |
| Use the doubloon and "g" with every figure that is money. | Mix "gold", "coins", "$" and bare numbers. |
| Keep primary actions in a docked area. | Append them below a list. |

## 13. Changes to the theme layer

These are proposed additions to `client/src/styles/pirate.css` and `components/ui/pirate/`, to be made when the trade
screen is built.

- **Extend tokens:** `--ptw-ink-blue`, `--ptw-ink-off`, `--ptw-sel-wash`, `--ptw-hover-wash`, `--ptw-ledger-rule`,
  `--ptw-ledger-margin`, `--ptw-wax-text`, `--ptw-font-hand` (and add IM Fell English italic to the Google Fonts
  link in `client/index.html`).
- **Extend classes:** `.ptw-ledger-page` (ruled paper with the red margin), `.ptw-tag` (row price-tag button with
  pressed, off and inked states), `.ptw-slip` (docked bill of sale), `.ptw-stamp` (+ `--buy` / `--sell`),
  `.ptw-mark--wanted|--cheap|--dear`, `.ptw-meter--hold` with a `__preview` child, `.ptw-chip` (filter pill),
  `.ptw-qchip`, `.ptw-order`.
- **Override 1, selected state:** the theme layer's `.ptw-ledger__row.is-selected` is a tint. In a ledger, use the
  full selection treatment from section 7 (inked tag, ribbon, manicule, ink rules). A tint alone isn't "obvious".
- **Override 2, disabled buttons:** the theme layer dims disabled buttons. Here a disabled primary loses its
  material: dashed outline on bare paper, no rivets, and the reason in text. Faded brass reads as "pressable but
  dull".
- **Override 3, parchment overlays:** the theme layer allows a bare `ParchmentPanel` as a dialog. Any parchment
  surface over the 3D scene sits inside a wood frame of at least 6 px, plus the scrim (parchment against the noon sea
  is 1.2:1).
- **Agree:** fonts, palette, `.ptw-num`, focus ring, the wax `ptw-alert`, `HudPanel` for anything over the sea,
  "no backdrop-filter", and the reduced-motion policy.
