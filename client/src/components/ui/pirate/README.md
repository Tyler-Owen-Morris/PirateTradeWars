# Pirate theme primitives

The 2D UI's look lives in two places:

- **`client/src/styles/pirate.css`**: design tokens (CSS variables on `:root`) and `ptw-*` component
  classes, in `@layer components`. It's imported at the top of `client/src/index.css`.
- **This folder**: small React wrappers around those classes, plus inline-SVG ornaments.

## Design principles

- **Grounded in the world.** Every surface should be a physical object a ship's captain would
  actually look at: sea charts, ledgers, manifests, carved wood, brass fittings, wax seals. Avoid
  generic panels with pirate paint on top.
- **Unmistakable states.** Selected and active states must be impossible to miss: a selected ship
  card gets a brass frame, a glow, a "Your Ship" ribbon and a wax seal; the active tab becomes a
  raised parchment bookmark; the primary action is always the brass plate.

**Trade screen.** `TradeMenu.tsx` is NOT restyled here. A separate design effort is redesigning it
as a "bill of goods" / manifest, with its own style guide, which may build on or revise these
primitives. The trade screen still picks up the global body font and the themed shadcn tokens.

Import everything from the barrel: `import { PirateButton, ParchmentPanel } from "@/components/ui/pirate";`

Fonts load from Google Fonts in `client/index.html` with `display=swap`:

| Role | Family | Class / Tailwind |
|---|---|---|
| Display (titles, ship names) | Pirata One | `ptw-font-display` / `font-display` |
| Labels, buttons, small caps | IM Fell English SC | `ptw-font-label` / `font-label` |
| Body (the default `body` font) | Alegreya | `ptw-font-body` / `font-body` |
| Numbers (gold, stats, prices) | Alegreya, lining + tabular figures | `ptw-num` |

Put `ptw-num` on anything numeric that updates or sits in a column.

## Pick a material

| Surface | Use | Text colour it sets |
|---|---|---|
| `ParchmentPanel` (`.ptw-parchment`), optionally `torn` (`.ptw-torn`) | dialogs, menus, ledgers, notes | ink |
| `WoodPanel` (`.ptw-wood`), `studs={false}` → `.ptw-wood--plain` | frames, plaques, toolbars, strips | cream |
| `HudPanel` (`.ptw-hud`) | anything floating over the 3D sea | cream + text-shadow |

Each panel also sets `--ptw-rope-fill` and `--ptw-rule`, so rope buttons and ledger rules inside it
pick matching colours by themselves.

- **HUD rule:** in-game overlays use `HudPanel`, never parchment. It is readable over a white noon sky
  and a black night sea (cream text measures 10:1 over white), and it's cheap: no `backdrop-filter`,
  no `filter`, no animation.
- **Torn edges** use a CSS mask, which also clips outer `box-shadow`. Torn panels rely on their inset
  burn and the overlay behind them instead.

## Buttons: `PirateButton`

```tsx
<PirateButton onClick={setSail} size="lg">Set Sail!</PirateButton>   // brass (default): primary
<PirateButton variant="wood">Buy Max</PirateButton>                  // carved plank: secondary
<PirateButton variant="rope">Cancel</PirateButton>                   // low emphasis, inherits panel colour
<PirateButton variant="wax"><Skull /> Retire</PirateButton>          // danger
<PirateButton variant="iron">Fire Cannons</PirateButton>             // combat
<PirateButton variant="porthole" aria-label="World map"><Map /></PirateButton>  // round icon button
```

- **Sizes:** `xs`, `sm`, `md` (default), `lg`. `block` makes the button full width. Small brass buttons
  drop their rivets.
- **States:** hover, pressed, `disabled` and `:focus-visible` (gold ring with a dark halo, visible on
  parchment and on dark) are all in CSS.
- **Refs and `asChild`:** the component forwards refs and supports `asChild`, so it works as a Radix
  trigger child: `<DialogTrigger asChild><PirateButton …/></DialogTrigger>`.
- **Without the component:** on a plain `<button>`, write the classes directly:
  `className="ptw-btn ptw-btn--porthole ptw-btn--sm"`, or use `pirateButtonClass(variant, size)`.
- **Labels:** porthole buttons have no text, so always give them an `aria-label`.

## Other primitives

- `SectionTitle`: a display-face heading with ink flourishes either side. Use `flourish={false}` for a
  plain heading and `as="h3"` to change the level. Size it with Tailwind (`className="text-3xl"`).
  The raw class is `.ptw-title`, and it works on a Radix `DialogTitle`; add `font-normal`.
- `PirateMeter value={0..100} tone="good|warn|bad|cargo|gold" label="Hull"`: a recessed bar that
  animates with `scaleX` (no layout). `hullTone(hp, max)` picks good/warn/bad.
- `Kbd`: a keycap, e.g. `<Kbd>T</Kbd>`. `InkDivider` is a rule with a centre diamond.
- `WaxSeal emblem="skull|anchor|compass"`: decorative unless you pass `title`.
- `CompassRose` (standalone svg) and `CompassRoseGlyph` (a `<g>` to embed in your own svg).
- `TitleLockup`: the "Pirate Trade Wars" logo (gilded type over a rose, with a ribbon tagline). It
  renders an `<h1>`.
- `SeaChartBackdrop`: the landing background (dusk sea chart, rhumb lines, fog, swell). Put it first
  inside a `fixed inset-0` container. Its animations are transform-only and stop under
  `prefers-reduced-motion`.

## CSS-only classes

| Class | What |
|---|---|
| `ptw-card` (+ `ptw-card--interactive`, `.is-selected` / `aria-pressed="true"`) | parchment tile (ship cards) |
| `ptw-plate` | ink-framed image plate; its `<img>` is sepia until hover or selection |
| `ptw-ledger` on a `<table>` or a container; `ptw-ledger__head`, `ptw-ledger__row`, `ptw-ledger__row--hover`, `.is-selected` | ledger rows with ink rules |
| `ptw-tabs` on a TabsList + `ptw-tab` on each TabsTrigger (or plain buttons with `data-state="active"`) | bookmark tabs on a wood strip |
| `ptw-input`, `ptw-label` | parchment text field and small-caps label |
| `ptw-alert` | wax-red error slip; use `role="alert"` |
| `ptw-toast` + `--ptw-toast-c` | parchment notification slip with a coloured edge |
| `ptw-tag`, `ptw-tag--green` | brass or green price tag |
| `ptw-medal ptw-medal--gold/silver/bronze/wax` | rank seal (leaderboards) |
| `ptw-ribbon` | wax ribbon banner |
| `ptw-gilded` | gold-leaf text (big display type on dark only) |
| `ptw-hud-label` | small-caps label on HUD plates |

## Shadcn dialogs

Style shadcn dialogs in place with `ptwDialog`, or with `ptwDialogTorn` for torn edges:

```tsx
<DialogContent className={`${ptwDialogTorn} max-w-lg px-6 pt-8 pb-7`}>
  <DialogTitle className="ptw-title font-normal text-3xl">…</DialogTitle>
```

Material colours sit in background-image layers, so shadcn's `bg-background` can't wipe them.
The shadcn HSL tokens (`--background`, `--primary`, …) are themed in `pirate.css`, so stray shadcn
parts (sliders, dropdowns) match too.

## Tailwind

`tailwind.config.ts` adds:

- **Fonts:** `font-display`, `font-label`, `font-body`.
- **Colours:** `ptw-*` with alpha support, e.g. `text-ptw-ink`, `text-ptw-ink-soft`, `bg-ptw-wood/80`,
  `border-ptw-brass/50`, `text-ptw-gold`, `text-ptw-good-ink`, `text-ptw-bad-ink`.
- **Safelist:** every `ptw-*` class is safelisted, because some are built from props
  (`ptw-btn--${variant}`).

## Contrast (WCAG, measured)

| Pair | Ratio |
|---|---|
| Ink on parchment | 12.4 |
| Ink-soft on parchment | 7.2 |
| Burn accent on parchment | 5.5 |
| Good-ink / bad-ink on parchment | 5.9 / 6.7 |
| Cream on HUD over a white sky | 10.2 |
| Ink on brass button | ≥ 5 |
| Text on wax | 8.0 |

Keep new body text on these pairs.

## Example: restyling a new overlay (e.g. a chat panel)

```tsx
<HudPanel className="absolute bottom-24 left-2 w-80 p-2">
  <h3 className="ptw-font-label text-ptw-brass-hi text-sm mb-1">Ship's Log</h3>
  <ul className="ptw-ledger text-sm">{/* rows: className="ptw-ledger__row py-1" */}</ul>
  <div className="flex gap-1 mt-2">
    <input className="ptw-input min-h-0 h-8 text-sm" aria-label="Message" />
    <PirateButton size="sm">Send</PirateButton>
  </div>
</HudPanel>
```
