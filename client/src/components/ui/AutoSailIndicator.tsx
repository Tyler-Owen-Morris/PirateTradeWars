import { useAutoSail } from "@/lib/stores/useAutoSail";

/** Small badge shown while keyboard auto-sail is on (see lib/net/autoSail.ts). */
export function AutoSailIndicator() {
  const active = useAutoSail((s) => s.active);
  if (!active) return null;
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none bg-black/60 text-amber-300 text-sm px-3 py-1 rounded-md">
      ⛵ Auto-sail — W or S to stop
    </div>
  );
}
