/**
 * Installs the dev-only console hooks of lib/world/cityDebug.ts (`__cityCam`, `__ptwRenderInfo`,
 * `__ptwFrameStats`). No-op unless `cityDebug.enabled` (Vite dev or `?citydebug=1`).
 */
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useGameState } from "@/lib/stores/useGameState";
import { clientLand } from "@/lib/world/landTiles";
import { aimCityCam, cityDebug, setCityDebugHidePorts, type CityCamOptions } from "@/lib/world/cityDebug";

export function useCityDebugHooks(onExit: () => void): void {
  const gl = useThree((s) => s.gl);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  useEffect(() => {
    if (!cityDebug.enabled) return;
    const w = window as any;
    w.__cityCam = (key: string | null, opts?: CityCamOptions) => {
      if (!key) {
        cityDebug.active = false;
        clientLand.centerOverride = null;
        exitRef.current();
        return null;
      }
      const ports = useGameState.getState().gameState.ports;
      const k = key.toLowerCase();
      const port = ports.find((p) => p.key === k || p.name.toLowerCase() === k);
      if (!port) return `unknown port ${key}; try: ${ports.map((p) => p.key).join(", ")}`;
      aimCityCam(port, opts);
      clientLand.centerOverride = { x: cityDebug.fx, z: cityDebug.fz };
      return port.name;
    };
    w.__cityHide = (hide: boolean) => setCityDebugHidePorts(!!hide);
    w.__ptwRenderInfo = () => {
      const r = gl.info.render;
      return { calls: r.calls, triangles: r.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
    };
    w.__ptwFrameStats = (ms = 3000) =>
      new Promise((resolve) => {
        const dts: number[] = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (t: number) => {
          dts.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            dts.shift();
            const s = [...dts].sort((a, b) => a - b);
            const avg = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
            resolve({ frames: dts.length, avgMs: +avg.toFixed(2), p95Ms: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2) });
          }
        };
        requestAnimationFrame(tick);
      });
    return () => {
      delete w.__cityCam;
      delete w.__cityHide;
      delete w.__ptwRenderInfo;
      delete w.__ptwFrameStats;
    };
  }, [gl]);
}
