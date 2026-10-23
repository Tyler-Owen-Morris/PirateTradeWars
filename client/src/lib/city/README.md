# Port-city kit

Procedural, data-driven low-poly towns for the 27 ports (and the coming expansion). One generic
look per **city type** (style), plus a **small per-city entry** for well-known landmarks. Everything
here is framework-free and deterministic (seeded by the port key) except `cityMaterial.ts`
(three.js shader) and the React component `components/game/PortCity.tsx`.

| File | What it does |
|---|---|
| `styles.ts` | The style table (`STYLES`), nation → style (`STYLE_BY_NATION`), all style fields documented on `CityStyle`. |
| `cities.ts` | `CITY_CUSTOM[port.key]`: per-city tweaks (style override, size, fort side/where/scale, landmark scale, extras, field overrides). |
| `pieces.ts` | The pieces: houses (+ roofs: gable/hip/flat/tiered/shed/stepgable/bellgable), warehouse, landmarks, forts, cannons, ramparts, boats/ships, careened ship, gallows, lighthouse, round tower, Belém tower, facade, keep, windmill, trees, flags. `EXTRA_PIECES` registry. |
| `layout.ts` | `buildCity(input, site)`: places everything on the real coast and returns three merged layers. |
| `site.ts` | `makeCitySite` (terrain SDF + height around a town, local metric), `flatCoastSite` (no-land fallback), `cityInputFor(port)`. |
| `meshBuilder.ts` | Tiny flat-shaded triangle builder with frames (push/pop), auto-fixed winding, sRGB vertex colours. |
| `cityMaterial.ts` | One shader program for every city: WORLD_SPEC §7 render transform per vertex (like the terrain), terrain lighting, fog, flag waving. |

## How a town is laid out (`layout.ts`)
1. Coast point **C** on the line town → dock, seaward normal **n**, tangent **t**. Streets run along the coast.
2. Waterfront: stone quay along the coast (timber for pirates), 1–3 piers into the water with boats moored
   alongside, warehouses behind the quay, a flag on the quay, and a mooring float at the dock point.
3. Plaza and the style's **landmark** inland of the quay; the **fort** at the harbour mouth (the more seaward
   side of the quay, or `fortSide`), or on the highest ground (`fortWhere: "highpoint"`).
4. **Extras** (style + city): `where` = `outskirts` | `highpoint` | `coast` | `mouth` (opposite the fort) |
   `plaza` | `water` (offshore). Anything that does not fit falls back to the edge of town.
5. Optional **ramparts** (`cityWalls`); walled towns stay inside them.
6. **Houses** on the street grid, nearest-to-the-plaza first, only on land and not on steep ground; narrow
   land (thin islands) relaxes the margins; pirate shacks may stand on stilts in the shallows.
7. **Trees** by latitude (`trees: "auto"`: palms < 26°, conifers creep in > 38°), palms along tropical beaches.

An occupancy grid (4-unit cells) keeps pieces from overlapping. `stats.placed` / `stats.missed` list which
pieces made it; `CITY_REPORT=1 npx vitest run client/src/lib/city` prints houses/trees/triangles/pieces for
every port on the real land data.

## Layers, LOD and performance
- `main` (bodies, roofs, landmarks, forts, quay, piers, boats, trees), `detail` (windows, doors, shutters,
  chimneys, cannons, bollards, piles — hidden beyond `DETAIL_DISTANCE`), `flags` (waving, double-sided).
- One BufferGeometry per layer per city, one material program for all cities ⇒ **3 draw calls per city**.
- Budget: keep a city under ~25k triangles (test asserts < 40k). Today 6–18k.
- Build cost 3–20 ms, once, when the town comes within `BUILD_DISTANCE`; CPU builds are cached (LRU 6),
  GPU geometry disposed beyond `DISPOSE_DISTANCE`. No per-frame work beyond two uniforms.
- Geometry is stored in town-local x-**units** (metric x ÷ metricX at the town) and metric z; the shader maps
  it to render space exactly like the terrain chunks, so towns sit on the terrain without drift or jitter.

## Adding a style (e.g. `russian_timber`, `ottoman`, `chinese`, `japanese`, `arctic_trading_post`)
1. Copy the closest entry in `STYLES` (`styles.ts`) and change colours, roof kinds, house sizes, density,
   landmark, fort, trees, extras. Most new looks are **data only**.
2. If it needs a new silhouette, add one small case in `pieces.ts`:
   - roof: a `RoofKind` + a case in `roof()` (e.g. `"onion"`-domed or `"hipgable"` irimoya);
   - house body: a `HouseKind` + a branch in `house()` (e.g. `"log"` walls with notched corners);
   - landmark: a `LandmarkKind` + a case in `landmark()` (e.g. `"onion_church"`, `"mosque"` with a `"minaret"`);
   - fort: a `FortKind` + a case in `fort()`;
   - anything else: a function `(ctx, x, z, yaw, scale) => topY` registered in `EXTRA_PIECES`.
   Pieces write into `ctx.main` / `ctx.detail` / `ctx.flags` with `box`, `prism`, `hip`, `gable`, `shed`,
   `dome`, `extrude`, `segment`, `decal`, `poly`/`poly2`; keep each to a few hundred triangles.
3. Map ports to it: a nation entry in `STYLE_BY_NATION`, a region rule in `styleIdForPort`, or `style` in
   `cities.ts` for single ports. Add a flag pattern in `flagCell` for a new nation.
4. Check it: `/?citydebug=1&citygallery=1&citystyle=<id>` (whole town on a straight coast) and the
   piece gallery `/?citydebug=1&citygallery=1`; then `__cityCam("<port>")` in the game. The unit test builds
   every style, so it is covered automatically.

## Customising a city (`cities.ts`)
```ts
havana: {
  size: 1.2,                                   // radius/house-count multiplier
  tweak: { fort: "morro", landmark: "bell_tower" }, // any CityStyle field
  fortScale: 1.25,                             // fortSide: 1 | -1, fortWhere: "highpoint"
  landmarkScale: 1,
  extras: [{ piece: "fort_star", where: "coast", scale: 0.7 }],
  note: "El Morro at the harbour mouth; La Fuerza on the quay; baroque cathedral.",
},
```
Keep entries small: one or two signature pieces. Look at the result with `__cityCam("havana", {dist: 300, height: 95, yaw: 30})`.
