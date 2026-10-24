// Carved channels (New Horizons phase 2, 2026-10-24). Some straits a port sits behind are narrower than
// the 4.9 km raster can hold open, so the build turns land pixels into water along a polyline before the
// SDF is computed (scripts/world/lib/raster.ts `carveChannel`). Each entry is [lon, lat] waypoints down the
// middle of the real strait and a half-width in metric units (1 unit = 100 m). The half-width is chosen so
// the centre line reaches sdf >= 100 (the ocean-mask flood threshold and the open-sea lane clearance).
//
// This CHANGES THE LAND TILES (a new land version): keep the list short and document every entry in
// docs/world/DATA_PIPELINE.md "Carved channels".
export interface Channel {
  name: string;
  /** [lon, lat] waypoints down the strait. */
  points: [number, number][];
  /** Metric half-width of the carved water (units). */
  halfWidth: number;
}

export const CHANNELS: Channel[] = [
  {
    // The Sound: Kullen -> Helsingør/Helsingborg (4 km in reality, 1-2 pixels in the raster) -> past
    // Copenhagen and Malmö -> Falsterbo. Without it the whole Baltic is a lake at lane clearance.
    name: "Øresund",
    points: [[12.25, 56.22], [12.62, 56.04], [12.7, 55.88], [12.75, 55.7], [12.8, 55.5], [12.85, 55.35], [12.92, 55.27]],
    halfWidth: 150,
  },
  {
    // The St. Lawrence from the open estuary (Pointe-des-Monts side) up to Île d'Orléans below Québec. The
    // 1:50m river is open water but only 1-3 pixels at sdf >= 100, on a diagonal the 2x2 lane cells cannot
    // follow; the real estuary is 20-25 km wide as far up as Kamouraska, so the carve mostly straightens it.
    name: "St. Lawrence",
    points: [[-68.2, 49.1], [-69.0, 48.5], [-69.7, 48.0], [-70.1, 47.6], [-70.5, 47.3], [-70.95, 46.9]],
    halfWidth: 150,
  },
];
