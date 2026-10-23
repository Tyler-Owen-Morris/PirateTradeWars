import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { WORLD_C, WORLD_H, Z_ICE_N, Z_ICE_S, compassHeading, xOfLon, zOfLat } from '@shared/world/geo';
import {
  MapView,
  clampView,
  gridLines,
  mapImageOffsets,
  mapScreenToWorld,
  mapWorldToScreen,
  nationColor,
  pickPort,
  portPoint,
  zoomAt,
  formatLatLon,
  placeLabels,
  portLabelPriority,
  type LabelCandidate,
} from '@/lib/nav';

const MAP_SRC = '/world/map_4096x2048.png';

/**
 * Full-screen world map (card W5). Opened with M / the HUD button (GameUI owns the toggle; this
 * component closes itself on Esc). Equirectangular chart with 30° lat/lon grid, ±70° ice lines,
 * nation-coloured ports with names, the player's marker and heading. Drag pans (x wraps), wheel
 * and pinch zoom, a click (no drag) on a port selects it as the navigation target.
 * All geometry is in lib/nav.ts (tested).
 */
export function WorldMap({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const player = useGameState((s) => s.gameState.player);
  const ports = useGameState((s) => s.gameState.ports);
  const target = useGameState((s) => s.getNavTargetPort());
  const setNavTarget = useGameState((s) => s.setNavTarget);
  const [hover, setHover] = useState<string | null>(null);

  const [view, setView] = useState<MapView>(() => {
    const p = useGameState.getState().gameState.player;
    return clampView(
      { cx: p ? p.x : WORLD_C / 2, cz: p ? p.z : WORLD_H / 2, k: 0.004 },
      window.innerHeight,
    );
  });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.src = MAP_SRC;
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the view valid after a resize.
  useEffect(() => {
    setView((v) => clampView(v, size.h));
  }, [size.h]);

  // ---- drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = size;
    const v = view;
    ctx.fillStyle = '#0d2438';
    ctx.fillRect(0, 0, w, h);

    const top = mapWorldToScreen(v, w, h, 0, 0).y;
    const mapH = WORLD_H * v.k;
    const offsets = mapImageOffsets(v, w);
    const img = imgRef.current;
    if (img) {
      ctx.imageSmoothingEnabled = true;
      for (const o of offsets) ctx.drawImage(img, o, top, WORLD_C * v.k, mapH);
    }

    // Ice (±70°) shading and lines
    const yN = mapWorldToScreen(v, w, h, 0, Z_ICE_N).y;
    const yS = mapWorldToScreen(v, w, h, 0, Z_ICE_S).y;
    ctx.fillStyle = 'rgba(220,240,255,0.35)';
    ctx.fillRect(0, top, w, yN - top);
    ctx.fillRect(0, yS, w, top + mapH - yS);
    ctx.strokeStyle = 'rgba(160,220,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    for (const y of [yN, yS]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Lat/lon grid every 30°
    const g = gridLines(30);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    for (const lat of g.lats) {
      const y = mapWorldToScreen(v, w, h, 0, zOfLat(lat)).y;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${Math.abs(lat)}°${lat > 0 ? 'N' : lat < 0 ? 'S' : ''}`, 4, y - 3);
    }
    for (const lon of g.lons) {
      const x = mapWorldToScreen(v, w, h, xOfLon(lon), 0).x;
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, top));
      ctx.lineTo(x, Math.min(h, top + mapH));
      ctx.stroke();
      ctx.fillText(`${Math.abs(lon)}°${lon > 0 ? 'E' : lon < 0 ? 'W' : ''}`, x + 3, h - 6);
    }

    // Ports: every dot, then the labels that fit (lib/nav placeLabels: target, major ports, then by id),
    // so the crowded Caribbean and River Plate thin out when zoomed out.
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px Arial';
    const labels: LabelCandidate[] = [];
    for (const p of ports) {
      const pt = portPoint(p);
      const s = mapWorldToScreen(v, w, h, pt.x, pt.z);
      if (s.x < -60 || s.x > w + 60 || s.y < -20 || s.y > h + 20) continue;
      const sel = target != null && target.id === p.id;
      ctx.fillStyle = nationColor(p.nation);
      ctx.strokeStyle = sel ? '#ffffff' : '#000000';
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sel ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      labels.push({ id: p.id, x: s.x, y: s.y - 10, text: p.name, priority: portLabelPriority(p as { key?: string; id: number }, sel) });
    }
    const shown = placeLabels(labels, (t) => ctx.measureText(t).width, 13);
    ctx.lineWidth = 3;
    for (const l of labels) {
      if (!shown.has(l.id)) continue;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(l.text, l.x, l.y);
    }

    // Player
    if (player) {
      const s = mapWorldToScreen(v, w, h, player.x, player.z);
      const hd = (compassHeading(player.rotationY) * Math.PI) / 180;
      const fx = Math.sin(hd);
      const fy = -Math.cos(hd);
      const L = 11;
      ctx.fillStyle = '#4caf50';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x + fx * L, s.y + fy * L);
      ctx.lineTo(s.x - fx * L * 0.6 - fy * L * 0.6, s.y - fy * L * 0.6 + fx * L * 0.6);
      ctx.lineTo(s.x - fx * L * 0.6 + fy * L * 0.6, s.y - fy * L * 0.6 - fx * L * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, [view, size, ports, player, target, imgReady]);

  // ---- input
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragMoved = useRef(0);
  const pinchDist = useRef(0);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) dragMoved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      dragMoved.current = 99;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      const hit = pickPort(viewRef.current, size.w, size.h, p.x, p.y, ports);
      setHover(hit ? hit.name : null);
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const f = d / pinchDist.current;
        setView((v) => zoomAt(v, size.w, size.h, (a.x + b.x) / 2, (a.y + b.y) / 2, f));
      }
      pinchDist.current = d;
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    dragMoved.current += Math.abs(dx) + Math.abs(dy);
    setView((v) => clampView({ ...v, cx: v.cx - dx / v.k, cz: v.cz - dy / v.k }, size.h));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = local(e);
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;
    if (wasSingle && dragMoved.current < 6) {
      const hit = pickPort(viewRef.current, size.w, size.h, p.x, p.y, ports, 18);
      if (hit) setNavTarget(hit.id);
    }
  };

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => zoomAt(v, size.w, size.h, p.x, p.y, f));
    },
    [size.w, size.h],
  );
  // React's onWheel is passive; attach natively to be able to preventDefault.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const centerOnPlayer = () => {
    if (player) setView((v) => clampView({ ...v, cx: player.x, cz: player.z }, size.h));
  };
  const zoomBtn = (f: number) => setView((v) => zoomAt(v, size.w, size.h, size.w / 2, size.h / 2, f));

  // Pointer position readout under the cursor is skipped; show the view centre instead.
  const centre = mapScreenToWorld(view, size.w, size.h, size.w / 2, size.h / 2);
  const centreLat = 90 - (centre.z / WORLD_H) * 180;
  const centreLon = (centre.x / WORLD_C) * 360 - 180;

  return (
    <div className="fixed inset-0 z-[100] bg-black" data-testid="world-map">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="ptw-parchment absolute top-2 left-2 sm:top-4 sm:left-4 max-w-[calc(100%-4.5rem)] sm:max-w-sm px-3.5 py-2.5 text-xs sm:text-sm pointer-events-none shadow-[0_4px_14px_rgba(0,0,0,0.5)]">
        <div className="ptw-font-display text-xl sm:text-2xl leading-none mb-1">World Map</div>
        <div>Drag to pan, wheel/pinch to zoom, click a port to navigate to it.</div>
        <div className="ptw-num text-ptw-ink-soft">Centre {formatLatLon(centreLat, centreLon)}{hover ? ` · ${hover}` : ''}</div>
        <div className="text-ptw-ink-soft italic">Dashed lines: polar pack ice (70°)</div>
      </div>
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 flex flex-col gap-2">
        <button className="ptw-btn ptw-btn--porthole text-xl" onClick={onClose} title="Close (Esc / M)" aria-label="Close map">
          ×
        </button>
        <button className="ptw-btn ptw-btn--porthole text-xl" onClick={() => zoomBtn(1.5)} aria-label="Zoom in">
          +
        </button>
        <button className="ptw-btn ptw-btn--porthole text-xl" onClick={() => zoomBtn(1 / 1.5)} aria-label="Zoom out">
          −
        </button>
        <button className="ptw-btn ptw-btn--porthole ptw-font-label text-xs" onClick={centerOnPlayer} aria-label="Centre on ship" title="Centre on ship">
          Me
        </button>
      </div>
    </div>
  );
}
