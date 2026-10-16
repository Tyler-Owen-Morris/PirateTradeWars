# World spec: the wrapping Earth (contract for all world and NPC cards)

Approved by Theo on 2026-10-16. The full rationale is in `docs/proposals/WORLD_AND_NPCS.md`, and the build ledger is `docs/world/BUILD_STATE.md`.

**This file is the contract.** If a card needs to change it, the card stops and reports to the producer; it does not change the contract silently. Any clarifications go in a dated block at the bottom.

## 1. Decisions
- Approach C+: x (longitude) wraps; z (latitude) is closed by polar ice; movement uses the sphere metric.
- Scale: circumference **C = 400,000 units**, about a 20-minute lap of the equator at average speed. 1 unit ≈ 100 m.
- The whole globe is open, with real-world land (continents plus islands), no-damage land collision, and coastal ports at real cities.
- Everything ships in **one** production deploy at the end. Until then every commit carries `[skip ci]`.

## 2. Coordinates (`shared/gameConstants.ts` and `shared/world/geo.ts`)
```
WORLD_C   = 400_000            // MAP_WIDTH  (x wraps in [0, C))
WORLD_H   = 200_000            // MAP_HEIGHT (z in [0, H]; z = 0 is the north pole, H is the south pole)
WORLD_R   = C / (2π)           // ≈ 63_661.98
ICE_LAT   = 70                 // degrees; |lat| > 70 is impassable pack ice
Z_ICE_N   = H * (90 - 70) / 180   // ≈ 22_222.2
Z_ICE_S   = H * (90 + 70) / 180   // ≈ 177_777.8
lon(x) = x / C * 360 - 180             x(lon) = (lon + 180) / 360 * C
lat(z) = 90 - z / H * 180              z(lat) = (90 - lat) / 180 * H
metricX(z) = cos(lat(z))               // east-west scale factor; at least cos(70°) ≈ 0.342 in play
```
- North is −z. Physics is unchanged: forward is negative velocity, so with `rotationY = 0` and v < 0, z decreases (north).
- **Compass heading, clockwise from north, in degrees** = `normalize(-rotationY) * 180/π` mapped to [0, 360).
- The old 10000×10000 torus and all of its constants are retired.

## 3. Motion and distance (`shared/physics.ts`)
- `velocity` is a **ground (metric) speed** in units per 1/60 s frame, unchanged from today.
- Integration, per substep:
  ```
  z += cos(rotationY) * velocity
  x += sin(rotationY) * velocity / metricX(z)
  ```
  x is wrapped to [0, C). There is no z wrap.
- **Metric delta** between a and b, used for every gameplay distance:
  ```
  dx = wrappedDelta(a.x, b.x, C) * cos(lat((a.z + b.z) / 2))
  dz = b.z - a.z
  ```
  This covers interest radius, hit tests, gold pickup, port radius, NPC sensing, the minimap, and so on. Exported as `metricDelta(ax, az, bx, bz)` and `metricDistSq(...)`.
- **Cannonballs** move the same way: speed is metric and x is divided by metricX. Hits use metric distance.
- **The spatial grid becomes sparse** (a `Map` of non-empty cells). Cells are in coordinate space, `GRID_CELL = 500`. A query of metric radius r covers `r / metricX(z)` in x, with metricX evaluated at the query edge nearest the pole for safety, and r in z.
- Wire format is unchanged: positions are rounded to 0.1 and go in the same EntityRow. x up to 400000.0 is fine in JSON.

## 4. Land (`shared/world/land.ts`, data in `client/public/world/`)
### 4.1 Canonical data: the signed distance field (SDF)
- A global raster of **8192 × 4096** pixels. Pixel size is **PX = C / 8192 = 48.828125** coordinate units in both x and z.
- Pixel (i, j) has its centre at `x = (i + 0.5) * PX`, `z = (j + 0.5) * PX`.
- Value: **Int8 = clamp(round(d / SDF_UNIT), −127, 127)**, where **SDF_UNIT = 4**. d is the **metric** distance to the nearest coastline: positive in water, negative on land. This gives a range of about ±508 units.
- Land comes from Natural Earth land polygons (public domain): 1:10m in boxes covering the Caribbean and Gulf, Europe and the Mediterranean, and West Africa; 1:50m elsewhere. The union of those defines land.
- **Tiles:** 256 × 256 pixels, so 32 × 16 tiles. Tile (tx, ty) covers pixels `i ∈ [tx*256, tx*256+256)`, `j ∈ [ty*256, ty*256+256)`.
  - File: `client/public/world/land/<version>/t_<tx>_<ty>.bin`, raw Int8 row-major, exactly 65536 bytes.
  - Manifest: `client/public/world/land/manifest.json` = `{ version, width, height, tile, px, sdfUnit, iceLat, allWater: ["tx_ty", …], allLand: [...] }`.
  - `allWater` tiles (every value 127) and `allLand` tiles (every value −127) need not be fetched.
  - `version` is a short content hash. Vite copies `client/public` to `dist/public`, and the server reads the tiles from there, or from `client/public` in dev.

### 4.2 Sampling API (one implementation, used by server, client prediction, NPCs and rendering)
```ts
export interface LandQuery {
  /** Metric signed distance (units) at (x,z): + water, − land. Includes the polar ice:
   *  result = min(sdf(x,z), metric distance to the nearest ice line), where the ice line is z=Z_ICE_N / z=Z_ICE_S. */
  distance(x: number, z: number): number;
  /** Unit gradient (pointing toward water), central differences of distance(), metric. */
  normal(x: number, z: number): { nx: number; nz: number };
  /** True if every tile needed around (x,z) within `radius` is loaded (client may lack tiles). */
  ready(x: number, z: number, radius: number): boolean;
}
export class LandField implements LandQuery { constructor(source: TileSource) … }
export interface TileSource { get(tx: number, ty: number): Int8Array | 'water' | 'land' | undefined }
```
- Sampling is bilinear over pixel centres. i wraps modulo 8192; j is clamped to [0, 4095].
- A missing tile (`undefined`, i.e. still loading on the client) is treated as water, and `ready()` reports false.
- **Server:** preloads every tile at boot, synchronously, before the loop starts, which is about 32 MB.
- **Client:** fetches tiles within about 2 tiles of the ship, plus a prefetch ring.
- `ALWAYS_WATER_TEST_FIELD` and a synthetic test field builder are exported for unit tests.

### 4.3 Collision (inside `stepShip`, no damage)
- `ShipPhysicsStats` gains `hullRadius`: sloop 12, brigantine 16, galleon 22, man-o-war 26, dreadnought 30.
- `stepShip(state, input, stats, land?: LandQuery)`. After integrating each substep:
  ```
  d = land.distance(x, z)
  if d < hullRadius:
     n = land.normal(x, z)
     push the ship out along n by (hullRadius − d)   // metric; convert x by / metricX
     vn = component of the velocity vector along −n
     if vn > 0: remove it from velocity (slide)
  ```
  Velocity stays a scalar along the heading, so "remove the into-land component" means `velocity *= max(0, |cos(angle between heading and the coast tangent)|)`. The ship keeps its heading. No damage and no event.
- Deterministic: there is no randomness. The client passes the same `LandField`. If the client's `ready()` is false near the ship, it still steps (treating the missing tiles as water) and reconciliation corrects it.
- Cannonballs whose new position has `distance < 0` are removed, and the server emits a `splash` event with `{x, z, land: 1}`. Clients may render dust.
- **Spawn and respawn** always go to a port's `spawn` point (§5) with jitter, retrying until `distance > 60`.

## 5. Ports (`shared/world/ports.json`, generated with the land data)
```
[{ "id": "port_royal", "name": "Port Royal", "lat": 17.94, "lon": -76.84,
   "nation": "england" | "spain" | "france" | "portugal" | "netherlands" | "pirates",
   "region": "caribbean" | "north_atlantic" | "europe" | "africa" | "indian_ocean" | "east_asia" | "americas_pacific",
   "x": …, "z": …,              // the town itself: on land, near the coast
   "dock": { "x": …, "z": … },  // the harbour point in water with distance > 80, ≤ 400 from the coast near the town
   "spawn": { "x": …, "z": … }, // water with distance > 150, used for player spawn
   "safeRadius": 600 }]
```
- About 25 ports: the Caribbean and Gulf heavily (≥ 10), plus the North Atlantic coast, Europe, West and South Africa, the Indian Ocean and East Asia. Include Port Royal, Havana, Cartagena, Veracruz, Nassau, Tortuga, Bridgetown, Charleston, Boston, Lisbon, Cádiz, Seville, London, Bristol, Amsterdam, Cape Town, Goa, Batavia and Macau.
- **Port interaction** (trade, upgrade, repair) is allowed when the metric distance from the ship to `dock` is ≤ `PORT_INTERACTION_RADIUS = 300`. The server is authoritative, and **trade now also checks distance**.
- Redis: `ports` is re-seeded when a stored `portsVersion` ≠ the generated version. Player records whose saved position is in the old world format (no `worldVersion`) or on land are relocated to a starter port's spawn.

## 6. Sea lanes (`shared/world/lanes.json`, generated)
- For each port: routes to its 4 nearest ports by sea. Plus named long-haul lanes:
  - Lisbon/Cádiz to the Caribbean
  - London to Boston
  - Cádiz to Cape Town to Goa to Batavia to Macau
  - Cartagena to Havana to Seville (the treasure fleet)
- Computed offline by A* on a coarse water grid that requires clearance of at least 100 units, then simplified.
- Format: `[{ from, to, points: [[x,z],…] }]`. x is unwrapped along the route, so consecutive points differ by less than C/2; consumers wrap.

## 7. Rendering: floating origin (client)
- The scene origin is the camera focus F (your own predicted ship). Every world object at (x, z) is drawn at:
  ```
  rx = wrappedDelta(F.x, x, C) * metricX(z)
  rz = z − F.z
  ```
  This applies to ships, balls, gold, ports, terrain vertices (in the vertex shader, via uniforms) and effects. Using `metricX(z)` per object or vertex, not at F, keeps rendered contacts consistent with physics.
- The ocean is a camera-following plane. Wave and noise patterns are sampled in rendered space.
- No object is ever drawn at raw coordinates, so the wrap seam is invisible and float32 precision is fine.
- The polar ice is a visible ice-shelf wall plus pack ice at the ice lines.

## 8. NPCs (`server/game/npc/`)
- An NPC is a `WorldPlayer` with `controller: 'npc'`. It has no socket, it is never "disconnected", it is never written to Redis, and it is never on the leaderboard.
- Its AI writes the same `{th, ru, f}` input each tick as a player would.
- The `ent` message gains optional `npc: 1`, `faction: string` and `title: string`.
- Faction ids: `england`, `spain`, `france`, `portugal`, `netherlands`, `pirates`, `merchants_guild`. Phase 1 uses a static relation matrix (lawful nations vs pirates) and per-player rep, stored in Redis with the player.
- The design, archetypes, LOD tiers, threat table and fair-play rules are in `docs/proposals/WORLD_AND_NPCS.md` §3. Treat them as requirements.
- Budget: 300 NPCs persistent, ≤ 80 active. The **tick must stay < 25 ms at 200 bots + 300 NPCs** in the load test.

## Clarifications (append dated entries below)
- 2026-10-16 (W2):
  - Tiles are stored gzipped, as `t_<tx>_<ty>.bin.gz`, and the manifest has `"encoding":"gzip"`. Each tile decompresses to 65,536 bytes. They are served as plain bytes with no Content-Encoding. Loaders must support both encodings.
  - Docks are 80–400 units from the coast, and a town is within 800 units of its dock.
  - Seville, London and Bristol were moved 284–444 units toward their estuaries, because the real rivers are narrower than one pixel.
  - Lanes need only 80 units of clearance within 2,500 units of a dock.
  - There are 27 ports.
  - `shared/world/versions.json` holds the content hashes; use the ports hash as `portsVersion`.
- 2026-10-16 (producer, after Q1 B1): the §4.3 slide is too strong. Applying the cosine factor on every substep compounds it 180 times a second, so a 45° glancing hit leaves about 0.1× speed. **Intent:** a glancing hit keeps the tangential speed. Clamp `|velocity|` to at most `maxSpeed·sqrt(1 − hn²)` once per contact, where hn = cos(angle between heading and the coast normal). Don't multiply per substep. A head-on hit still ends near 0.
