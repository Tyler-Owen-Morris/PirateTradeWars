import { cn } from "@/lib/utils";

export type MeterTone = "good" | "warn" | "bad" | "cargo" | "gold";

/** Hull meter tone by fraction left: > 60 % good, > 30 % warn, else bad (same thresholds as before). */
export function hullTone(current: number, max: number): MeterTone {
  const pct = max > 0 ? (current / max) * 100 : 0;
  if (pct > 60) return "good";
  if (pct > 30) return "warn";
  return "bad";
}

/**
 * Thin recessed meter with a brass hairline (hull, cargo, reload). `value` is 0..100.
 * The fill moves with `transform: scaleX` (no layout), so frequent updates are cheap.
 * Pass `label` for screen readers (it becomes the progressbar's aria-label).
 */
export function PirateMeter({
  value,
  tone = "gold",
  label,
  className,
}: {
  value: number;
  tone?: MeterTone;
  label?: string;
  className?: string;
}) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      className={cn("ptw-meter", `ptw-meter--${tone}`, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
    >
      <div className="ptw-meter__fill" style={{ transform: `scaleX(${v / 100})` }} />
    </div>
  );
}
