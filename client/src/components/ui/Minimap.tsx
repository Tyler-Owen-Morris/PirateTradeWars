import { useRef, useEffect } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  PORT_INTERACTION_RADIUS,
  MINIMAP_SIZE,
  MINIMAP_RADIUS,
  MINIMAP_PLAYER_DOT_SIZE,
  MINIMAP_PORT_DOT_SIZE,
  MINIMAP_OTHER_PLAYER_DOT_SIZE
} from '@shared/gameConstants';

/**
 * Minimap component showing player position and nearby ports
 */
export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { gameState } = useGameState();

  // Draw minimap on canvas
  useEffect(() => {
    if (!canvasRef.current || !gameState.player) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Draw background
    ctx.fillStyle = 'rgba(10, 30, 60, 0.8)';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Draw grid
    ctx.strokeStyle = 'rgba(70, 130, 180, 0.2)';
    ctx.lineWidth = 1;

    // Draw grid lines
    const gridSpacing = MINIMAP_SIZE / 10;
    for (let i = 0; i <= 10; i++) {
      const pos = i * gridSpacing;

      // Draw vertical lines
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, MINIMAP_SIZE);
      ctx.stroke();

      // Draw horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(MINIMAP_SIZE, pos);
      ctx.stroke();
    }

    // Draw border
    ctx.strokeStyle = '#c9a66b';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Player position as center point
    const centerX = gameState.player.x;
    const centerZ = gameState.player.z;

    // Function to convert game coordinates to minimap coordinates
    const mapToMinimap = (x: number, z: number) => {
      // Find the closest position considering the wrapping
      let dx = ((x - centerX) % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
      if (dx > MAP_WIDTH / 2) dx -= MAP_WIDTH;

      let dz = ((z - centerZ) % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
      if (dz > MAP_HEIGHT / 2) dz -= MAP_HEIGHT;

      // Scale and center on minimap
      const minimapX = MINIMAP_SIZE / 2 + (dx / MINIMAP_RADIUS) * (MINIMAP_SIZE / 2);
      const minimapY = MINIMAP_SIZE / 2 + (dz / MINIMAP_RADIUS) * (MINIMAP_SIZE / 2);

      return { x: minimapX, y: minimapY };
    };

    // Draw ports
    gameState.ports.forEach(port => {
      const { x, y } = mapToMinimap(port.x, port.z);

      // Only draw if within minimap range
      if (x >= 0 && x <= MINIMAP_SIZE && y >= 0 && y <= MINIMAP_SIZE) {
        // Draw port dot
        ctx.fillStyle = '#e6c577';
        ctx.beginPath();
        ctx.arc(x, y, MINIMAP_PORT_DOT_SIZE, 0, Math.PI * 2);
        ctx.fill();

        // Draw port interaction radius
        ctx.strokeStyle = 'rgba(230, 197, 119, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          x,
          y,
          (PORT_INTERACTION_RADIUS / MINIMAP_RADIUS) * (MINIMAP_SIZE / 2),
          0,
          Math.PI * 2
        );
        ctx.stroke();

        // Draw port name
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(port.name, x, y - MINIMAP_PORT_DOT_SIZE - 2);
      }
    });

    // Draw other players
    Object.values(gameState.otherPlayers).forEach(player => {
      const { x, y } = mapToMinimap(player.x, player.z);

      // Only draw if within minimap range
      if (x >= 0 && x <= MINIMAP_SIZE && y >= 0 && y <= MINIMAP_SIZE) {
        // Draw other player dot
        ctx.fillStyle = '#ff6347';
        ctx.beginPath();
        ctx.arc(x, y, MINIMAP_OTHER_PLAYER_DOT_SIZE, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw player in the center
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_PLAYER_DOT_SIZE, 0, Math.PI * 2);
    ctx.fill();

    // Draw player direction indicator
    const dirLength = MINIMAP_PLAYER_DOT_SIZE * 2;
    // Apply a complete inversion to match the ship's actual turning direction
    // The negative sign before gameState.player.rotationY inverts the rotation direction
    const dirX = MINIMAP_SIZE / 2 - Math.cos(gameState.player.rotationY - Math.PI / 2) * dirLength;
    const dirY = MINIMAP_SIZE / 2 + Math.sin(gameState.player.rotationY - Math.PI / 2) * dirLength;

    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2);
    ctx.lineTo(dirX, dirY);
    ctx.stroke();

  }, [gameState.player, gameState.ports, gameState.otherPlayers]);

  return (
    <div className="fixed bottom-24 left-4 z-50">
      <div className="p-2 bg-gray-900/80 border-2 border-amber-700 rounded-lg">
        <h3 className="font-bold text-amber-400 text-sm mb-1 text-center">Navigation Map</h3>
        <canvas
          ref={canvasRef}
          width={MINIMAP_SIZE}
          height={MINIMAP_SIZE}
          className="rounded"
        />
        <div className="text-xs text-center mt-1 text-amber-300">
          {gameState.player && (
            <div className="flex justify-between">
              <span>X: {Math.round(gameState.player.x)}</span>
              <span>Z: {Math.round(gameState.player.z)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}