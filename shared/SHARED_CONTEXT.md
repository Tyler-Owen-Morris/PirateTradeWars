# Shared Code Architecture - Pirate Trade Wars

## Overview
The shared directory contains code and types that are used by both the client and server. This ensures consistency in data structures and prevents duplication of code.

## Directory Structure

- `/shared/` - Shared code
  - `schema.tsx` - Database schema and type definitions
  - `gameConstants.ts` - Map size (`MAP_WIDTH` = WORLD_C, `MAP_HEIGHT` = WORLD_H,
    `PORT_INTERACTION_RADIUS` = 300 metric), ship stats, goods (ports moved to `world/ports.ts`)
  - `world/geo.ts` - Wrapping-Earth geometry (docs/world/WORLD_SPEC.md §2–3): `WORLD_C` 400 000 (x
    wraps), `WORLD_H` 200 000 (z: 0 = north pole, no wrap), `WORLD_R`, `ICE_LAT` 70, `Z_ICE_N/S`,
    `WORLD_VERSION` (persisted on players), `lonOf/xOfLon/latOf/zOfLat`, `metricX(z)` = cos lat,
    `metricDelta`, `metricDistSq`, `metricDist` (use these for EVERY gameplay distance),
    `compassHeading(rotationY)`, `rotationForHeading(deg)`, `bearingDeg(a→b)`, `wrap`, `wrappedDelta`,
    `wrapX`, `clampZ`.
  - `world/land.ts` - Land sampling (spec §4): `LandQuery` {distance, normal, ready}, `LandField`
    (bilinear over the 8192×4096 Int8 SDF, x wraps, z clamped, polar ice included, missing tile =
    water), `TileSource`/`ArrayTileSource`, `LandManifest`, raster constants (`SDF_W/H`, `TILE`,
    `TILES_X/Y`, `PX`, `SDF_UNIT`, `SDF_FAR`), `tileOf`, `tileKey`. Test helpers:
    `ALWAYS_WATER_TEST_FIELD` (ocean + ice; also the server fallback) and `buildSyntheticLand([circle|rect])`
    which rasterizes real tiles. Loaders: `server/game/landLoader.ts`, `client/src/lib/world/landTiles.ts`.
  - `world/ports.ts` - Game ports (card W4): `PORTS` (typed `GamePort` view of ports.json, numeric `id` =
    1-based index, `key` = string id), `PORTS_VERSION`, `STARTER_PORTS`, dock checks (`withinDock`,
    `dockDistance`, `nearestDockPort`, metric, radius 300) and market profiles (`REGION_MARKETS`,
    `portGoodPrice`, `portGoodStock`). Used by the server (seed, gate, spawns) and the client (towns, docking).
  - `world/ports.json`, `world/lanes.json`, `world/versions.json` - generated world data (card W2).
  - `physics.ts` - Deterministic ship/cannonball simulation used by BOTH server (authoritative 20 Hz
    tick) and client (prediction). `stepShip(state, input, stats, land?)` = metric motion
    (z += cos·v; x += sin·v / metricX(z); x wraps, z clamped) plus no-damage coast collision when a
    `LandQuery` is given (push out along the normal by hullRadius − d, then, if moving into land,
    CLAMP |velocity| to maxSpeed·sqrt(1 − hn²), hn = heading·normal; heading unchanged). F1 (Q1 B1):
    this was a per-sub-step multiply that compounded to ~0.1× speed; the clamp is idempotent, so a
    45° hit keeps ≈ 0.71·max speed (≈ 0.5·max of progress along the coast) and head-on still stops
    (WORLD_SPEC clarification after Q1). Client and server share it, so prediction stays exact.
    `ShipPhysicsStats.hullRadius`
    (`HULL_RADIUS`: sloop 12 … dreadnaught 30). Helpers: `lerpWrapped`, `lerpAngle`, `normalizeAngle`,
    `metricXAdvance`, re-exported `wrap`/`wrappedDelta`/`metricX`/`metricDelta`/`metricDistSq`;
    `wrappedDistSq` is a deprecated alias of `metricDistSq`. Cannonballs: `spawnBroadside`,
    `ballPositionAt`, `stepBall` (exact metric straight line), `ballHitsLand`, metric
    `segmentHitsCircle`. Pure. Units: speed = metric units per 1/60 s, negative velocity = forward (W).
  - `protocol.ts` - WebSocket message types (`ClientMessage`, `ServerMessage`), snapshot entity rows
    (`packEntityRow`/`unpackEntityRow`), flag bits, netcode constants (interest radius, grid cell,
    interpolation delay, input queue cap) and `parseClientMessage` (validates/clamps untrusted frames).
    Global chat: `ChatSendMessage` (c→s `{t:"chat", text}`), `ChatMessage` (s→c `{t:"chat", id, from, text,
    ts, sys?}`), `ChatHistoryMessage` (`{t:"chatHistory", lines}`), `MAX_CHAT_LENGTH` (200),
    `CHAT_HISTORY_SIZE` (30), `sanitizeChatText` (strip control/zero-width/bidi chars, collapse whitespace,
    trim, cut by code points; used by both sides) and `parseChatLine` (client-side validation). The
    server's profanity/rate-limit policy is in `server/game/chat.ts`, not here. Tests: `__tests__/chat.test.ts`.
  - `__tests__/` - vitest unit tests (`npm test`).
  - `world/` - generated world data (do not hand-edit; regenerate with `npm run world:build`, see
    `docs/world/DATA_PIPELINE.md`): `ports.json` (27 real ports with town/dock/spawn, spec §5),
    `lanes.json` (sea lanes, spec §6), `versions.json` (content hashes: land/ports/lanes). The land
    SDF tiles + manifest live in `client/public/world/land/` (gzipped, `encoding: "gzip"`), the map
    textures in `client/public/world/map_*.png`. `world/__tests__/data.test.ts` validates them.

The netcode contract is `docs/netcode/PROTOCOL.md`; `physics.ts` and `protocol.ts` implement it.
Keep both files free of imports from `client/` or `server/` (they are bundled by Vite and esbuild).

## Database Schema

The `schema.ts` file defines the database schema using Drizzle ORM:

1. **Users Table**:
   - Stores authentication information
   - Fields: id, username, password (hashed), created_at

2. **Players Table**:
   - Game-specific player data
   - Fields: id, name, gold, ship_type, is_active, created_at

3. **Leaderboard Table**:
   - High scores and achievements
   - Fields: id, player_name, score, achieved_at

4. **Ship Types Table**:
   - Ship configuration data
   - Fields: id, name, display_name, description, hull_strength, armor, etc.

5. **Ports Table**:
   - Fixed port locations
   - Fields: id, name, x, y, z, safe_radius

6. **Goods Table**:
   - Tradable item definitions
   - Fields: id, name, base_price, fluctuation

7. **Port Goods Table**:
   - Relational table linking ports to goods
   - Fields: id, port_id, good_id, current_price, stock

8. **Player Inventory Table**:
   - Player's owned goods
   - Fields: player_id, good_id, quantity

## Type Definitions

The shared directory exports TypeScript types derived from the schema:

```typescript
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export type Leaderboard = typeof leaderboard.$inferSelect;
export type InsertLeaderboard = z.infer<typeof insertLeaderboardSchema>;

export type ShipType = typeof shipTypes.$inferSelect;
export type Port = typeof ports.$inferSelect;
export type Good = typeof goods.$inferSelect;
export type PortGood = typeof portGoods.$inferSelect;
export type PlayerInventory = typeof playerInventory.$inferSelect;
```

## Communication Protocol

The contract is defined in `shared/protocol.ts` (message types, validation via `parseClientMessage`) and documented in `docs/netcode/PROTOCOL.md`:

1. **Client-to-Server Messages**:
   - Registration messages with player name and ship type
   - `input` messages with throttle/rudder/fire intents and a seq (no positions)
   - Trade messages for buying/selling goods

2. **Server-to-Client Messages**:
   - Per-tick snapshots `s` (private `me` state plus compact rows for nearby ships), `ent`/`gone`, and `fire`/`hit`/`sunk` events
   - Trade confirmations with inventory updates
   - Error messages for invalid actions

## Data Flow

The shared types ensure:

1. **Type Safety**:
   - Both client and server use the same data structures
   - TypeScript validation prevents mismatched data

2. **Database Consistency**:
   - Schema definitions match storage operations
   - Insert/select operations are properly typed

3. **API Coherence**:
   - HTTP endpoints return data matching expected types
   - WebSocket messages follow consistent structure

## Usage in the Application

1. **Server Usage**:
   - Imports types for database operations
   - Uses schema for data validation
   - Structures WebSocket messages using shared types

2. **Client Usage**:
   - Imports types for state management
   - Uses types for API request/response typing
   - Structures WebSocket messages using shared types

## Developer Guidelines

1. **Adding New Data Structures**:
   - Add to the schema in `schema.ts`
   - Export TypeScript types
   - Update related client and server code

2. **Modifying Existing Structures**:
   - Update schema in `schema.ts`
   - Check for impacts on client state management
   - Ensure server storage code is updated

3. **Protocol Changes**:
   - When modifying message formats, update both client and server handlers
   - Test communication flow thoroughly

## Future Considerations

1. **Versioning**:
   - Consider adding protocol versioning for future updates
   - Implement backward compatibility for API changes

2. **Schema Migration**:
   - Plan for database migrations when schema changes
   - Document migration paths for production deployments

3. **Validation**:
   - Add more robust validation using Zod or similar
   - Implement runtime validation in addition to TypeScript types