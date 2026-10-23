import { useAutoSail } from "@/lib/stores/useAutoSail";
import { Kbd } from "./pirate";

/**
 * Brass plaque shown under the compass while keyboard auto-sail is on (see lib/net/autoSail.ts).
 * Polished brass with ink lettering stands out from the dark HUD plates without animation:
 * a sail glyph, "Auto-sail" and the keys that cancel it. Pointer-transparent.
 */
export function AutoSailIndicator() {
  const active = useAutoSail((s) => s.active);
  if (!active) return null;
  return (
    <div
      role="status"
      className="absolute top-[12rem] right-2 lg:right-auto lg:top-[7.25rem] lg:left-1/2 lg:-translate-x-1/2 z-40 pointer-events-none flex items-center gap-2 rounded-md border border-ptw-wood-dark px-3 py-1 text-ptw-ink [text-shadow:none] shadow-[inset_0_1px_0_rgba(255,245,200,0.7),inset_0_-2px_3px_rgba(122,87,30,0.55),0_0_0_2px_rgba(18,10,5,0.85),0_3px_8px_rgba(0,0,0,0.55)] bg-[linear-gradient(180deg,#f6e0a0,#c9a24d_55%,#a57d33)]"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
        {/* sail under way */}
        <path fill="currentColor" d="M11 3v13H4.5zM13 6c4 2.5 6 6.5 6.5 10H13z" />
        <path fill="currentColor" d="M3 18h18l-2.5 3h-13z" />
      </svg>
      <span className="font-label text-sm sm:text-base font-bold tracking-wide whitespace-nowrap">Auto-sail</span>
      <span className="hidden sm:inline text-sm whitespace-nowrap">
        <Kbd>W</Kbd> or <Kbd>S</Kbd> to stop
      </span>
    </div>
  );
}
