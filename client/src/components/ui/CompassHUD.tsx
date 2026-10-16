import { useGameState } from '@/lib/stores/useGameState';
import { compassHeading } from '@shared/world/geo';
import { cardinalOf, formatPosition, formatSeaMiles, targetInfo } from '@/lib/nav';

const PX_PER_DEG = 3;
const SPAN_DEG = 100; // visible degrees (±50)

/**
 * Compass HUD (card W5): heading tape (degrees + cardinal letters), lat/lon readout, and the
 * navigation target (selected on the world map, default nearest port) with distance in sea miles
 * (1 unit = 100 m, 1 nm = 18.52 units), compass bearing and an arrow relative to the bow.
 * Speed stays in HUD.tsx. Pure maths in lib/nav.ts.
 */
export function CompassHUD({ onOpenMap }: { onOpenMap: () => void }) {
  const player = useGameState((s) => s.gameState.player);
  const target = useGameState((s) => s.getNavTargetPort());
  if (!player) return null;

  const heading = compassHeading(player.rotationY);
  const info = target ? targetInfo(player.x, player.z, heading, target) : null;

  // Tape ticks every 15 degrees around the current heading.
  const ticks: { deg: number; off: number }[] = [];
  const start = Math.ceil((heading - SPAN_DEG / 2) / 15) * 15;
  for (let d = start; d <= heading + SPAN_DEG / 2; d += 15) {
    ticks.push({ deg: ((d % 360) + 360) % 360, off: (d - heading) * PX_PER_DEG });
  }
  const tapeW = SPAN_DEG * PX_PER_DEG;

  return (
    <div className="absolute top-1 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white pointer-events-none select-none">
      <div className="bg-black/55 rounded-md px-2 pt-1 pb-0.5 max-w-[92vw]">
        <div className="relative overflow-hidden h-6 mx-auto" style={{ width: Math.min(tapeW, 280) }}>
          <div className="absolute left-1/2 top-0 h-full" style={{ width: 0 }}>
            {ticks.map((t) => (
              <div key={t.off} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: t.off }}>
                <div className={`mx-auto w-px ${t.deg % 45 === 0 ? 'h-2.5 bg-amber-300' : 'h-1.5 bg-white/60'}`} />
                {t.deg % 45 === 0 && (
                  <div className={`text-[0.65rem] leading-none ${t.deg % 90 === 0 ? 'font-bold text-amber-300' : 'text-white/80'}`}>
                    {cardinalOf(t.deg)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-[6px] border-l-transparent border-r-transparent border-b-red-500" />
        </div>
        <div className="text-center text-xs sm:text-sm font-bold">
          {Math.round(heading) % 360}° {cardinalOf(heading)}
          <span className="ml-3 font-normal opacity-90" data-testid="latlon">{formatPosition(player.x, player.z)}</span>
        </div>
      </div>

      <div className="bg-black/55 rounded-md px-2 py-1 text-[0.65rem] sm:text-xs pointer-events-auto flex items-center gap-2">
        {target && info ? (
          <>
            <svg width="22" height="22" viewBox="-11 -11 22 22" aria-label="Target direction">
              <g transform={`rotate(${info.relative})`}>
                <path d="M0,-9 L6,7 L0,3 L-6,7 Z" fill="#f2c230" stroke="#000" strokeWidth="1" />
              </g>
            </svg>
            <div>
              <div className="font-bold">{target.name}</div>
              <div>
                {formatSeaMiles(info.distance)} · {Math.round(info.bearing) % 360}° {cardinalOf(info.bearing)}
              </div>
            </div>
          </>
        ) : (
          <span>No port target</span>
        )}
        <button
          className="ml-1 px-2 py-1 rounded bg-amber-700/70 text-white font-bold"
          onClick={onOpenMap}
          title="World map (M)"
          data-testid="open-world-map"
        >
          Map
        </button>
      </div>
    </div>
  );
}
