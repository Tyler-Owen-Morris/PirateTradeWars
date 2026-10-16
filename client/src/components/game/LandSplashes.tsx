/**
 * Dust puffs where a cannonball hits land (net `splash` event with land: 1, WORLD_SPEC §4.3).
 * A fixed pool of MAX_PUFFS puffs, each = one expanding dust cloud + DEBRIS flung-out chunks, drawn
 * with two InstancedMeshes (two draw calls total). Puffs keep their WORLD position and are projected
 * with renderSpace.toRender every frame, like every other world object.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { net } from "@/lib/net";
import { toRender } from "@/lib/world/renderSpace";
import { WATER_Y } from "@/lib/world/terrainHeight";

const MAX_PUFFS = 24;
const DEBRIS = 6;
const LIFE_SEC = 1.4;
const GRAVITY = 160;

interface Puff {
  x: number;
  z: number;
  born: number;
  /** debris velocity (render-space directions are fine: they are tiny offsets) */
  v: Float32Array;
  active: boolean;
}

export function LandSplashes() {
  const puffs = useMemo<Puff[]>(
    () => Array.from({ length: MAX_PUFFS }, () => ({ x: 0, z: 0, born: 0, v: new Float32Array(DEBRIS * 3), active: false })),
    [],
  );
  const cloud = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: "#a08868", transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_PUFFS,
    );
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, []);
  const debris = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: "#6e5a44" }),
      MAX_PUFFS * DEBRIS,
    );
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, []);
  const tmp = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    let next = 0;
    const off = net.on("splash", (m) => {
      if (m.land !== 1) return;
      const p = puffs[next];
      next = (next + 1) % MAX_PUFFS;
      p.x = m.x;
      p.z = m.z;
      p.born = performance.now() / 1000;
      p.active = true;
      for (let i = 0; i < DEBRIS; i++) {
        const a = (i / DEBRIS) * Math.PI * 2 + Math.random() * 0.8;
        const sp = 25 + Math.random() * 35;
        p.v[i * 3] = Math.cos(a) * sp;
        p.v[i * 3 + 1] = 60 + Math.random() * 50;
        p.v[i * 3 + 2] = Math.sin(a) * sp;
      }
    });
    return () => {
      off();
      cloud.geometry.dispose();
      (cloud.material as THREE.Material).dispose();
      debris.geometry.dispose();
      (debris.material as THREE.Material).dispose();
    };
  }, [puffs, cloud, debris]);

  useFrame(() => {
    const now = performance.now() / 1000;
    let c = 0;
    let d = 0;
    for (const p of puffs) {
      if (!p.active) continue;
      const t = now - p.born;
      if (t > LIFE_SEC) {
        p.active = false;
        continue;
      }
      const r = toRender(p.x, p.z);
      const rx = r.x;
      const rz = r.z;
      const k = t / LIFE_SEC;
      // cloud grows fast then shrinks away
      const s = 22 * Math.sqrt(k) * (1 - k * k) + 0.01;
      tmp.position.set(rx, WATER_Y + 8 + 25 * k, rz);
      tmp.scale.set(s, s * 0.8, s);
      tmp.rotation.set(0, k * 2, 0);
      tmp.updateMatrix();
      cloud.setMatrixAt(c++, tmp.matrix);
      for (let i = 0; i < DEBRIS; i++) {
        const y = WATER_Y + 4 + p.v[i * 3 + 1] * t - 0.5 * GRAVITY * t * t;
        if (y < WATER_Y - 5) continue;
        tmp.position.set(rx + p.v[i * 3] * t, y, rz + p.v[i * 3 + 2] * t);
        const ds = 2.5 * (1 - k) + 0.01;
        tmp.scale.set(ds, ds, ds);
        tmp.rotation.set(t * 5 + i, t * 3, 0);
        tmp.updateMatrix();
        debris.setMatrixAt(d++, tmp.matrix);
      }
    }
    cloud.count = c;
    debris.count = d;
    if (c) cloud.instanceMatrix.needsUpdate = true;
    if (d) debris.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={cloud} />
      <primitive object={debris} />
    </>
  );
}
