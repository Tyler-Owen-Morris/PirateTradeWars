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
- `prediction.ts` — `Predictor`: 20 Hz accumulator; each step builds the input, sends
  `{t:"input",s,th,ru,f}`, stores it as pending and runs `stepShip`. On a snapshot: drop pending with
  seq ≤ `a`, reset to `me`, replay the rest. The old→new difference goes into a visual error offset
  that decays (τ≈0.12 s); snap only if > `SNAP_ERROR_DISTANCE` (150). Render = lerp(prev step, cur step,
  acc/TICK_DT) + error offset. Seq restarts at 1 per session (socket close / connected / reconnected),
  matching the server's per-connection seq tracking; `a = -1` means nothing applied yet.
- `interpolation.ts` — `InterpolationBuffer` per remote eid (samples keyed by `st`), sampled at
  `serverNow − INTERP_DELAY_MS` with `lerpWrapped`/`lerpAngle`; underrun → extrapolate with velocity
  ≤ `MAX_EXTRAPOLATION_MS`, then hold. `RemoteWorld` holds buffers + `ent`/`gone` metadata and bumps
  `version` only when the renderable set / metadata / sunk flag changes. Entities are removed only
  by `gone` (never pruned locally; snapshots may be skipped under server backpressure).
- `cannonballs.ts` — `BallSim`: balls from `fire` events, spawn = estimated server time at receipt,
  analytic position `ballPositionAt`. Own balls drawn at `serverNow`; other ships' balls at
  `serverNow − INTERP_DELAY_MS` (same timeline as remote ships). `hit` removes own balls at once and
  lets others fly to the hit moment on their delayed timeline; lifetime expiry otherwise.
- `netClient.ts` — `NetClient` hub; `index.ts` exports the app singleton `net`. Handles `s`, `ent`,
  `gone`, `fire`, `hit`, `sunk`, `goldCollected`, `pong`; forwards every other (legacy `type`) message
  via the `legacy` event. `net.frame(dt, controls)` = per-frame prediction step. `net.setHidden(true)`
  (App.tsx visibilitychange) sends one neutral input then stops sending, so the ship coasts.

**How React reads it:**
- `Player.tsx` — useFrame(priority −1): keyboard (drei `get()`) + `controlsRef` → `net.frame` →
  writes `net.getOwnRenderState()` to the group. No local physics, no snapping, no store mutation.
- `OtherShips.tsx` — `useSyncExternalStore(net.remote)` for membership/metadata only; useFrame writes
  `net.remote.sample(eid, net.remoteRenderTime())` to each group. HP bars read live hp via `getHp`.
- `CannonBall.tsx` — `CannonBalls` subscribes to `net.balls` ids; each ball reads its position per frame.
- Remote ships and balls are placed at `own + wrappedDelta(own, pos)` so things across the map seam
  render next to you; `GameScene` shifts the camera when the own ship wraps.
- `useSocket.tsx` — zustand façade: connection status/errors, register/trade/upgrade/repair/scuttle,
  and the bridge into `useGameState`: `me` → `gameState.player` at ~5 Hz (immediately on
  hp/gold/sunk/shipType/cargo/canFire change; x/z/rotationY/speed come from the predicted ship),
  other ships → `gameState.otherPlayers` (Minimap) at ~5 Hz, gold rows → `gameState.goldObjects`.
  Sounds: fire (once per event), hit on me, goldCollected. `gameEnd` freezes the mirror for GameOver.
- No client file may import from `server/`.

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
4. Network latency is handled by prediction/interpolation (see Netcode); gold objects and ports still render at absolute map coordinates near the seam

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