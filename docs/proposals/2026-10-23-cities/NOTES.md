# Port cities upgrade: progress notes (2026-10-23)

Branch `worktree-agent-a66e927ba30cbb679` (based on `dev/2026-10-23-batch`). The kit is in `client/src/lib/city/`
(see the README there), and the component is `client/src/components/game/PortCity.tsx`. Docs are in
`client/CLIENT_CONTEXT.md` under "Port cities".

## How to resume
1. `PORT=5089 REDIS_CONN_STRING=redis://localhost:6379 STRIPE_SECRET_KEY=sk_test_dummy npm run dev`
2. Open `http://localhost:5089/?citydebug=1`, join, then run `__cityCam("havana", {dist: 300, height: 95, yaw: 30})`
   in the console. `__cityCam(null)` goes back to the ship.
3. Piece gallery: `http://localhost:5089/?citydebug=1&citygallery=1`. Add `&citystyle=dutch` to see a whole town in one style.
4. Stats for every port, no browser needed: `CITY_REPORT=1 npx vitest run client/src/lib/city`.
5. Per-city tweaks go in `client/src/lib/city/cities.ts`. Update the table below when you change one.

## Status
- [x] Kit: mesh builder, styles, pieces, layout, shader placement (terrain-exact), LOD and caching, dev camera, gallery.
- [x] City-by-city pass: all 27 ports have a style and a `cities.ts` entry, and were checked visually at the approach view.
- [ ] Ideas for later: canals in Dutch towns; a pentagonal star fort (Acapulco, Cape Town); harbour chains;
      night window lights; real anchors for towns whose land is tiny in the land data (Nassau, Bridgetown,
      Saint-Pierre sit on small islets at this resolution).

| Port | Style | Status | Signature (cities.ts) |
|---|---|---|---|
| port_royal | english | done | Fort Charles (bastion battery), brick + whitewash, palms, merchantman at anchor |
| havana | spanish_colonial | done | El Morro (stepped fortress + lighthouse) at the harbour mouth; La Fuerza (small star fort) by the quay; bell-tower cathedral |
| cartagena | spanish_colonial | done | City ramparts with towers; San Felipe (star fort) on the high point |
| veracruz | spanish_colonial | done | Mostly flat roofs; San Juan de Ulúa star fort |
| nassau | pirate_haven | done | Shacks (some on stilts), palisade fort, Fort Nassau battery, gallows, careened ship, 4 pirate ships at anchor. The town sits on a tiny islet in the land data, so it has only ~11 shacks |
| tortuga | pirate_haven | done | Fort de Rocher (bastion) on the hillside high point, shacks, gallows, careened ship |
| bridgetown | english | done | Pastel and coral-stone mix, harbour light, St Ann's battery |
| san_juan | spanish_colonial | done | El Morro at the bay mouth, city walls, colourful houses |
| willemstad | dutch | done | Pastel Handelskade gables, palms instead of windmills, Fort Amsterdam (star) |
| saint_pierre | french | done | Tile roofs, twin-towered cathedral, battery |
| charleston | english | done | Rainbow Row pastels, white steeple |
| boston | english | done | Brick and clapboard, steeple, mixed trees, merchantman |
| lisbon | portuguese | done | Belém Tower at the river mouth, São Jorge castle on the height, no generic fort |
| cadiz | spanish_colonial | done | White, mostly flat-roofed; golden-domed cathedral |
| seville | spanish_colonial | done | Torre del Oro on the river; Giralda (bell tower at 1.5× scale); no sea fort |
| london | english | done | St Paul's dome, the Tower (keep) on the river, 6 warehouses, no fort |
| bristol | english | done | Brick warehouses, gothic cathedral tower, merchantman |
| amsterdam | dutch | done | Step- and bell-gabled canal houses, Westerkerk-style tower, 4 windmills |
| saint_malo | french | done | Granite town inside its ramparts, gothic spire, battery |
| elmina | portuguese (override; Dutch flag) | done | Great white castle (1.5×) on the point, Coenraadsburg battery on the hill, palms |
| cape_town | dutch | done | Whitewashed Cape Dutch bell-gable houses, Castle of Good Hope (star), windmill |
| sainte_marie | pirate_haven | done | Stockade, shacks, careened ship, 3 pirate ships |
| goa | portuguese | done | Laterite Bom Jesus facade by the plaza, Aguada light, palms |
| batavia | dutch | done | Plastered tropical canal town, Kasteel (star), windmill |
| macau | portuguese | done | São Paulo facade on the hill, Guia light, temple pagoda, some tiered roofs |
| manila | spanish_colonial | done | Intramuros walls, Fort Santiago (star), tiered roofs mixed in |
| acapulco | spanish_colonial | done | Fort San Diego (star), Manila galleon at anchor |

## Performance (headless Chromium, D3D11 GPU, 1280×720)
Same views before and after, `__ptwRenderInfo()`, with frames measured uncapped (`--disable-gpu-vsync`).
Full numbers are in `perf-before.json` and `perf-after.json`.
- **Draw calls for the visible ports** (all ports mounted minus all unmounted): before 60–80, after 6–20.
  Each city is 3 calls (main, detail, flags); the rest are labels, the dock ring and the prompt text.
- **Whole-scene draw calls** at the same view: Havana 154 → 90, Port Royal 126 → 46, London 244 → 196.
- **Triangles per city:** 3.3k (pirate islets) to 17k (Amsterdam), 280k for all 27 together. Only cities
  within draw range are built, so usually 1–2 at a time. The old towns were about 2k triangles each.
- **Frame time (uncapped average):** Havana 2.76 → 1.50 ms, Amsterdam 3.14 → 1.81 ms, London 3.87 → 2.30 ms,
  Port Royal 2.48 → 0.96 ms, Elmina 2.49 → 1.65 ms. Other ships (NPCs) add noise to these numbers.
- **Build time:** 3–22 ms once per city when it comes within 3,200 units (Cartagena, with its walls, is the
  slowest). Only one city is built per frame.

## Screenshots (this folder)
- `before-*.jpg` / `after-*.jpg`: Havana, Amsterdam, Nassau, London, Port Royal and Elmina from the sea
  (`__cityCam(key)` defaults: 650 out, 200 up). The "after" shots hide the dock ring and prompt (debug camera).
- `close-*.jpg`: 12 towns at 300 out, 95 up, 30° orbit.
- `gallery-*.jpg`: the piece gallery.
