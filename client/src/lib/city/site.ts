/**
 * Glue between the world and the city kit: a CitySite (local metric sdf + terrain height) for a port,
 * and the local<->world conversion. Framework-free.
 */
import { metricX, wrap, wrappedDelta, WORLD_C } from "@shared/world/geo";
import { terrainHeight } from "@/lib/world/terrainHeight";
import type { CitySite } from "./pieces";
import type { CityInput } from "./layout";

export interface SdfSource {
  sdf(x: number, z: number): number;
}

export interface CityPortLike {
  key?: string;
  name: string;
  id?: number | string;
  x: number;
  z: number;
  nation?: string;
  region?: string;
  lat?: number;
  dock?: { x: number; z: number };
}

/** Terrain around town (tx, tz) in local metric coordinates. Heights match the terrain chunks. */
export function makeCitySite(field: SdfSource, tx: number, tz: number): CitySite {
  const m0 = metricX(tz);
  return {
    sdf: (x, z) => field.sdf(wrap(tx + x / m0, WORLD_C), tz + z),
    height: (x, z) => {
      const wx = wrap(tx + x / m0, WORLD_C), wz = tz + z;
      return terrainHeight(field.sdf(wx, wz), wx, wz);
    },
  };
}

/**
 * Fallback site when there is no land data (tests / missing manifest): a straight coast 60 units
 * from town toward the dock, gentle slope inland.
 */
export function flatCoastSite(dock: { x: number; z: number }): CitySite {
  const l = Math.hypot(dock.x, dock.z) || 1;
  const ux = dock.x / l, uz = dock.z / l;
  const sdf = (x: number, z: number) => x * ux + z * uz - 60;
  return {
    sdf,
    height: (x, z) => {
      const d = sdf(x, z);
      return d >= 0 ? -10 - d * 0.25 : -10 + Math.min(3, -d * 0.075) + Math.max(0, -d - 40) * 0.08;
    },
  };
}

/** City input (key, climate, local dock) for a port. */
export function cityInputFor(port: CityPortLike): CityInput {
  const key = (port.key ?? String(port.id ?? port.name)).toLowerCase();
  const m0 = metricX(port.z);
  const dock = port.dock ?? { x: port.x, z: port.z + 200 };
  return {
    key,
    name: port.name,
    nation: port.nation,
    region: port.region,
    lat: port.lat ?? 90 - (port.z / 200_000) * 180,
    dock: { x: wrappedDelta(port.x, dock.x, WORLD_C) * m0, z: dock.z - port.z },
  };
}
