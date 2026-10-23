/**
 * Broadsides (2026-10-23): one reload gauge per battery, port (L, key Q) and starboard (R, key E).
 * Each side reloads on its own (server-authoritative, snapshot `me.reloadPortMs` /
 * `me.reloadStarboardMs`, mirrored into the store player by useSocket at ~5 Hz and immediately when
 * a side becomes ready or fires). The bar fills as the side reloads and is full when it is loaded.
 * Deliberately plain Tailwind: the UI theme pass restyles it.
 */
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
  return (
    <div className="flex items-center gap-1" data-testid={`reload-gauge-${label}`} title={`${label === "L" ? "Port (left)" : "Starboard (right)"} cannons, key ${keyHint}`}>
      <span className="font-bold text-xs sm:text-sm w-3">{label}</span>
      <div className="w-10 sm:w-14 h-1.5 sm:h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-[width] duration-200 ease-linear ${ready ? "bg-green-500" : "bg-red-500"}`}
          style={{ width: `${Math.round(frac * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function ReloadGauges({ reloadPortMs, reloadStarboardMs, reloadTime }: ReloadGaugesProps) {
  return (
    <div>
      <div className="text-[0.6rem] sm:text-xs opacity-70">Cannons</div>
      <div className="flex items-center gap-2">
        <Gauge label="L" keyHint="Q" leftMs={reloadPortMs} reloadTime={reloadTime} />
        <Gauge label="R" keyHint="E" leftMs={reloadStarboardMs} reloadTime={reloadTime} />
      </div>
    </div>
  );
}
