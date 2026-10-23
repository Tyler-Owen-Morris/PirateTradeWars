/**
 * A port's town, built by the procedural city kit (client/src/lib/city/README.md).
 *
 * - Built lazily once the town comes within BUILD_DISTANCE and its land tiles are loaded (or the
 *   no-land fallback is active); at most one city build per frame across all ports. CPU builds are
 *   cached by port key (small LRU); GPU geometry is disposed when the town goes far (DISPOSE_DISTANCE).
 * - Three draw calls when near (main, detail, flags), two when far (detail = windows/doors/chimneys/
 *   cannons/bollards is the LOD layer, hidden beyond DETAIL_DISTANCE), none when culled.
 * - Static: no per-frame work except the floating-origin uniforms (+ flag time) of visible cities.
 *   Geometry is in town-local x-units/metric z and placed by the city material's vertex shader with
 *   the same per-vertex transform as the terrain (lib/city/cityMaterial.ts), so it never drifts.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Port as PortType } from "@/types";
import { clientLand } from "@/lib/world/landTiles";
import { renderFocus, toRender, metricX, wrappedDelta, WORLD_C } from "@/lib/world/renderSpace";
import { buildCity, type CityBuild } from "@/lib/city/layout";
import { cityInputFor, flatCoastSite, makeCitySite } from "@/lib/city/site";
import { createCityMaterial, type CityMaterial } from "@/lib/city/cityMaterial";
import type { BuiltLayer } from "@/lib/city/meshBuilder";

/** Render distance (focus → town) at which a city is built / disposed / drawn / gets its detail layer. */
export const BUILD_DISTANCE = 3200;
export const DISPOSE_DISTANCE = 4200;
export const DETAIL_DISTANCE = 1300;
/** A city is drawn while (distance − its radius) < this (fog is opaque from ~1800 off the camera). */
export const DRAW_DISTANCE = 2300;

const MAX_CACHED = 6;
const buildCache = new Map<string, CityBuild>();
let lastBuildFrame = -1;

/** Build (or fetch) a city's CPU geometry. Exported for tests/debug. */
export function getCityBuild(port: PortType): CityBuild {
  const input = cityInputFor(port);
  const hit = buildCache.get(input.key);
  if (hit) {
    buildCache.delete(input.key);
    buildCache.set(input.key, hit); // LRU touch
    return hit;
  }
  const site = clientLand.fallback ? flatCoastSite(input.dock) : makeCitySite(clientLand.field, port.x, port.z);
  const b = buildCity(input, site);
  buildCache.set(input.key, b);
  while (buildCache.size > MAX_CACHED) buildCache.delete(buildCache.keys().next().value as string);
  if ((window as any).__cityLog) console.log("[city]", input.key, b.styleId, b.stats, b.main.triangles + b.detail.triangles + b.flags.triangles, "tris");
  return b;
}

/** BufferGeometry from a layer; x metric -> x-units (÷ metricX at the town). */
function toGeometry(layer: BuiltLayer, m0: number): THREE.BufferGeometry {
  const pos = new Float32Array(layer.position);
  for (let i = 0; i < pos.length; i += 3) pos[i] /= m0;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(layer.normal, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(layer.color, 3));
  if (layer.wave) g.setAttribute("aWave", new THREE.BufferAttribute(layer.wave, 1));
  return g;
}

interface Live {
  main: THREE.Mesh;
  detail: THREE.Mesh;
  flags: THREE.Mesh;
  radius: number;
}

interface PortCityProps {
  port: PortType;
  /** Optional label object whose y is set to the built city's label height. */
  labelRef?: React.RefObject<THREE.Object3D | null>;
}

export function PortCity({ port, labelRef }: PortCityProps) {
  const groupRef = useRef<THREE.Group>(null);
  const live = useRef<Live | null>(null);
  const mats = useMemo(() => ({ main: createCityMaterial(false), flags: createCityMaterial(true) }), []);
  const m0 = metricX(port.z);

  const dispose = () => {
    const l = live.current;
    if (!l) return;
    for (const m of [l.main, l.detail, l.flags]) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    live.current = null;
  };

  useEffect(
    () => () => {
      dispose();
      mats.main.dispose();
      mats.flags.dispose();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mats],
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !renderFocus.valid) return;
    const t = toRender(port.x, port.z);
    const dist = Math.hypot(t.x, t.z);
    if (!live.current) {
      if (dist > BUILD_DISTANCE) return;
      if (!clientLand.fallback && !clientLand.field.ready(port.x, port.z, 450)) return;
      const frame = clock.elapsedTime;
      if (lastBuildFrame === frame) return; // one city build per frame
      lastBuildFrame = frame;
      const b = getCityBuild(port);
      const mk = (layer: BuiltLayer, mat: CityMaterial) => {
        const mesh = new THREE.Mesh(toGeometry(layer, m0), mat);
        mesh.frustumCulled = false; // geometry is in local units; we cull by distance below
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        return mesh;
      };
      live.current = { main: mk(b.main, mats.main), detail: mk(b.detail, mats.main), flags: mk(b.flags, mats.flags), radius: b.radius };
      if (labelRef?.current) labelRef.current.position.y = b.labelY;
    }
    const l = live.current;
    if (dist > DISPOSE_DISTANCE) {
      dispose();
      return;
    }
    const visible = dist - l.radius < DRAW_DISTANCE;
    group.visible = visible;
    if (!visible) return;
    l.detail.visible = dist < DETAIL_DISTANCE + l.radius * 0.5;
    // floating-origin offset in float64 on the CPU (x in units, z metric)
    const ox = wrappedDelta(renderFocus.x, port.x, WORLD_C);
    const oz = port.z - renderFocus.z;
    mats.main.uniforms.uOrigin.value.set(ox, oz);
    mats.main.uniforms.uZ0.value = port.z;
    mats.flags.uniforms.uOrigin.value.set(ox, oz);
    mats.flags.uniforms.uZ0.value = port.z;
    mats.flags.uniforms.uTime.value = clock.elapsedTime;
  });

  return <group ref={groupRef} />;
}
