/**
 * Cannonballs, rendered from the net layer's local simulation (lib/net/cannonballs.ts).
 *
 * `fire` events spawn balls in `net.balls`; each ball's position is analytic (spawn + dir·speed·t),
 * so a ball is just read every frame. Balls are removed on `hit` or when their lifetime ends.
 * React state is only the set of ball ids (useSyncExternalStore on `net.balls`). Positions (and the
 * trail, kept in world coordinates) are converted to floating-origin render space every frame
 * (lib/world/renderSpace.ts), so balls near the map seam render correctly and trails don't drag.
 * The fire sound is played once per `fire` event by useSocket, not per ball.
 */
import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { net } from '@/lib/net';
import { toRender } from '@/lib/world/renderSpace';

const BALL_Y = 10;
const TRAIL_POINTS = 20;

const subscribe = (fn: () => void) => net.balls.subscribe(fn);
const getVersion = () => net.balls.version;

export const CannonBalls = memo(function CannonBalls() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const ids = net.balls.ids();
  return (
    <>
      {ids.map((id) => (
        <CannonBall key={id} id={id} />
      ))}
    </>
  );
});

export function CannonBall({ id }: { id: number }) {
  const ballRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Points>(null);
  // The trail's position attribute array (render space); rebuilt every frame from `world`.
  const trail = useMemo(() => new Float32Array(TRAIL_POINTS * 3), []);
  // Trail history in raw world coordinates [x0,z0,x1,z1,…], newest first (float64).
  const world = useMemo(() => new Float64Array(TRAIL_POINTS * 2), []);
  const primed = useRef(false);

  useFrame(() => {
    const ball = ballRef.current;
    if (!ball) return;
    // null = not yet spawned on this ball's timeline (remote balls are drawn INTERP_DELAY_MS behind)
    // or already past its hit / lifetime.
    const p = net.balls.position(id, net.clock.serverNow(net.now()));
    ball.visible = !!p;
    if (trailRef.current) trailRef.current.visible = !!p;
    if (!p) {
      primed.current = false;
      return;
    }
    const r = toRender(p.x, p.z);
    ball.position.set(r.x, BALL_Y, r.z);

    const points = trailRef.current;
    if (!points) return;
    if (!primed.current) {
      for (let i = 0; i < TRAIL_POINTS; i++) {
        world[i * 2] = p.x;
        world[i * 2 + 1] = p.z;
      }
      primed.current = true;
    } else {
      world.copyWithin(2, 0, (TRAIL_POINTS - 1) * 2);
      world[0] = p.x;
      world[1] = p.z;
    }
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const t = toRender(world[i * 2], world[i * 2 + 1]);
      trail[i * 3] = t.x;
      trail[i * 3 + 1] = BALL_Y;
      trail[i * 3 + 2] = t.z;
    }
    (points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={ballRef} position={[0, -10000, 0]} castShadow>
        <sphereGeometry args={[3, 16, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <points ref={trailRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={TRAIL_POINTS}
            array={trail}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial size={2} color="#ff8c00" sizeAttenuation={true} transparent opacity={0.8} />
      </points>
    </group>
  );
}
