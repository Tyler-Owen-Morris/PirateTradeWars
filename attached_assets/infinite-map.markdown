# Pirate Trade Wars - Game Design Document (Infinite Map Instructions)

## Infinite Map Generation and Wrapping Mechanics
The game features an infinite 2D map where players can sail endlessly, wrapping around edges to create a seamless open-world experience. This section provides detailed instructions for implementing the map generation and wrapping logic in a browser-based environment using HTML5 and JavaScript.

### Map Concept
- **Visual Style**: 2D top-down view with a tiled ocean background, ports, and dynamic player positions.
- **Logical Size**: A finite "core map" (e.g., 5000x5000 pixels) that repeats infinitely by wrapping coordinates.
- **Wrapping**: If a player sails off one edge (e.g., right), they reappear on the opposite edge (left) at the same vertical level, and vice versa for top/bottom.

### Core Map Setup
1. **Define the Core Map**:
   - Set a fixed size for the core map, e.g., 5000x5000 pixels. This is the base area that repeats.
   - Use a simple ocean tile (e.g., a 100x100 pixel sprite) repeated to fill the space.
   - Example: A 5000x5000 map requires 50x50 tiles (2500 total tiles).

2. **Place Ports**:
   - Hardcode 8-12 ports with unique coordinates within the core map (e.g., Tortuga at (1000, 1200), Port Royale at (4000, 300)).
   - Ensure ports are spaced out (minimum 1000 pixels apart) to encourage travel.
   - Store port data: `{ name: "Tortuga", x: 1000, y: 1200, safeRadius: 200 }`.

3. **Background Rendering**:
   - Render only the visible portion of the map based on the player’s viewport (e.g., 800x600 pixels for a typical browser window).
   - Use a repeating tile pattern that loops seamlessly at the edges.

### Infinite Wrapping Mechanics
1. **Coordinate System**:
   - Track each player’s position as `(x, y)` within the core map’s bounds (0 to 5000 for both axes).
   - Use modulo arithmetic to wrap coordinates when they exceed the map size.

2. **Wrapping Logic**:
   - **Formula**: 
     - `wrappedX = (x % mapWidth + mapWidth) % mapWidth`
     - `wrappedY = (y % mapHeight + mapHeight) % mapHeight`
   - **Explanation**: 
     - If `x` goes beyond 5000 (e.g., 5100), `5100 % 5000 = 100`, placing the player at x=100.
     - If `x` goes negative (e.g., -50), `(-50 % 5000 + 5000) % 5000 = 4950`, placing them near the right edge.
   - Apply this every frame to player movement.

3. **Movement Implementation**:
   - Update player position based on their ship’s speed (e.g., Sloop = 5 pixels/frame).
   - Example: If a player at (4998, 3000) moves right (+5), new raw `x = 5003`. After wrapping: `5003 % 5000 = 3`, so position becomes (3, 3000).
   - Ensure velocity carries over: If moving right off the edge, continue moving right from the new position.

4. **Port Wrapping**:
   - Ports exist only in the core map (e.g., Tortuga at (1000, 1200)).
   - When calculating distance to a port, use the shortest wrapped distance:
     - Distance = `min(abs(x1 - x2), mapWidth - abs(x1 - x2))` for x-axis (similar for y-axis).
     - Example: Player at (4900, 1200) to Tortuga (1000, 1200):
       - Direct: 4900 - 1000 = 3900 pixels.
       - Wrapped: 5000 - 4900 + 1000 = 1100 pixels (shorter, so player approaches from the left).

### Rendering the Infinite Map
1. **Viewport Management**:
   - Center the camera on the player’s ship.
   - Render tiles and objects within the viewport (e.g., 800x600 pixels around the player).

2. **Seamless Edges**:
   - When near an edge (e.g., x = 4900), render tiles from the opposite side:
     - For x > 4800, draw tiles from x=0 to x=200 on the right side of the screen.
     - For x < 200, draw tiles from x=4800 to 5000 on the left.
   - Repeat for y-axis (top/bottom).

3. **Player and Object Visibility**:
   - Show other players/ships within the viewport, adjusting their positions if they’re across a wrap boundary.
   - Example: Player A at (4950, 3000), Player B at (50, 3000). A sees B 100 pixels to the right (wrapped), not 4900 pixels left.

### Technical Instructions for AI Coder
1. **Setup**:
   - Use a canvas element (HTML5) with a 2D context for rendering.
   - Define constants: `const MAP_WIDTH = 5000; const MAP_HEIGHT = 5000;`.

2. **Player Object**:
   - Store as `{ x: number, y: number, speed: number }`.
   - Update position: 
     ```javascript
     player.x += player.speed * Math.cos(player.angle); // Assuming angle-based movement
     player.y += player.speed * Math.sin(player.angle);
     player.x = (player.x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
     player.y = (player.y % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
     ```

3. **Rendering Loop**:
   - Clear canvas.
   - Calculate viewport bounds: `left = player.x - canvas.width / 2`, etc.
   - Draw ocean tiles, wrapping as needed:
     ```javascript
     for (let x = Math.floor(left / tileSize) * tileSize; x < right; x += tileSize) {
       let wrappedX = (x % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
       context.drawImage(oceanTile, x - left, y - top);
     }
     ```
   - Draw ports and players with wrapped coordinates.

4. **Distance Calculations**:
   - For combat/trading range:
     ```javascript
     function getWrappedDistance(x1, y1, x2, y2) {
       let dx = Math.min(Math.abs(x1 - x2), MAP_WIDTH - Math.abs(x1 - x2));
       let dy = Math.min(Math.abs(y1 - y2), MAP_HEIGHT - Math.abs(y1 - y2));
       return Math.sqrt(dx * dx + dy * dy);
     }
     ```

5. **Optimization**:
   - Only update/render objects within a slightly larger radius than the viewport (e.g., 1000 pixels) to reduce server/client load.
   - Use a spatial grid or quadtree for efficient collision detection across wrap boundaries.

### Notes
- **Infinite Feel**: Players won’t notice the wrap if rendering is seamless and ports are fixed in the core map.
- **Server Sync**: In multiplayer, ensure the server tracks wrapped coordinates and syncs player positions correctly.
- **Testing**: Verify wrapping by sailing off all edges and checking port distances from various positions.