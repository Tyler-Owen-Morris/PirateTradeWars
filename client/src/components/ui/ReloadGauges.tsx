/**
 * Broadsides (2026-10-23): one reload gauge per battery, port (L, key Q) and starboard (R, key E).
 * Each side reloads on its own (server-authoritative, snapshot `me.reloadPortMs` /
 * `me.reloadStarboardMs`, mirrored into the store player by useSocket at ~5 Hz and immediately when
 * a side becomes ready or fires). The bar fills as the side reloads and is full when it is loaded.
 * Themed: PirateMeter bars (green = loaded, red = reloading), brass badge lit when loaded.
 */
import { PirateMeter } from "./pirate";

interface ReloadGaugesProps {
  /** ms until the port (left) battery is loaded (0 = ready) */
  reloadPortMs: number;
  /** ms until the starboard (right) battery is loaded (0 = ready) */
  reloadStarboardMs: number;
  /** full reload duration of one battery, ms */
  reloadTime: number;
}

/** Loaded fraction 0..1 for a side with `leftMs` to go out of `reloadTime`. */
export function loadedFraction(leftMs: number, reloadTime: number): number {
  if (!(reloadTime > 0) || leftMs <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - leftMs / reloadTime));
}

function Gauge({ label, keyHint, leftMs, reloadTime }: { label: string; keyHint: string; leftMs: number; reloadTime: number }) {
  const frac = loadedFraction(leftMs, reloadTime);
  const ready = frac >= 1;
  const side = label === "L" ? "Port (left)" : "Starboard (right)";
  return (
    <div className="flex flex-col gap-0.5" data-testid={`reload-gauge-${label}`} title={`${side} cannons, key ${keyHint}`}>
      <div className="flex items-center gap-1">
        {/* side badge: lit brass when loaded, dark iron while reloading */}
        <span
          className={
            "flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full border text-[0.7rem] sm:text-xs font-bold leading-none [text-shadow:none] " +
            (ready
              ? "border-ptw-brass-hi bg-[linear-gradient(180deg,#f6e0a0,#c9a24d)] text-ptw-ink shadow-[0_0_6px_rgba(242,195,91,0.6)]"
              : "border-ptw-brass/40 bg-ptw-wood-dark text-ptw-cream/60")
          }
        >
          {label}
        </span>
        <span className={"hidden sm:inline font-label text-xs tracking-wide " + (ready ? "text-ptw-good" : "text-ptw-bad")}>
          {ready ? "Loaded" : "Reloading"}
        </span>
      </div>
      <PirateMeter
        value={frac * 100}
        tone={ready ? "good" : "bad"}
        label={`${side} cannons ${ready ? "loaded" : "reloading"}`}
        className="w-14 sm:w-20"
      />
    </div>
  );
}

export function ReloadGauges({ reloadPortMs, reloadStarboardMs, reloadTime }: ReloadGaugesProps) {
  return (
    <div>
      <div className="ptw-hud-label text-[0.65rem] sm:text-xs leading-tight">Cannons</div>
      <div className="flex items-start gap-2 sm:gap-3">
        <Gauge label="L" keyHint="Q" leftMs={reloadPortMs} reloadTime={reloadTime} />
        <Gauge label="R" keyHint="E" leftMs={reloadStarboardMs} reloadTime={reloadTime} />
      </div>
    </div>
  );
}
