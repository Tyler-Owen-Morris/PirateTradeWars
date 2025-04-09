# Pirate Trade Wars - Project Overview

## Introduction
Pirate Trade Wars is a browser-based multiplayer 3D pirate ship game where players explore a procedurally generated maritime world, engage in naval combat, trade goods between ports, and compete for positions on the leaderboard. The game ends when a player's ship is sunk, with their final gold amount determining their leaderboard position.

## Core Technologies
- **Frontend**: React, Three.js (@react-three/fiber), TypeScript
- **Backend**: Node.js, Express
- **Real-time Communication**: WebSockets
- **State Management**: Zustand
- **Data Storage**: In-memory storage with optional PostgreSQL database

## Project Structure

The project is divided into three main sections:

1. **Client** (`/client/`) - The frontend application
   - For detailed information, see [CLIENT_CONTEXT.md](./client/CLIENT_CONTEXT.md)

2. **Server** (`/server/`) - The backend application
   - For detailed information, see [SERVER_CONTEXT.md](./server/SERVER_CONTEXT.md)

3. **Shared** (`/shared/`) - Code and types shared between client and server
   - For detailed information, see [SHARED_CONTEXT.md](./shared/SHARED_CONTEXT.md)

## Key Features

1. **Ship Navigation & Combat**
   - Real-time ship movement and rotation
   - Cannon firing mechanics
   - Ship-to-ship damage and sinking

2. **Trading System**
   - Multiple ports with dynamic good pricing
   - Buy/sell mechanics with inventory management
   - Price fluctuations over time

3. **Infinite Map**
   - Procedurally generated world with wrapping borders
   - Strategic port placement

4. **Multiplayer Functionality**
   - Real-time player updates via WebSockets
   - Leaderboard for competitive play

## Running the Project

1. Start the development server:
   ```
   npm run dev
   ```

2. The server will start on port 5000 and the client will be accessible via the browser

## Data Flow

1. **Authentication/Registration**:
   - Client registers a player name and ship via WebSocket
   - Server validates and creates/retrieves player data

2. **Game State Updates**:
   - Server sends periodic game state updates to all clients
   - Client processes updates and renders accordingly

3. **Player Input**:
   - Client sends player input via WebSocket
   - Server validates and updates game state

4. **Trading**:
   - Client sends trade requests via WebSocket
   - Server processes trade, updates inventory and economy
   - Updates sent back to client

## Future Development Areas

1. Ship upgrades and customization
2. More complex combat mechanics
3. Weather and environmental effects
4. Quests and missions
5. Social features (chat, crews, etc.)

## Additional Documentation
- See folder-specific context files for detailed implementation information
- Check `package.json` for all dependencies and scripts
- Refer to TypeScript types for data structure details