# Pirate UI theme: progress notes (2026-10-23)

Branch: `worktree-agent-a9c1ee7e030ab19ea` (agent worktree). Not pushed, not merged.

## Goal
Give the whole 2D UI (landing/ship selection, HUD, dialogs) a crafted pirate look through a small,
reusable theme layer, with no game, store, network or 3D changes.

**Owner direction, mid-task:**
- UI should feel grounded in the world: physical objects a captain would look at.
- Selected/active states and primary buttons must be unmistakable.
- `TradeMenu.tsx` is OUT of scope. It is being redesigned separately as a manifest. It was reverted to
  main and left untouched.

## Baseline
- `git reset --hard main` at e5ddb6e.
- The worktree's `node_modules` is a junction to the main checkout's (`mklink /J`), and is git-ignored.
- tsc baseline: 59 errors in total. In ui files: GameUI 2, Leaderboard 5, TouchControls 6,
  TradeMenu 3, interface 2. After the change the set is identical. The TouchControls style-object
  error only gained two keys in its message.

## Status (done)
- [x] Theme layer: `client/src/styles/pirate.css`.
  - Fonts load in `client/index.html`.
  - `tailwind.config.ts` adds `ptw` colours, font families, and a `^ptw-` safelist. The safelist is
    needed because Tailwind purges `@layer components` classes it can't see, and some are built from
    props.
- [x] Primitives in `client/src/components/ui/pirate/`, with a README.
- [x] Restyled the landing, NameRegistration (not mounted) and PaymentModal.
- [x] Restyled in-game: HUD, GameUI, CompassHUD, Minimap frame, WorldMap chrome, GameOver, Leaderboard,
  TradingToast, HelpTooltip and the TouchControls ring.
- [x] Screenshots: `docs/proposals/2026-10-23-theme-screens/`, as JPEG.
  - 1440x900 and 375x812 at dpr 2.
  - Taken with playwright-core and the installed chromium-1248, against a dev server on :5077 with
    local Redis.
- [x] `npm test` passes: 35 files, 337 tests. `npm run build` passes.
- [x] CLIENT_CONTEXT.md and the primitives README are updated.

## Decisions / gotchas
- **Material colours are background-image layers**, not `background-color`. shadcn's `bg-background`
  and Tailwind `bg-*` colour utilities therefore can't wipe them.
- **Selectors that fight shadcn state utilities are doubled for specificity**
  (`.ptw-tabs .ptw-tab[data-state=active]`, `input.ptw-input`).
- **Torn edges** are a 5-layer CSS mask (a 64x6 SVG tile per side plus a centre rect). Masks clip outer
  shadows.
- **Bug fix:** the HUD's full-screen root (`absolute inset-0`) covered the CompassHUD, so its Map button
  wasn't clickable. CompassHUD now has `z-40`, and Leaderboard is `z-[60]` so the trade prompt no
  longer sits on top of it.
- **Mobile:** the centred compass overlapped the ship panel. Below `lg` it stacks under the top-right
  buttons, and the speed plate moves below it.
- **Contrast:** measured, and all body pairs are at least 5:1. See the README table.
- **Global effects:** the body font is now Alegreya everywhere, and the shadcn tokens are defined. That
  also touches TradeMenu's look slightly (font, outline-button backgrounds), which is acceptable until
  its redesign lands.

## Next steps for whoever continues
- Restyle `ChatPanel.tsx` / `AutoSailIndicator.tsx` (being built in parallel) with `HudPanel`,
  `PirateButton`, `ptw-input` and `ptw-ledger`. There's an example at the end of the README.
- The TradeMenu redesign can reuse `ptw-ledger`, `ptw-tabs`, `ptw-tag` and `PirateButton`, or revise
  the tokens.
