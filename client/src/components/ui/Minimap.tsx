import { useRef, useEffect, useMemo, useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import {
  MINIMAP_SIZE,
  MINIMAP_PLAYER_DOT_SIZE,
  MINIMAP_PORT_DOT_SIZE,
  MINIMAP_OTHER_PLAYER_DOT_SIZE,
} from '@shared/gameConstants';
import { compassHeading } from '@shared/world/geo';
import {
  MINIMAP_DEFAULT_RADIUS,
  minimapProject,
  minimapRow,
  minimapSpanLabel,
  nationColor,
  portPoint,
  stepMinimapRadius,
  placeLabels,
  portLabelPriority,
  type LabelCandidate,
} from '@/lib/nav';
import { clientLand } from '@/lib/world/landTiles';
import { MinimapLandLayer } from '@/lib/world/minimapLand';

const LAND_IMG_SRC = '/world/map_1024x512.png';

/**
 * Minimap (card W5): north-up, centred on the player, metric scaling. `radius` world units
 * (100 m each) from centre to edge; the +/- buttons halve/double it. Land comes from the
 * SDF tiles already loaded around the ship (lib/world/minimapLand.ts), so coasts stay sharp at every
 * zoom; the 1024 chart texture, drawn row by row (see nav.minimapRow) so east-west is scaled by
 * cos(latitude), is only the backdrop for tiles not loaded yet. The canvas is backed at
 * devicePixelRatio. All maths lives in lib/nav.ts and lib/world/minimapLand.ts (tested).
 */
export function Minimap({ toggleMinimap }: { toggleMinimap: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landRef = useRef<HTMLImageElement | null>(null);
  const [landReady, setLandReady] = useState(false);
  const [radius, setRadius] = useState(MINIMAP_DEFAULT_RADIUS);
  const { gameState } = useGameState();
  const navTarget = useGameState((s) => s.getNavTargetPort());
  const landLayer = useMemo(() => new MinimapLandLayer(clientLand.field), []);
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      landRef.current = img;
      setLandReady(true);
    };
    img.src = LAND_IMG_SRC;
  }, []);

  useEffect(() => {
    const player = gameState.player;
    const canvas = canvasRef.current;
    if (!canvas || !player) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = MINIMAP_SIZE;
    const half = S / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sea
    ctx.fillStyle = '#12304f';
    ctx.fillRect(0, 0, S, S);

    // Land, one image row per minimap row
    const img = landRef.current;
    if (img) {
      ctx.imageSmoothingEnabled = true;
      for (let row = 0; row < S; row++) {
        const { srcY, segments } = minimapRow(player.x, player.z, row, radius, S, img.width, img.height);
        for (const g of segments) {
          if (g.sw > 0 && g.dw > 0) ctx.drawImage(img, g.sx, srcY, g.sw, 1, g.dx, row, g.dw, 1);
        }
      }
    }
    // Sharp land from the SDF tiles on top (unloaded tiles stay transparent)
    landLayer.draw(ctx, player.x, player.z, radius, S, dpr, clientLand.version);

    // Faint range rings
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (const f of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, half * f - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ports
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    const labels: LabelCandidate[] = [];
    for (const port of gameState.ports) {
      const pt = portPoint(port);
      const { x, y } = minimapProject(player.x, player.z, pt.x, pt.z, radius, S);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      const isTarget = navTarget != null && navTarget.id === port.id;
      ctx.fillStyle = nationColor(port.nation);
      ctx.beginPath();
      ctx.arc(x, y, MINIMAP_PORT_DOT_SIZE * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isTarget ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = isTarget ? 2 : 1;
      ctx.stroke();
      labels.push({ id: port.id, x, y: y - MINIMAP_PORT_DOT_SIZE, text: port.name, priority: portLabelPriority(port as { key?: string; id: number }, isTarget) });
    }
    // Labels that fit (zoomed out, Buenos Aires/Montevideo or Panamá/Portobelo would overprint).
    const shown = placeLabels(labels, (t) => ctx.measureText(t).width, 11);
    ctx.fillStyle = '#ffffff';
    for (const l of labels) if (shown.has(l.id)) ctx.fillText(l.text, l.x, l.y);

    // Other ships / NPCs
    ctx.fillStyle = '#ff6347';
    for (const other of Object.values(gameState.otherPlayers)) {
      if (other.sunk) continue;
      const { x, y } = minimapProject(player.x, player.z, other.x, other.z, radius, S);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      ctx.beginPath();
      ctx.arc(x, y, MINIMAP_OTHER_PLAYER_DOT_SIZE * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player heading arrow (north-up, so rotate by compass heading)
    const h = (compassHeading(player.rotationY) * Math.PI) / 180;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    const L = MINIMAP_PLAYER_DOT_SIZE * 1.8;
    ctx.fillStyle = '#4caf50';
    ctx.strokeStyle = '#0b2b0e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(half + fx * L, half + fy * L);
    ctx.lineTo(half - fx * L * 0.6 - fy * L * 0.6, half - fy * L * 0.6 + fx * L * 0.6);
    ctx.lineTo(half - fx * L * 0.6 + fy * L * 0.6, half - fy * L * 0.6 - fx * L * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // North marker
    ctx.fillStyle = '#e6c577';
    ctx.font = 'bold 11px Arial';
    ctx.fillText('N', half, 11);

    // Border
    ctx.strokeStyle = '#c9a66b';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, S, S);
  }, [gameState.player, gameState.ports, gameState.otherPlayers, radius, landReady, navTarget, landLayer, dpr]);

  return (
    <div className="fixed bottom-32 left-4 z-50">
      <div className="ptw-hud p-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="ptw-font-label text-ptw-brass-hi text-sm">Navigation Map</h3>
          <div className="flex gap-1">
            <button
              className="ptw-btn ptw-btn--porthole ptw-btn--sm pointer-events-auto leading-none"
              onClick={() => setRadius((r) => stepMinimapRadius(r, 1))}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              className="ptw-btn ptw-btn--porthole ptw-btn--sm pointer-events-auto leading-none"
              onClick={() => setRadius((r) => stepMinimapRadius(r, -1))}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          width={Math.round(MINIMAP_SIZE * dpr)}
          height={Math.round(MINIMAP_SIZE * dpr)}
          style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
          className="block rounded-sm shadow-[0_0_0_1px_#120a05,0_0_0_3px_#c9a24d,0_0_0_4px_#120a05]"
        />
        <div className="ptw-num text-xs text-center mt-1.5 text-ptw-cream/85">{minimapSpanLabel(radius)}</div>
      </div>
    </div>
  );
}
