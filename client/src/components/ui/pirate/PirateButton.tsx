import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * Themed button (styles: `.ptw-btn*` in client/src/styles/pirate.css).
 *
 * Variants:
 * - `brass`    primary action, brass plate with rivets ("Set Sail", Buy, Upgrade). Default.
 * - `wood`     secondary action, carved plank (Buy Max, Repair, tabs-like toggles).
 * - `rope`     low emphasis, rope border, inherits the panel's text colour (Cancel, Close, Random Name).
 * - `wax`      danger, blood-red wax (Retire / scuttle, destructive confirms).
 * - `iron`     combat, black iron with ember text (Fire Cannons).
 * - `porthole` round icon button with a brass ring (HUD / map toolbars). Give it an aria-label.
 *
 * Sizes: `xs` | `sm` | `md` (default) | `lg`. `block` makes it full width.
 * Hover, pressed, disabled and focus-visible states are all in CSS. `asChild` works like shadcn's
 * Button (Radix Slot), and the component forwards refs, so it can be a Radix `...Trigger asChild` child.
 */
export type PirateButtonVariant = "brass" | "wood" | "rope" | "wax" | "iron" | "porthole";
export type PirateButtonSize = "xs" | "sm" | "md" | "lg";

export interface PirateButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PirateButtonVariant;
  size?: PirateButtonSize;
  block?: boolean;
  asChild?: boolean;
}

/** The class string on its own, for elements that can't be a PirateButton (e.g. a Radix part). */
export function pirateButtonClass(
  variant: PirateButtonVariant = "brass",
  size: PirateButtonSize = "md",
  block = false,
): string {
  return cn("ptw-btn", `ptw-btn--${variant}`, size !== "md" && `ptw-btn--${size}`, block && "ptw-btn--block");
}

export const PirateButton = React.forwardRef<HTMLButtonElement, PirateButtonProps>(
  ({ variant = "brass", size = "md", block = false, asChild = false, className, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? type : type ?? "button"}
        className={cn(pirateButtonClass(variant, size, block), className)}
        {...props}
      />
    );
  },
);
PirateButton.displayName = "PirateButton";
