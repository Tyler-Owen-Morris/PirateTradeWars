/**
 * Cannonballs, rendered from the net layer's local simulation (lib/net/cannonballs.ts).
 *
 * `fire` events spawn balls in `net.balls`; each ball's position is analytic (spawn + dir·speed·t),
 * so a ball is just read every frame. Balls are removed on `hit` or when their lifetime ends.
 * React state is only the set of ball ids (useSyncExternalStore on `net.balls`). Positions are placed
 * relative to the local ship (shortest wrapped delta) so balls near the map seam render correctly.
 * The fire sound is played once per `fire` event by useSocket, not per ball.
 */
import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { net } from '@/lib/net';
import { wrappedDelta, type ShipKinematics } from '@shared/physics';
import { MAP_WIDTH, MAP_HEIGHT } from '@shared/gameConstants';

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

const own: ShipKinematics = { x: 0, z: 0, rotationY: 0, velocity: 0 };

export function CannonBall({ id }: { id: number }) {
  const ballRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Points>(null);
  // The trail's position attribute array; mutated in place every frame.
  const trail = useMemo(() => new Float32Array(TRAIL_POINTS * 3), []);
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
    let x = p.x;
    let z = p.z;
    if (net.predictor.initialized) {
      net.getOwnRenderState(own);
      x = own.x + wrappedDelta(own.x, p.x, MAP_WIDTH);
      z = own.z + wrappedDelta(own.z, p.z, MAP_HEIGHT);
    }
    ball.position.set(x, BALL_Y, z);

    const points = trailRef.current;
    if (!points) return;
    const arr = trail;
    if (!primed.current) {
      for (let i = 0; i < TRAIL_POINTS; i++) {
        arr[i * 3] = x;
        arr[i * 3 + 1] = BALL_Y;
        arr[i * 3 + 2] = z;
      }
      primed.current = true;
    } else {
      arr.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
      arr[0] = x;
      arr[1] = BALL_Y;
      arr[2] = z;
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
