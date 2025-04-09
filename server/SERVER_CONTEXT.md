# Server Architecture - Pirate Trade Wars

## Overview
The server is a Node.js application using Express for HTTP endpoints and WebSockets for real-time game communication. It manages game state, player interactions, trading mechanics, and data persistence.

## Directory Structure

- `/game/` - Game logic
  - `gameState.ts` - Core game state management
  - `shipTypes.ts` - Ship configurations
  - `socketHandler.ts` - WebSocket message handling
- `index.ts` - Server entry point
- `routes.ts` - HTTP API routes
- `storage.ts` - Data storage interface
- `vite.ts` - Development server configuration

## Game State Management

The game state is managed by the `GameState` class in `gameState.ts`:

1. **Core State**:
   - Players (position, rotation, health, etc.)
   - Cannonballs (position, direction, damage)
   - Ports (static locations)
   - Game time and update timestamps

2. **Update Loop**:
   - `tick()` - Updates game physics (50ms intervals by default)
   - `broadcast()` - Sends game state to clients (50ms intervals)
   - `updatePrices()` - Updates port prices (5-minute intervals)

3. **Player Management**:
   - Registration and removal
   - Movement and rotation
   - Health and damage
   - Sinking mechanics

## WebSocket Communication

Socket handling in `socketHandler.ts`:

1. **Message Types**:
   - `register` - Player registration
   - `input` - Player movement and actions
   - `trade` - Port trading actions

2. **Socket Management**:
   - Each connected client gets a unique ID
   - Messages parsed and validated
   - Responses sent directly or via broadcast

## Data Storage

The game uses a flexible storage system defined in `storage.ts`:

1. **Storage Interface**:
   - `IStorage` defines all data operations
   - `MemStorage` provides in-memory implementation
   - Ready for database implementation (PostgreSQL schema defined)

2. **Entity Types**:
   - Users (authentication)
   - Players (game state)
   - Ship Types (ship configurations)
   - Ports (trading locations)
   - Goods (tradable items)
   - Port Goods (stock and prices)
   - Player Inventory (owned goods)
   - Leaderboard (high scores)

## HTTP API Routes

Express routes in `routes.ts`:

1. **Player Routes**:
   - `/api/players` - Player management
   - `/api/players/:id/inventory` - Inventory access

2. **Game Data Routes**:
   - `/api/ship-types` - Available ships
   - `/api/ports` - Port information
   - `/api/ports/:id/goods` - Port goods and prices

3. **Admin Routes**:
   - Update port prices and stock
   - Modify game parameters

## Trading System

The trading system spans multiple components:

1. **Port Management**:
   - Fixed locations with safe zones
   - Dynamic goods with fluctuating prices
   - Stock management (supply/demand)

2. **Trade Processing**:
   - Buy/sell validation
   - Inventory updates
   - Gold transfers
   - Stock adjustments

3. **Price Fluctuation**:
   - Automated price changes
   - Supply-demand mechanics
   - Price bounds to prevent extremes

## Game Physics

Simple physics system for ships and projectiles:

1. **Ship Movement**:
   - Linear velocity with speed caps
   - Rotation with turning radius
   - Map wrapping at boundaries

2. **Collision Detection**:
   - Cannonball-to-ship collisions
   - Damage application
   - Ship sinking mechanics

## Database Integration

While the current implementation uses in-memory storage, the server is designed for PostgreSQL integration:

1. **Schema Definition**:
   - Tables defined in `shared/schema.ts`
   - Drizzle ORM integration ready

2. **Migration Path**:
   - Replace `MemStorage` with database implementation
   - No changes needed to game logic

## Known Limitations and Considerations

1. Memory usage with many concurrent players
2. Server performance under high load
3. Socket disconnection handling
4. Database scaling for production

## Developer Tips

1. **Adding New Ship Types**:
   - Update `shipTypes.ts`
   - Add client-side model and assets

2. **Modifying Trading**:
   - Adjust price fluctuation in `gameState.ts`
   - Update goods in `shipTypes.ts`

3. **Tuning Game Balance**:
   - Ship stats in `shipTypes.ts`
   - Combat parameters in `gameState.ts`