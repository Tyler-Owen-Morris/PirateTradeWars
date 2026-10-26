/**
 * DEV-ONLY trailer hooks (docs/trailer/NOTES.md). Active only when BOTH `import.meta.env.DEV` (the Vite
 * dev server; the flag is a compile-time false in `npm run build`, so production bundles contain no
 * trace of it) AND the page URL has `?trailer=1`. Otherwise this hook does nothing.
 *
 * Installs `window.__trailer`:
 *   __trailer.setPath(keyframes)   // lib/trailer/path.ts Keyframe[]; takes over the camera (via cityDebug)
 *   __trailer.seek(t)              // pose the camera at path time t (pure function of t: deterministic)
 *   __trailer.play()               // real-time playback with rAF (for headed recording); resolves at the end
 *   __trailer.stop()               // give the camera back to the chase camera
 *   __trailer.hud(false|true)      // hide / show every HUD element (everything after the canvas wrapper)
 *   __trailer.hide(["selector"])   // extra CSS selectors to hide (e.g. the minimap) - optional
 *   __trailer.fov(deg)             // lens: vertical field of view (game default 80)
 *   __trailer.ship()               // own ship pose { x, z, rotationY } (for scripting)
 *   __trailer.ports()              // port keys, for path authoring
 * Camera control reuses the dev city camera (lib/world/cityDebug.ts): the render focus is the anchor, the
 * own ship stays visible (`cityDebug.showShip`), land tiles load around the anchor.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { useGameState } from "@/lib/stores/useGameState";
import { net } from "@/lib/net";
import { clientLand } from "@/lib/world/landTiles";
import { cityDebug } from "@/lib/world/cityDebug";
import { evalPath, pathDuration, type Keyframe, type PathContext } from "@/lib/trailer/path";

export const TRAILER_ENABLED: boolean = (() => {
  try {
    return !!(import.meta as any).env?.DEV && new URLSearchParams(window.location.search).get("trailer") === "1";
  } catch {
    return false;
  }
})();

/** Ship nameplates (name, NPC title, health bar): "all" normally. Trailer mode can ask `&plates=0` (none, cinematic
 *  shots) or `&plates=others` (every ship but your own, e.g. combat with the enemy's health bar). Used by Ship.tsx. */
export const TRAILER_NAMEPLATES: "all" | "none" | "others" = (() => {
  try {
    const v = TRAILER_ENABLED ? new URLSearchParams(window.location.search).get("plates") : null;
    return v === "0" ? "none" : v === "others" ? "others" : "all";
  } catch {
    return "all";
  }
})();

export function useTrailerHooks(onExit: () => void): void {
  const camera = useThree((st) => st.camera) as PerspectiveCamera;
  useEffect(() => {
    if (!TRAILER_ENABLED) return;
    const w = window as any;
    let path: Keyframe[] = [];
    let raf = 0;
    const styleEl = document.createElement("style");
    styleEl.dataset.ptwTrailer = "1";
    document.head.appendChild(styleEl);
    let hudOff = false;
    let extraHide: string[] = [];
    queueMicrotask(() => renderCss());
    const renderCss = () => {
      // Global chat is ALWAYS hidden in trailer mode, HUD on or off (real players' names, kids play).
      const rules: string[] = ['[data-testid="chat-panel"] { display: none !important; }'];
      // Everything rendered after the R3F canvas wrapper in App.tsx is HUD (GameUI, trade screen, ...).
      if (hudOff) rules.push("div:has(> div > canvas) ~ * { display: none !important; }");
      if (extraHide.length) rules.push(`${extraHide.join(", ")} { display: none !important; }`);
      styleEl.textContent = rules.join("\n");
    };

    const ctx: PathContext = {
      port: (key) => {
        const k = key.toLowerCase();
        const p = useGameState.getState().gameState.ports.find((q) => q.key === k || q.name.toLowerCase() === k);
        if (!p) return undefined;
        return (p as any).dock ?? { x: p.x, z: p.z };
      },
      ship: () => {
        const s = net.getOwnRenderState();
        return { x: s.x, z: s.z, rotationY: s.rotationY };
      },
    };

    const seek = (t: number) => {
      const s = evalPath(path, t, ctx);
      cityDebug.active = true;
      cityDebug.showShip = true;
      cityDebug.fx = s.fx;
      cityDebug.fz = s.fz;
      cityDebug.cam = s.cam;
      cityDebug.look = s.look;
      clientLand.centerOverride = { x: s.fx, z: s.fz };
    };

    w.__trailer = {
      setPath: (p: Keyframe[]) => {
        path = [...p].sort((a, b) => a.t - b.t);
        return pathDuration(path);
      },
      seek,
      play: () =>
        new Promise<void>((resolve) => {
          const t0 = performance.now();
          const dur = pathDuration(path);
          const tick = () => {
            const t = (performance.now() - t0) / 1000;
            seek(Math.min(t, dur));
            if (t < dur) raf = requestAnimationFrame(tick);
            else resolve();
          };
          raf = requestAnimationFrame(tick);
        }),
      stop: () => {
        cancelAnimationFrame(raf);
        cityDebug.active = false;
        cityDebug.showShip = false;
        clientLand.centerOverride = null;
        onExit();
      },
      hud: (show: boolean) => {
        hudOff = !show;
        renderCss();
      },
      hide: (selectors: string[]) => {
        extraHide = selectors;
        renderCss();
      },
      /** Lens: vertical field of view in degrees (game default 80; ~45-55 reads more cinematic). */
      fov: (deg: number) => {
        camera.fov = deg;
        camera.updateProjectionMatrix();
      },
      ship: () => ctx.ship(),
      ports: () => useGameState.getState().gameState.ports.map((p) => p.key),
    };
    return () => {
      cancelAnimationFrame(raf);
      delete w.__trailer;
      styleEl.remove();
      cityDebug.showShip = false;
    };
  }, []);
}
