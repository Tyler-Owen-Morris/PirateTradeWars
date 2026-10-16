# Shared Code Architecture - Pirate Trade Wars

## Overview
The shared directory contains code and types that are used by both the client and server. This ensures consistency in data structures and prevents duplication of code.

## Directory Structure

- `/shared/` - Shared code
  - `schema.tsx` - Database schema and type definitions
  - `gameConstants.ts` - Map size, ship stats, goods, ports
  - `physics.ts` - Deterministic ship/cannonball simulation used by BOTH server (authoritative 20 Hz
    tick) and client (prediction). `stepShip(state, input, stats)`, wrap/angle helpers
    (`wrap`, `wrappedDelta`, `wrappedDistSq`, `lerpWrapped`, `lerpAngle`, `normalizeAngle`),
    `spawnBroadside`, `ballPositionAt`, `stepBall`, `segmentHitsCircle`. Pure, no deps beyond
    `./gameConstants`. Units: speed = units per 1/60 s, negative velocity = forward (W).
  - `protocol.ts` - WebSocket message types (`ClientMessage`, `ServerMessage`), snapshot entity rows
    (`packEntityRow`/`unpackEntityRow`), flag bits, netcode constants (interest radius, grid cell,
    interpolation delay, input queue cap) and `parseClientMessage` (validates/clamps untrusted frames).
  - `__tests__/` - vitest unit tests (`npm test`).

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

While not explicitly defined in a file, the shared types establish the contract for WebSocket communication:

1. **Client-to-Server Messages**:
   - Registration messages with player name and ship type
   - Input messages with movement and action data
   - Trade messages for buying/selling goods

2. **Server-to-Client Messages**:
   - Game state updates with player and projectile positions
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