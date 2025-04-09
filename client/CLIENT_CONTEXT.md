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
- `Port.tsx` / `Ports.tsx` - Port visuals and management

### UI Components
- `TradeMenu.tsx` - Trading interface for ports
- Ship selection screens
- Game status indicators and HUD
- Damage indicators and ship status

## WebSocket Communication

The client communicates with the server through WebSocket for real-time updates:

1. **Outgoing Messages**:
   - Player registration (name, ship type)
   - Input updates (movement, rotation, firing)
   - Trade requests (buy/sell goods)

2. **Incoming Messages**:
   - Welcome/connection confirmation
   - Game state updates (players, cannonballs, etc.)
   - Trade confirmations and inventory updates
   - Error messages

## Rendering Pipeline

1. Three.js scene setup in GameScene
2. Camera follows player ship
3. Game loop in useFrame (from @react-three/fiber):
   - Updates player position based on input
   - Applies physics and collision
   - Renders scene

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
4. Network latency handling and interpolation

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