/**
 * Remote ships, rendered from the net layer's interpolation buffers (lib/net/interpolation.ts).
 *
 * React state here is only the SET of ships and their metadata (`ent`/`gone`, sunk flag) via
 * `useSyncExternalStore(net.remote)`. Positions/rotations are written straight to the Three groups in
 * useFrame at `serverNow − INTERP_DELAY_MS` — no per-snapshot props. Positions are converted to
 * floating-origin render space (lib/world/renderSpace.ts) so ships across the map seam render next
 * to us instead of a circumference away.
 */
import { memo, useCallback, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Ship } from './Ship';
import { ShipType } from '@/lib/constants';
import { net, type RemotePose } from '@/lib/net';
import { toRender, PARKED_Y } from '@/lib/world/renderSpace';
import { FLAG_SUNK } from '@shared/protocol';

const subscribe = (fn: () => void) => net.remote.subscribe(fn);
const getVersion = () => net.remote.version;

// Parked below the ocean until the first useFrame places the ship in render space.
const ORIGIN: [number, number, number] = [0, PARKED_Y, 0];

export const OtherShips = memo(function OtherShips() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const entities = net.remote.renderable();
  const shipsRef = useRef<Map<number, THREE.Group>>(new Map());
  const pose = useRef<RemotePose>({ x: 0, z: 0, r: 0, v: 0, hp: 0, flags: 0, extrapolated: false });

  useFrame(() => {
    const renderTime = net.remoteRenderTime();
    shipsRef.current.forEach((group, eid) => {
      const p = net.remote.sample(eid, renderTime, pose.current);
      if (!p) return;
      const r = toRender(p.x, p.z);
      group.position.set(r.x, 0, r.z);
      group.rotation.y = p.r;
    });
  });

  return (
    <>
      {entities.map((e) => (
        <RemoteShip
          key={e.eid}
          eid={e.eid}
          shipType={e.meta!.shipType}
          name={e.meta!.name}
          maxHp={e.meta!.maxHp}
          npcTitle={e.meta!.npc ? (e.meta!.title ?? '') : undefined}
          faction={e.meta!.faction}
          sunk={(e.flags & FLAG_SUNK) !== 0}
          register={(eid, el) => {
            if (el) shipsRef.current.set(eid, el);
            else shipsRef.current.delete(eid);
          }}
        />
      ))}
    </>
  );
});

interface RemoteShipProps {
  eid: number;
  shipType: string;
  name: string;
  maxHp: number;
  /** NPC2: set for AI ships (nameplate title + faction flag). */
  npcTitle?: string;
  faction?: string;
  sunk: boolean;
  register: (eid: number, el: THREE.Group | null) => void;
}

const RemoteShip = memo(
  function RemoteShip({ eid, shipType, name, maxHp, npcTitle, faction, sunk, register }: RemoteShipProps) {
    const getHp = useCallback(() => net.remote.entities.get(eid)?.hp ?? 0, [eid]);
    const refCb = useCallback((el: THREE.Group | null) => register(eid, el), [eid, register]);
    return (
      <Ship
        ref={refCb}
        position={ORIGIN}
        rotation={0}
        type={shipType as ShipType}
        name={name}
        hp={net.remote.entities.get(eid)?.hp ?? maxHp}
        getHp={getHp}
        maxHp={maxHp}
        sunk={sunk}
        playerId={String(eid)}
        npcTitle={npcTitle}
        faction={faction}
      />
    );
  },
  // `register` is recreated on every parent render; it is behaviourally identical, so ignore it.
  (a, b) =>
    a.eid === b.eid && a.shipType === b.shipType && a.name === b.name && a.maxHp === b.maxHp && a.sunk === b.sunk &&
    a.npcTitle === b.npcTitle && a.faction === b.faction,
);
