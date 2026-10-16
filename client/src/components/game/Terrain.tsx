/**
 * Land terrain chunks + polar ice, drawn in floating-origin render space.
 * Logic lives in lib/world/terrain.ts (TerrainManager: chunk choice, LOD, time-sliced builds,
 * disposal, per-chunk render-space uniforms) and lib/world/ice.ts (PolarIce). This component only
 * owns their lifetimes and calls `update` once per frame after Player.tsx has set the focus.
 * Land data comes from `clientLand` (lib/world/landTiles.ts, loaded by the net layer around the ship).
 * Add `?terrainStats=1` to the URL to log build stats every 2 s.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { clientLand } from "@/lib/world/landTiles";
import { renderFocus } from "@/lib/world/renderSpace";
import { TerrainManager } from "@/lib/world/terrain";
import { PolarIce } from "@/lib/world/ice";

export function Terrain() {
  const terrain = useMemo(() => new TerrainManager(clientLand.field), []);
  const ice = useMemo(() => new PolarIce(), []);
  const statsAt = useRef(0);
  const logStats = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("terrainStats"), []);

  useEffect(
    () => () => {
      terrain.disposeAll();
      ice.dispose();
    },
    [terrain, ice],
  );

  useFrame(({ camera }) => {
    if (!renderFocus.valid) return;
    terrain.update(renderFocus.x, renderFocus.z, clientLand.version);
    ice.update(renderFocus.x, renderFocus.z);
    if (logStats) {
      const now = performance.now();
      if (now - statsAt.current > 2000) {
        statsAt.current = now;
        const c = camera.position;
        console.log("[terrain]", {
          ...terrain.stats,
          focus: [Math.round(renderFocus.x), Math.round(renderFocus.z)],
          cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
        });
      }
    }
  });

  return (
    <>
      <primitive object={terrain.group} />
      <primitive object={ice.group} />
    </>
  );
}
