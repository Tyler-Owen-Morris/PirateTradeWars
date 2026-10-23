import { useGameState } from '@/lib/stores/useGameState';
import { compassHeading } from '@shared/world/geo';
import { cardinalOf, formatPosition, formatSeaMiles, targetInfo } from '@/lib/nav';
import { PirateButton } from './pirate';

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
    // Below lg the centred tape would sit on the ship panel, so it stacks under the top-right buttons.
    <div className="absolute z-40 top-[3.25rem] right-2 sm:top-16 sm:right-4 lg:top-1 lg:right-auto lg:left-1/2 lg:-translate-x-1/2 flex flex-col items-end lg:items-center gap-1 pointer-events-none select-none">
      <div className="ptw-hud px-2.5 pt-1 pb-1 max-w-[92vw]">
        <div className="relative overflow-hidden h-6 mx-auto max-w-[150px] sm:max-w-none" style={{ width: Math.min(tapeW, 280) }}>
          <div className="absolute left-1/2 top-0 h-full" style={{ width: 0 }}>
            {ticks.map((t) => (
              <div key={t.off} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: t.off }}>
                <div className={`mx-auto w-px ${t.deg % 45 === 0 ? 'h-2.5 bg-ptw-brass-hi' : 'h-1.5 bg-ptw-cream/55'}`} />
                {t.deg % 45 === 0 && (
                  <div className={`ptw-font-label text-[0.7rem] leading-none ${t.deg % 90 === 0 ? 'text-ptw-brass-hi' : 'text-ptw-cream/80'}`}>
                    {cardinalOf(t.deg)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-[6px] border-l-transparent border-r-transparent border-b-[#e0503f]" />
        </div>
        <div className="text-center text-xs sm:text-sm ptw-num font-bold">
          {Math.round(heading) % 360}° {cardinalOf(heading)}
          <span className="ml-3 font-normal text-ptw-cream/90" data-testid="latlon">{formatPosition(player.x, player.z)}</span>
        </div>
      </div>

      <div className="ptw-hud px-2 py-1 text-[0.7rem] sm:text-xs pointer-events-auto flex items-center gap-2">
        {target && info ? (
          <>
            <svg width="22" height="22" viewBox="-11 -11 22 22" aria-label="Target direction">
              <g transform={`rotate(${info.relative})`}>
                <path d="M0,-9 L6,7 L0,3 L-6,7 Z" fill="#f2c35b" stroke="#2a1a0c" strokeWidth="1" />
              </g>
            </svg>
            <div>
              <div className="ptw-font-label text-[0.8rem] sm:text-sm leading-tight text-ptw-brass-hi">{target.name}</div>
              <div className="ptw-num">
                {formatSeaMiles(info.distance)} · {Math.round(info.bearing) % 360}° {cardinalOf(info.bearing)}
              </div>
            </div>
          </>
        ) : (
          <span className="italic">No port target</span>
        )}
        <PirateButton
          size="xs"
          className="ml-1"
          onClick={onOpenMap}
          title="World map (M)"
          data-testid="open-world-map"
        >
          Map
        </PirateButton>
      </div>
    </div>
  );
}
