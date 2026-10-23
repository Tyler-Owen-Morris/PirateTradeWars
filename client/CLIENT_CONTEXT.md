# Client Architecture - Pirate Trade Wars

## Overview
The client is a React application using Three.js for 3D rendering. It handles game rendering, user input, UI components, and WebSocket communication with the server.

## Directory Structure

- `/public/` - Static assets
- `/src/` - Source code
  - `/components/` - React components
    - `/game/` - 3D game components (ships, ocean, etc.)
    - `/ui/` - User interface components
  - `/hooks/` - Custom React hooks
  - `/lib/` - Utility functions and state management
    - `/stores/` - Zustand stores
  - `/pages/` - Page components
  - `/types/` - TypeScript type definitions
  - `App.tsx` - Main application component
  - `main.tsx` - Application entry point

## State Management

The game uses Zustand for state management with several stores:

1. **useGameState.ts** - Core game state store
   - Tracks player state, other players, ports, goods, inventory, etc.
   - Manages viewport dimensions and game status
   - Updates on WebSocket messages from server

2. **useShip.ts** - Ship selection and registration
   - Manages ship selection UI
   - Handles player registration via WebSocket

3. **useSocket.ts** - WebSocket connection management
   - Establishes and maintains WebSocket connection
   - Sends player input and trade requests
   - Handles reconnection logic

4. **useAudio.ts** - Sound management
   - Controls game sound effects and music
   - Manages audio muting state

## Key Components

### Game Components (3D)
- `GameScene.tsx` - Main Three.js scene container
- `Player.tsx` - Player ship rendering and controls
- `OtherShips.tsx` - Renders other players in the game
- `Ocean.tsx` - Water rendering
- `CannonBall.tsx` - Projectiles
- `Port.tsx` / `Ports.tsx` - real-world ports (card W4), see "Ports (W4)" below

### UI Components
- `TradeMenu.tsx` - Trading interface for ports
- Ship selection screens
- Game status indicators and HUD
- Damage indicators and ship status

## Navigation UI (card W5)
All maths is pure and tested in `client/src/lib/nav.ts` (`lib/__tests__/nav.test.ts`); components only draw. It uses `shared/world/geo.ts` (`metricDelta`, `metricDist`, `bearingDeg`, `compassHeading`, `lonOf`/`latOf`) - never raw x deltas.
- `ui/Minimap.tsx`: north-up, centred on the player. Radius (world units centre-to-edge) defaults to 6000 (1 unit = 100 m, so 600 km), +/- halve/double (1500..24000). The caption is the full span, `minimapSpanLabel(radius)` = "1200 km across" at the default (F1/Q1 B4: it used to print the radius as "Edge = 600 km"). Land is drawn from the SDF tiles already loaded around the ship (`clientLand`) by `lib/world/minimapLand.ts` (2026-10-16 fix: the 1024 texture is ~390 units/px, so zoomed in it showed as big blurred blocks): chart colours like the world map texture, coast anti-aliased over one device px, and below one SDF px per output px it blurs the SDF under the view (~1 SDF px) so coasts read as curves, not 49-unit stair-steps. `MinimapLandLayer` keeps a 1.5x offscreen buffer and only re-renders (~5-10 ms at dpr 2) when the ship has moved far, the zoom changes or a tile arrives (`clientLand.version`). Pixels on unloaded tiles stay transparent over the old texture backdrop, drawn row by row from `/world/map_1024x512.png` (no graticule since F1) via `minimapRow` (each row spans +-radius/metricX(z) x-units, split in two across the x seam). The canvas is backed at devicePixelRatio (capped at 3). Ports (nation-coloured, at their dock), ships/NPCs (`otherPlayers`), heading arrow, highlighted target port.
- `ui/WorldMap.tsx`: full-screen canvas over `/world/map_4096x2048.png`. Opened by `M` or the "Map" button in the compass HUD (GameUI owns the toggle; Esc closes). View = `{cx, cz, k}` (k = px per world unit, same on both axes); drag pans with x wrap, wheel/pinch zoom about the cursor, clicking a port (no drag) calls `setNavTarget(port.id)`. Draws 30 degree grid, +-70 degree ice lines/shading, ports and names, player arrow.
- `ui/CompassHUD.tsx` (top centre): heading tape + `deg + cardinal`, lat/lon like `17°56′N 76°50′W`, and the target port with distance in sea miles (`nm`, 1 nm = 18.52 units), compass bearing and an arrow relative to the bow. Speed stays in `HUD.tsx` (knots): `speedToKnots(v)` = |v| × `KNOTS_PER_SPEED_UNIT` (1.5), a fixed display scale (F1/Q1 B5; game time is compressed, so a literal m/s conversion is meaningless): sloop 4 → 6 kn … dreadnought 9 → 13.5 kn.
- **Ports (W4).** Data: `shared/world/ports.ts` (`PORTS`, typed view of the generated `ports.json`; numeric
  `id` = 1-based index, `key` = string id, town `x/z`, `dock`, `spawn`, `nation`, `region`). `useGameState.loadPorts`
  fetches `GET /api/ports` (same shape) and falls back to the bundled `PORTS`. `Ports.tsx` renders the store's
  ports; `Port.tsx` draws a procedural town on the coast at x/z (houses, tower, flag in `nationColor`, name label)
  and a pier + 300-unit ring at the dock. No island .glb any more: land is the W3 terrain (`Island.tsx` is unused).
  Docking: `GameScene.checkPortProximity` (10 Hz) uses `nearestDockPort` and enters the port when the metric
  distance to the dock is <= `PORT_INTERACTION_RADIUS` (300), the same rule the server enforces for trade, upgrade
  and repair. `isPlayerNearPort` uses the same 300 radius.
- Store (`useGameState`): `calculateDistance` is `metricDist`; `getNearestPort` uses dock points (`portPoint`, x/z fallback); `navTargetId` / `setNavTarget` / `getNavTargetPort()` (selected target, else nearest). The `Port` type has optional `dock` and `nation` (filled by W4's port source).

## WebSocket Communication

The client communicates with the server through WebSocket for real-time updates:

1. **Outgoing Messages**:
   - Player registration (name, ship type)
   - `input` intents at 20 Hz (throttle, rudder, fire) with a sequence number; never positions
   - Trade requests (buy/sell goods)

2. **Incoming Messages**:
   - Welcome/connection confirmation
   - Per-tick snapshots (`s`), `ent`/`gone` entity metadata, and events (`fire`/`hit`/`sunk`); see "Netcode (client)" below
   - Trade confirmations and inventory updates
   - Error messages

## Rendering Pipeline

1. Three.js scene setup in GameScene
2. Camera follows player ship
3. Game loop in useFrame (from @react-three/fiber):
   - Player.tsx (priority -1) runs fixed-step prediction via the net layer and draws the own ship
   - OtherShips / CannonBall read interpolated / simulated positions from the net layer
   - Renders scene
   (See "Netcode (client)" below — movement physics is the shared `shared/physics.ts`.)

## Netcode (client)

Contract: `docs/netcode/PROTOCOL.md` (§4 client→server, §6 snapshots/events, §7 client netcode);
wire types in `shared/protocol.ts`, physics in `shared/physics.ts` (same code the server runs).

**Net layer — `client/src/lib/net/` (framework-free, unit-tested in `__tests__/`):**
- `connection.ts` — WebSocket to `/game-ws`; reconnect backoff 0.5→1→2→4→8 s (reset on open);
  `{t:"ping",c}` every `PING_INTERVAL_MS`. `close()` = deliberate, no reconnect.
- `clock.ts` — `ServerClock`: offset = EMA of `snapshot.st − receiveTime` (early samples weigh more,
  >1 s jumps reset); RTT EMA from `pong`. `serverNow(local)` = local + offset.
- `controls.ts` — keyboard/touch booleans → `{th,ru,f}`: W/Up th 1 (ahead), S/Down th −1 (reverse),
  A/Left ru 1, D/Right ru −1, Space/F f 1; opposing keys cancel.
- `autoSail.ts` — keyboard auto-sail latch (framework-free `AutoSail` class). Double-tap forward (<=300 ms between
  presses) latches full-ahead with no key held; a fresh forward press or backward cancels (the cancel press does
  not count as a first tap). `Player.tsx` feeds it keyboard-only forward/backward each frame, ORs the result into
  `forward`, and resets it on sunk / trade menu / focused text input / unmount. State is mirrored to
  `stores/useAutoSail.ts` for `ui/AutoSailIndicator.tsx`. Wire input is still `th: 1`; touch is unaffected.
- **Wrapping Earth (card W1, docs/world/WORLD_SPEC.md).** x wraps at `WORLD_C` (400 000); z is
  0 (north pole) … 200 000 and does NOT wrap. Only x uses `lerpWrapped`/`wrappedDelta`; z is a plain
  lerp. Motion is metric (east-west speed divided by `metricX(z)` = cos lat). Geometry helpers live
  in `shared/world/geo.ts`, land sampling in `shared/world/land.ts`.
- `../world/landTiles.ts` — `ClientLandTiles` / app singleton `clientLand`: fetches
  `/world/land/manifest.json`, then SDF tiles in a ±`LOAD_RING` (3) tile square around the ship
  (`.bin.gz` gunzipped with `DecompressionStream` when the manifest says `encoding: "gzip"`), caches
  ≤ 128 data tiles, and exposes `clientLand.field` (a `LandField`). Missing tiles read as water and
  `field.ready()` is false. No manifest → all water. `version`/`subscribe` bump when tiles arrive
  (for W3 terrain). `net` is built with `{ land: clientLand }`; `NetClient.frame` calls
  `clientLand.update(ship x, z)` every frame.
- `prediction.ts` — `Predictor(land)`: steps with the same `LandQuery` as the server (the client
  LandField; default ocean + ice), so coast slides predict exactly. 20 Hz accumulator; each step builds the input, sends
  `{t:"input",s,th,ru,f}`, stores it as pending and runs `stepShip`. On a snapshot: drop pending with
  seq ≤ `a`, reset to `me`, replay the rest. The old→new difference goes into a visual error offset
  that decays (τ≈0.12 s); snap only if > `SNAP_ERROR_DISTANCE` (150). Render = lerp(prev step, cur step,
  acc/TICK_DT) + error offset. Seq restarts at 1 per session (socket close / connected / reconnected),
  matching the server's per-connection seq tracking; `a = -1` means nothing applied yet.
- `interpolation.ts` — `InterpolationBuffer` per remote eid (samples keyed by `st`), sampled at
  `serverNow − INTERP_DELAY_MS` with `lerpWrapped` (x only), plain lerp (z) and `lerpAngle`; underrun →
  extrapolate with velocity (metric) ≤ `MAX_EXTRAPOLATION_MS`, then hold. `RemoteWorld` holds buffers + `ent`/`gone` metadata and bumps
  `version` only when the renderable set / metadata / sunk flag changes. Entities are removed only
  by `gone` (never pruned locally; snapshots may be skipped under server backpressure).
  NPC2: `RemoteMeta` carries `npc`, `faction` and `title` for AI ships (from `ent`, via
  `parseEntNpcMeta`); undefined for players.
- **NPC nameplates and flags (NPC2).** `OtherShips` passes `npcTitle`/`faction` to `Ship`, which adds a
  second nameplate line "Spanish Navy — Galleon" (`npcNameplate`, tinted with the flag colour) and a
  small nation flag above the mast (a sibling of the model group, so model reloads never clear it).
  Colours and labels live in `lib/world/factions.ts` (`FACTION_FLAG_COLORS`, black flag for pirates).
- **Standing (NPC2).** `NetClient` handles the low-rate `standing` message: `net.standing`
  (`{rep, notoriety, bounty}`, null until the server sends one) and a `standing` event. No UI shows it yet.
- `cannonballs.ts` — `BallSim`: balls from `fire` events, spawn = estimated server time at receipt,
  analytic position `ballPositionAt`. Own balls drawn at `serverNow`; other ships' balls at
  `serverNow − INTERP_DELAY_MS` (same timeline as remote ships). `hit` removes own balls at once and
  lets others fly to the hit moment on their delayed timeline; lifetime expiry otherwise. A `splash`
  (ball hit land) removes the ball exactly like a `hit`.
- `netClient.ts` — `NetClient` hub; `index.ts` exports the app singleton `net`. Handles `s`, `ent`,
  `gone`, `fire`, `hit`, `sunk`, `splash` (emitted as the `splash` event for dust effects),
  `goldCollected`, `pong`; forwards every other (legacy `type`) message
  via the `legacy` event. `net.frameNow(controls)` = per-frame prediction step; it measures the frame
  dt on its own clock (`now()`), then calls `net.frame(dt, controls)`. Don't pass R3F's `delta`: it
  comes from the shared THREE.Clock, and any `clock.getElapsedTime()`/`getDelta()` call in a useFrame
  shortens the next frame's delta. That bug starved inputs to ~8/s at 9 fps (N3-fix). Animations
  must read `clock.elapsedTime` instead. `net.setHidden(true)` (App.tsx visibilitychange) sends one
  neutral input then stops sending, so the ship coasts. On un-hide the next frame gets dt 0.
- Hitches: a frame's dt is clamped to `MAX_FRAME_DT_SEC` (= `MAX_STEPS_PER_FRAME` 5 × 50 ms), and
  any time beyond that is dropped, not replayed. This is deliberate. While the client stalls, the
  server's queue runs dry and it re-uses our last input each tick, so it has already simulated the
  gap. Replaying the backlog would step the ship twice for the same wall time. The next snapshot
  reconciles us onto the server's extrapolated position: a decaying error offset, or a snap above
  150 u.

**How React reads it:**
- `Player.tsx` — useFrame(priority −1): keyboard (drei `get()`) + `controlsRef` → `net.frameNow` →
  writes `net.getOwnRenderState()` to the group. No local physics, no snapping, no store mutation.
- `OtherShips.tsx` — `useSyncExternalStore(net.remote)` for membership/metadata only; useFrame writes
  `net.remote.sample(eid, net.remoteRenderTime())` to each group. HP bars read live hp via `getHp`.
- `CannonBall.tsx` — `CannonBalls` subscribes to `net.balls` ids; each ball reads its position per frame.
- Remote ships, balls, gold and ports are drawn in floating-origin render space (see "Rendering:
  floating origin" below), so things across the map seam render next to you.
- `GameScene.tsx` camera: `lib/cameraFollow.ts` `CameraFollow`. Smoothing is frame-rate independent
  (`1 − exp(−k·dt)`, with k matching the old 0.1/0.05 per-frame lerps at 60 fps). The look-at focus
  never trails the rendered ship by more than 100 u, and the camera stays within 400 u of
  focus + offset. It snaps on net `spawned` (join/reconnect/respawn) and on any > 500 u jump
  (wrap-aware). It runs in render space: the ship is always at (0,0), and GameScene calls
  `shiftOrigin(renderFocus.shiftX, renderFocus.shiftZ)` before `update(0, 0, heading, dt)` so the
  smoothing state carries over the moving origin (no jump at the seam).
- `useSocket.tsx` — zustand façade: connection status/errors, register/trade/upgrade/repair/scuttle,
  and the bridge into `useGameState`: `me` → `gameState.player` at ~5 Hz (immediately on
  hp/gold/sunk/shipType/cargo/canFire change; x/z/rotationY/speed come from the predicted ship),
  other ships → `gameState.otherPlayers` (Minimap) at ~5 Hz, gold rows → `gameState.goldObjects`.
  Sounds: fire (once per event), hit on me, goldCollected. `gameEnd` freezes the mirror for GameOver.
- No client file may import from `server/`.

## Rendering: floating origin (WORLD_SPEC §7)

Nothing is drawn at raw world coordinates. `lib/world/renderSpace.ts` (unit-tested in
`lib/world/__tests__/renderSpace.test.ts`) is the single helper:
- The focus F = own predicted ship (raw coords). `Player.tsx` calls `setRenderFocus(x, z)` once per
  frame in its priority −1 useFrame, right after prediction (before the first snapshot it uses the
  store's player x/z). The own ship group is always at (0, 0, 0) with its heading.
- Every other object converts with `toRender(x, z)` →
  `rx = wrappedDelta(F.x, x, WORLD_C) * metricX(z)`, `rz = z − F.z` (metricX of the OBJECT's z).
  `toRender` returns a shared scratch object: copy the fields before calling it again.
- `renderFocus.shiftX/Z` = this frame's F in last frame's render space (camera uses it);
  `renderFocus.travelX/Z` = accumulated rendered travel (float64; ocean uses it).
- Users: `OtherShips.tsx`, `CannonBall.tsx` (ball + trail; trail history kept in world coords and
  re-projected every frame), `GoldObject.tsx` (props are world x/y/z), `Port.tsx` (town root at the port x/z and dock
  root at `dock`, both placed per frame; buildings, flag, label, pier and ring are local children). Ports and gold hide beyond
  `RENDER_CULL_DISTANCE` (camera far 2500 + 500).
- `Ocean.tsx`: three's `Water` on a `2 × (CAMERA_FAR + 500)` plane re-centred under the camera every
  frame. Its shader is patched so each of the four normal-map lookups gets
  `uOffN = fract(travel / divisorN)` (computed in float64 on the CPU): waves stay anchored to the
  world instead of swimming with the plane, with no precision loss over long sessions.
- World constants (`WORLD_C`, `WORLD_H`, `Z_ICE_N/S`, `metricX`, `wrappedDelta`) come from
  `shared/world/geo` and are re-exported by renderSpace.ts. `PARKED_Y` = where objects wait before
  their first placement.
- `CameraFollow` works purely in render space (no map wrap): `shiftOrigin(shift)` then
  `update(0, 0, heading, dt)`.
- Any new world object: put it in a group and set its position from `toRender` in useFrame. Never
  use raw x/z as a Three position.

## Terrain, shore, ice, land splashes (WORLD_SPEC §4, §7)

Data: `clientLand` (`lib/world/landTiles.ts`, W1) loads SDF tiles around the ship (the net layer
calls `clientLand.update`); `clientLand.field` is the `LandField`, `clientLand.version` bumps when a
tile arrives. Everything below is unit-tested in `lib/world/__tests__/terrain.test.ts`, including a
frame-budget test on the real generated tiles (Jamaica, English Channel: < 0.2 ms/frame average,
≈ 2 ms worst frame in node).
- `components/game/Terrain.tsx` owns a `TerrainManager` + `PolarIce` and updates both each frame
  from `renderFocus`. `?terrainStats=1` logs build stats, focus and camera every 2 s.
- `lib/world/terrainHeight.ts`: SDF → height/colour. Coast (d = 0) sits exactly at the waterline
  (`WATER_Y` = −10, the ocean plane), then beach (≤ 3 u over 40 u), gentle inland rise, low fractal
  hills from ~60 u inland; colours sand → grass/forest (noise mask) → rock (high/steep). Noise
  lattices divide WORLD_C, so it is seamless across the x wrap.
- `lib/world/terrain.ts` `TerrainManager`: chunks of 16 × 16 SDF px (781.25 u, always inside one
  tile). Geometry is in chunk-local coordinate units; the vertex shader (`RENDER_TRANSFORM_GLSL`)
  maps it to render space from per-chunk uniforms computed in float64 (`uOrigin` = wrappedDelta
  to the chunk origin and z offset, `uChunkZ0`), with metricX per vertex: the same formula as
  `toRender`. LOD 33/17/9 vertices per side by metric distance (< 900 / < 1900 / beyond), skirts hide
  LOD cracks, chunks within `VIEW_DISTANCE` (2800 u) kept, disposed beyond +600. All-water tiles and
  chunks with every sample > 60 u of water build nothing. Builds are time-sliced nearest-first
  (`DEFAULT_BUDGET_MS` 1 ms, at least one per frame; LOD0 build ≈ 0.4 ms). Chunks built while tiles
  were missing are rebuilt when `clientLand.version` changes. Terrain stops ~1500 u beyond the ice
  lines.
- `lib/world/shoreField.ts` `ShoreField`: a 256² Uint8 grid of `field.distance` (incl. ice) covering
  ±3000 u around the ship, anchored in travel space, rebuilt in 16-row slices into a back buffer when
  the ship has moved 500 u or tiles changed. `Ocean.tsx` uploads it as an R8 texture and its patched
  Water shader tints water turquoise within ~220 u of a coast and draws a moving surf-foam band in the
  first ~20 u.
- `lib/world/ice.ts` `PolarIce`: the ice lines are constant-z lines, so in render space each is a
  straight line at `rz = Z_ICE − F.z` with constant metricX (cos 70°). One rigid wall mesh (jagged,
  flat-shaded, face never on the water side of the physics line) plus a pack-ice plane with a
  tileable Voronoi floe texture, per pole (the south one mirrored). The pattern period divides the
  ice-line circumference and the mesh is shifted by −(s_F mod period) so the ice stays world-anchored.
- `components/game/LandSplashes.tsx`: dust cloud + debris (2 InstancedMeshes, pool of 24) on net
  `splash` events with `land: 1`, projected with `toRender`.
- Port towns / the old decorative island .glb in `Port.tsx` belong to W4 (ports card).

## Input Handling

- Keyboard controls for movement and combat
- Mouse interaction for UI elements
- Uses @react-three/drei for keyboard control helpers

## Trading System (Client-Side)

- `TradeMenu.tsx` displays goods available at a port
- Local inventory state synchronized with global game state
- Sends trade requests via WebSocket
- Updates UI on successful trades

## Animation and Effects

- Uses GLSL shaders for water effects
- Post-processing for visual effects
- Animation of ships and cannonballs

## Known Limitations and Considerations

1. Performance considerations with many ships/objects
2. Mobile compatibility and responsive design
3. Browser compatibility (WebGL support required)
4. Network latency is handled by prediction/interpolation (see Netcode); everything renders in floating-origin space, so the seam is invisible

## Testing and Debugging

- Console logs for WebSocket message tracking
- Three.js debugging helpers available in development
- Performance monitoring with r3f-perf (when enabled)

## Future Client Enhancements

1. Enhanced visual effects
2. More ship customization options
3. Advanced combat mechanics
4. Social features integration
5. Improved mobile support