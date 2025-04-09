# Pirate Trade Wars - Game Design Document (Networking Instructions for Three.js)

## Networking for Real-Time Multiplayer with Three.js
*Pirate Trade Wars* is a browser-based, real-time, massively multiplayer game built with a Three.js frontend, where players sail an infinite 3D ocean, trade at ports, and engage in PvP combat. The networking system must support 50-100+ concurrent players per server instance, ensure low-latency updates, and handle disconnections and lag. These instructions adapt the networking architecture for a 3D environment using Three.js.

### Architecture Overview
- **Model**: Client-server with authoritative server.
- **Server**: Node.js with WebSocket (e.g., `ws` library) for real-time communication.
- **Client**: Three.js (JavaScript) using WebSocket API to connect to the server, rendering a 3D scene.
- **Goal**: Server maintains the canonical game state, clients render 3D ships and the ocean, and updates sync frequently.

### Core Networking Mechanics
1. **Server Setup**:
   - Host a Node.js server with WebSocket support.
   - Run a game loop at 20 ticks/second (50ms intervals) to process updates and broadcast state.
   - Store game state: `{ players: { id: { x, y, z, rotationY, speed, hp, cargo, etc } }, ports: { name, x, y, z, prices } }`.
   - Note: Add `z` for 3D positioning (e.g., ocean at z=0, ports slightly above), and `rotationY` for ship orientation.

2. **Player Connection**:
   - On connect, assign a unique `playerId` (e.g., UUID).
   - Send initial state: core map data (port locations in 3D), player’s starting ship stats, and nearby player positions.
   - Example message: `{ type: "init", playerId: "123", ship: { type: "Sloop", x: 2500, y: 0, z: 2500, rotationY: 0, hp: 50 }, ports: [{ name: "Tortuga", x: 1000, y: 10, z: 1200 }, ...] }`.

3. **Real-Time Updates**:
   - **Client-to-Server**: Send player inputs every 100ms (10Hz):
     - `{ type: "input", playerId: "123", rotationY: 45, speed: 5, firing: true }`.
   - **Server-to-Client**: Broadcast game state updates at 20Hz:
     - Full update: `{ type: "update", players: { "123": { x, y, z, rotationY, hp, ... }, ... }, events: { storms, wrecks } }`.
     - Send data for players within a 1000-unit radius (3D distance) of each client.
   - Use delta updates: Only send changes (e.g., `{ "123": { x: 2510, hp: 48 } }`).

4. **Infinite Map Sync**:
   - Server tracks positions with wrapping: `x = (x % 5000 + 5000) % 5000`, `z = (z % 5000 + 5000) % 5000` (y remains fixed, e.g., ocean at y=0).
   - Send wrapped coordinates to clients, ensuring correct rendering across boundaries.
   - Example: Player A at (4950, 0, 3000) sees Player B at (50, 0, 3000) as 100 units away in x.

### Stability and Optimization
1. **Spatial Partitioning**:
   - Divide the 5000x5000xY map into a 3D grid (e.g., 10x1x10 cells, 500xYx500 units each, y optional).
   - Track players in each cell; send updates only for same or adjacent cells.
   - Example: Player at (4800, 0, 200) gets updates from cells (9,0,0), (9,0,1), (8,0,0), (8,0,1).

2. **Bandwidth Management**:
   - Compress messages (e.g., MessagePack) for 3D data (x, y, z, rotation).
   - Cap update frequency: 20Hz for position/rotation, 5Hz for cargo/gold.
   - Limit broadcast radius: 1000 units in 3D space.

3. **Server Load**:
   - Shard instances at 100 players max.
   - Use a load balancer to spawn new instances at 80% capacity.
   - Persist data in a database (e.g., Redis) for continuity.

### Handling Disconnections
1. **Graceful Disconnects**:
   - On WebSocket close, mark player “inactive” for 30s.
   - Broadcast `{ type: "playerLeft", playerId: "123" }`.
   - Reconnect within 30s restores state; otherwise, remove and save to DB.

2. **Timeouts**:
   - No input for 5s = pause movement (speed = 0).
   - Notify client: `{ type: "timeoutWarning" }`.

3. **Reconnection**:
   - Client sends `{ type: "reconnect", playerId: "123", token: "abc" }`.
   - Server restores position, rotation, and ship state.

### Latency and Client-Side Prediction
1. **Prediction**:
   - Client predicts movement: `position.x += speed * Math.cos(rotationY) * deltaTime`, `position.z += speed * Math.sin(rotationY) * deltaTime`.
   - Interpolate to server position (lerp over 100ms) when updates arrive.
   - Example: Client at (2550, 0, 2500), server says (2548, 0, 2499), adjust smoothly.

2. **Combat Latency**:
   - Client shows cannon fire (raycast in Three.js), waits for server hit confirmation.
   - Server sends: `{ type: "hit", targetId: "456", damage: 5, hpLeft: 45 }`.
   - Delay effects if latency > 200ms until sync.

3. **Rubber-Banding Prevention**:
   - Cap correction: If >50 units off, snap to server position with fade-in.
   - Use timestamps: `{ timestamp: 1711999200, input: {...} }` to discard old inputs.

### Technical Instructions for Developer
1. **Server Code**:
   - Node.js with `ws`:
     ```javascript
     const WebSocket = require('ws');
     const wss = new WebSocket.Server({ port: 8080 });
     let gameState = { players: {} };
     wss.on('connection', (ws) => {
       const playerId = generateUUID();
       ws.on('message', (data) => handleInput(playerId, JSON.parse(data)));
       setInterval(() => broadcastUpdates(), 50); // 20Hz
     });
     ```
   - Include `y` and `rotationY` in state updates.

2. **Client Code (Three.js)**:
   - Setup WebSocket and scene:
     ```javascript
     const ws = new WebSocket('ws://server:8080');
     const scene = new THREE.Scene();
     const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
     const renderer = new THREE.WebGLRenderer();
     renderer.setSize(window.innerWidth, window.innerHeight);
     document.body.appendChild(renderer.domElement);

     let players = {};
     ws.onmessage = (event) => {
       const data = JSON.parse(event.data);
       if (data.type === "update") updatePlayers(data.players);
     };
     setInterval(() => ws.send(JSON.stringify(getInputs())), 100); // 10Hz

     function updatePlayers(serverData) {
       for (let id in serverData) {
         if (!players[id]) {
           players[id] = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 50), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
           scene.add(players[id]);
         }
         players[id].position.set(serverData[id].x, serverData[id].y, serverData[id].z);
         players[id].rotation.y = serverData[id].rotationY;
       }
     }

     function animate() {
       requestAnimationFrame(animate);
       // Predict local movement here
       renderer.render(scene, camera);
     }
     animate();
     ```
   - Add ocean plane: `scene.add(new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshBasicMaterial({ color: 0x0000ff })))`.

3. **Testing**:
   - Simulate 50 players with 3D movement/combat.
   - Test latency (200-500ms) with browser tools.
   - Verify reconnection and wrapping in 3D space.

### Notes
- **Three.js Specifics**: Use a perspective camera following the player, adjust `far` plane (e.g., 2000) for visibility across wraps.
- **Scalability**: Same as 2D—shard at 100 players.
- **Security**: Validate inputs (e.g., rotationY in radians, speed caps).