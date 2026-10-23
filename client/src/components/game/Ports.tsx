import { useGameState } from '@/lib/stores/useGameState';
import { Port } from './Port';
import { useSyncExternalStore } from 'react';
import { cityDebug, subscribeCityDebug } from '@/lib/world/cityDebug';

/**
 * Every port's town + dock (card W4). Ports come from the store (`useGameState.loadPorts`, called by
 * GameScene: `GET /api/ports`, falling back to the bundled shared/world/ports.json). Each Port culls
 * itself by render distance, so all 27 can stay mounted.
 */
export function Ports() {
  const ports = useGameState((s) => s.gameState.ports);
  const hidden = useSyncExternalStore(subscribeCityDebug, () => cityDebug.hidePorts);
  if (hidden) return null; // dev: `__cityHide(true)` to measure the scene without ports
  return (
    <>
      {ports.map((port) => (
        <Port key={port.id} port={port} />
      ))}
    </>
  );
}
