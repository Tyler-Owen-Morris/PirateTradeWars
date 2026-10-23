import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Panel primitives. All are plain elements with a `ptw-*` material class (client/src/styles/pirate.css),
 * so Tailwind utilities for layout/padding/position still apply on top. Each one also sets the
 * matching text colour and `--ptw-rope-fill` / `--ptw-rule`, so `rope` buttons and `.ptw-ledger` rules
 * inside them pick the right colours automatically.
 */

type PanelProps = React.HTMLAttributes<HTMLElement> & {
  /** Element to render (default `div`). */
  as?: React.ElementType;
};

/**
 * Aged parchment / sea-chart panel, ink text. For dialogs, menus, ledgers.
 * `torn` adds deckled edges via a CSS mask (this clips outer box-shadows; the burn is inset).
 */
export const ParchmentPanel = React.forwardRef<HTMLElement, PanelProps & { torn?: boolean }>(
  ({ as: Comp = "div", torn = false, className, ...props }, ref) => (
    <Comp ref={ref} className={cn("ptw-parchment", torn && "ptw-torn", className)} {...props} />
  ),
);
ParchmentPanel.displayName = "ParchmentPanel";

/**
 * Dark weathered planks with brass corner studs, cream text. For frames, toolbars, plaques.
 * `studs={false}` drops the corner studs (small strips).
 */
export const WoodPanel = React.forwardRef<HTMLElement, PanelProps & { studs?: boolean }>(
  ({ as: Comp = "div", studs = true, className, ...props }, ref) => (
    <Comp ref={ref} className={cn("ptw-wood", !studs && "ptw-wood--plain", className)} {...props} />
  ),
);
WoodPanel.displayName = "WoodPanel";

/**
 * Compact in-game HUD plate: dark tarred leather, brass hairline + corner brackets, cream text with
 * a text-shadow. Readable over the 3D ocean at any time of day. No filters or animations (cheap to
 * re-render at 5 Hz).
 */
export const HudPanel = React.forwardRef<HTMLElement, PanelProps>(
  ({ as: Comp = "div", className, ...props }, ref) => (
    <Comp ref={ref} className={cn("ptw-hud", className)} {...props} />
  ),
);
HudPanel.displayName = "HudPanel";

/**
 * Display-face heading with ink flourishes either side (`flourish={false}` for a plain heading).
 * Size it with Tailwind (`text-2xl`); colour follows the panel (ink on parchment, cream on wood).
 */
export function SectionTitle({
  as: Comp = "h2",
  flourish = true,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: React.ElementType; flourish?: boolean }) {
  return <Comp className={cn("ptw-title", !flourish && "ptw-title--plain", className)} {...props} />;
}

/** Keycap for keyboard hints: <Kbd>T</Kbd>. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("ptw-kbd", className)} {...props} />;
}

/** Ornamental ink divider (a rule with a centre diamond). Colour = currentColor. */
export function InkDivider({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("ptw-divider", className)} {...props} />;
}
