# World data pipeline (card W2)

This pipeline builds the land, ports, sea lanes and map textures for the wrapping-Earth world. The contract it implements is `docs/world/WORLD_SPEC.md`: §4.1 (the SDF tiles), §5 (ports) and §6 (lanes).

## Regenerate
```
npm run world:build                 # rebuilds and writes every artifact (about 20 s, about 3 GB RAM peak)
npm run world:build -- --check      # rebuilds in memory and validates only; writes nothing
npm run world:build -- --debug      # also writes full-res crops with lanes, towns, docks and spawns
                                    # to scripts/world/.cache/debug_*.png
```
- If Node runs out of memory, prefix the command with `NODE_OPTIONS=--max-old-space-size=8192`.
- The script throws if any validation fails, and in that case writes nothing.
- The output is deterministic: rerunning it on the same inputs gives byte-identical files (verified).
- After a rebuild, run `npm test`. `shared/world/__tests__/data.test.ts` re-checks the committed files.

## Sources and licence
Natural Earth vector data, **public domain** (https://www.naturalearthdata.com/about/terms-of-use/). No attribution is required, but credit is welcome.
- The files come from the GitHub mirror `nvkelso/natural-earth-vector`, pinned to tag **v5.1.2**:
  - `ne_10m_land`
  - `ne_50m_land`
  - `ne_10m_minor_islands`
- They are cached in `scripts/world/.cache/`, which is gitignored.
- Each file's sha256 is pinned in `build-world.ts`. The script warns if a download differs.

## Outputs (all committed)
| File | What | Size |
|---|---|---|
| `client/public/world/land/manifest.json` | spec §4.1 manifest, plus `"encoding":"gzip"` | 2 KB |
| `client/public/world/land/<version>/t_<tx>_<ty>.bin.gz` | 317 Int8 SDF tiles, 256², gzipped | 1.47 MiB (raw would be 19.8 MiB) |
| `client/public/world/map_4096x2048.png` | equirectangular chart texture for the world map | 0.85 MiB |
| `client/public/world/map_1024x512.png` | the same at minimap size | 0.10 MiB |
| `shared/world/ports.json` | 27 ports (spec §5) | 12 KB |
| `shared/world/lanes.json` | 75 lanes (spec §6), 1029 points | 36 KB |
| `shared/world/versions.json` | `{ land, ports, lanes }` short content hashes | — |

- Of the 512 tiles: 143 are all water, 52 are all land, and 317 are stored.
- Only the current `<version>` directory is kept. The script deletes older versions.
- `.gitattributes` keeps these bytes exactly as generated (no CRLF conversion on Windows).

### Tile encoding (clarification to spec §4.1)
The raw tiles would total 19.8 MiB, which is over the 15 MB budget. So they are stored gzipped as `t_<tx>_<ty>.bin.gz`, and the manifest carries `"encoding": "gzip"`.
- When the manifest has `encoding: "gzip"`, the loader appends `.gz` and gunzips: `zlib.gunzipSync` on the server, `DecompressionStream('gzip')` in the browser.
- The decompressed payload is exactly the spec's 65536-byte row-major Int8 tile.
- Without `encoding`, tiles are plain `.bin`.
- Serve the `.gz` files as opaque bytes (`application/octet-stream`). Do NOT set `Content-Encoding`, or the browser would decompress them twice.

## How it works (`scripts/world/`)
- `build-world.ts`: orchestration, tiling, validation, writing, and the `--debug` crops.
- `portDefs.ts`: **the input list of ports** (real lat/lon, nation c. 1700, region) and the named long-haul lanes. Edit this file to add a port, then rebuild.
- `lib/common.ts`: the spec constants and coordinate helpers, duplicated from the spec on purpose (no runtime imports). It also holds `sampleSdf`, the same bilinear sampling as spec §4.2, without the ice.
- `lib/raster.ts`: a scanline rasterizer.
  - A pixel is land when its centre is inside a polygon (even-odd per polygon, so holes work).
  - Natural Earth already splits polygons at ±180°.
- `lib/sdf.ts`: the metric signed distance field.
  - Pass 1 is an exact separable EDT (Felzenszwalb) down columns. Pass 2 runs along rows with east-west spacing `PX·cos(lat of the query row)`.
  - Each row is padded with wrapped columns (up to W/2), so the antimeridian is seamless.
  - Centre-to-centre distance is converted to distance-to-pixel-edge by subtracting the target pixel's half-extent along the direction to it, so the zero crossing lands on pixel boundaries.
  - The result is quantized with `SDF_UNIT = 4`, clamped to ±127, and never 0: water is ≥ 1 and land is ≤ −1.
  - Using the query row's latitude instead of the mean latitude is off by far less than one SDF_UNIT within the ±508 range.
- `lib/ports.ts`: places each port's town, dock and spawn (see below), and builds the ocean-connectivity mask.
- `lib/lanes.ts`: the lane grid, Dijkstra/A*, string pulling and subdivision.
- `lib/map.ts`: the chart renderer: parchment land, an ink coastline, shallow tint and two coastal contour lines, white pack ice beyond ±70°, and a 15° graticule. Ports and labels are left to the client.
- `lib/png.ts`: a pure-JS PNG encoder (node:zlib, with per-row filter choice). There are no native dependencies, and **no new npm dependencies** at all.

## Decisions
- **Detail boxes (1:10m plus minor islands):**
  - Caribbean and Gulf: lon −100…−55, lat 5…33
  - Europe, the Mediterranean and the Baltic: lon −15…45, lat 30…66
  - West Africa: lon −26…16, lat −8…30

  Everywhere else uses 1:50m. Land is chosen per pixel by box membership.
- **Inland water:** the Caspian, and lakes that Natural Earth cuts as holes, stay water in the SDF. They are unreachable, so docks, spawns and lanes avoid them through the ocean mask.
- **Ocean mask:** a 4-connected flood from the mid-Atlantic over pixels with sdf ≥ 100, inside the ice band. Docks and spawns must lie in it.
- **Port placement**, measured by metric distance from the real coordinates:
  - **dock:** the nearest ocean-mask pixel with 100 ≤ sdf ≤ 400.
  - **town:** the real site if its bilinear sdf is in [−300, −10] and it is ≤ 700 from the dock. Otherwise, the nearest land pixel with sdf in [−200, −20] that is ≤ 500 from the dock.
    - Seville (moved 444 units to the Guadalquivir mouth), London (284, the Thames estuary) and Bristol (362, the Severn) moved. Their rivers are narrower than a 4.9 km pixel.
    - Every other port moved less than 60 units.
  - **spawn:** the nearest ocean-mask pixel to the dock with sdf ≥ 160.
- **Lanes:**
  - **Grid:** 2×2 pixels per cell (about 97.7 units). A cell's clearance is the min of its 4 pixels.
    - A cell is passable if clearance ≥ 100.
    - Within 2500 units of any dock, clearance ≥ 80 is enough, for harbour approaches.
    - Cells within 100 of an ice line are blocked. x wraps.
  - **Search:** 8-connected, metric step cost.
    - "4 nearest by sea" is a Dijkstra from each dock that stops after 4 other docks are settled.
    - The named lanes use A*.
    - Pairs are deduplicated, and `from` is the id that sorts first.
  - **Smoothing:** greedy line-of-sight string pulling. Each candidate segment is sampled every 20 units and must keep (clearance − 10) on the bilinear field. Legs longer than 4000 units are then split on the same line, so NPC steering stays close to the checked segment.
  - **Endpoints:** `points[0]` is the `from` dock and the last point is the `to` dock. x is unwrapped, so consumers wrap.
  - **Named lanes:**
    - lisbon–bridgetown and cadiz–san_juan (Iberia to the Caribbean)
    - london–boston
    - cadiz–cape_town, cape_town–goa, goa–batavia, batavia–macau (the Cape route)
    - cartagena–havana and havana–seville (the treasure fleet)
    - acapulco–manila (the Manila galleon, a bonus)
- **Validation**, in the script and repeated by the vitest test:
  - Known samples: mid-Atlantic, Madrid, Gibraltar, Jamaica, Panama, the English Channel, Cuba and the Pacific.
  - Port distances.
  - Every port is reachable from Port Royal on the lane graph.
  - Lane clearance: the minimum observed is 72. The test asserts ≥ 60.
  - The test also checks that the manifest and tile set agree, that every tile is 65536 bytes, that the Panama isthmus is closed on every meridian from −80 to −77.6, and that values are continuous across the antimeridian.

## Known limits
- **Resolution:** at 4.9 km per pixel, straits narrower than about 10 km close. Gibraltar stays open, but its sdf at the narrows is only about 38, so lanes don't use it. No lane needs the Mediterranean today.
- **Near the poles:** beyond about |lat| 85° the row padding caps at W/2 columns. Values there are approximate, but they are inside the impassable ice anyway.
