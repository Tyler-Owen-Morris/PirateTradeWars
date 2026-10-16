/**
 * Ocean: a camera-following three.js `Water` plane (floating origin, WORLD_SPEC §7).
 *
 * The plane is `size`×`size` render units, re-centred under the camera every frame, so it never ends
 * and never needs to know about the map seam. To stop the waves "swimming" with the plane, the
 * Water fragment shader is patched: each of its four normal-map lookups gets a uniform offset
 * `uOffN = fract(travel / divisorN)`, where `travel` = renderFocus.travelX/Z (the float64 rendered
 * distance the origin has moved). A world point therefore always samples the same wave texel, and
 * computing the fract on the CPU in float64 keeps float32 precision fine for any session length.
 */
import { useRef, useMemo } from "react";
import { extend, useThree, useLoader, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { renderFocus } from "@/lib/world/renderSpace";

// Extend Water class to use it as a JSX component
extend({ Water });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      water: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
}

/** Divisors of the four lookups in three's Water getNoise() (uv0..uv3), per axis. */
export const WATER_NOISE_DIVISORS: ReadonlyArray<readonly [number, number]> = [
  [103, 103],
  [107, 107],
  [8907, 9803],
  [1091, 1027],
];

/** Fraction of `v / d` in [0, 1) (float64). */
function fract(v: number, d: number): number {
  const q = v / d;
  return q - Math.floor(q);
}

/** Patch three's Water shader so each noise lookup is offset by a world-anchoring uniform. */
function patchWaterShader(material: THREE.ShaderMaterial): void {
  if (material.userData.worldAnchored) return;
  const src = material.fragmentShader;
  const patched = src
    .replace("vec4 getNoise( vec2 uv ) {", "uniform vec2 uOff0;\nuniform vec2 uOff1;\nuniform vec2 uOff2;\nuniform vec2 uOff3;\nvec4 getNoise( vec2 uv ) {")
    .replace("vec2 uv0 = ( uv / 103.0 )", "vec2 uv0 = ( uv / 103.0 ) + uOff0")
    .replace("vec2 uv1 = uv / 107.0", "vec2 uv1 = uv / 107.0 + uOff1")
    .replace("vec2 uv2 = uv / vec2( 8907.0, 9803.0 )", "vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + uOff2")
    .replace("vec2 uv3 = uv / vec2( 1091.0, 1027.0 )", "vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) + uOff3");
  if ((patched.match(/uOff/g) || []).length !== 8) {
    console.warn("[Ocean] Water shader layout changed; waves will not be world-anchored");
    return;
  }
  material.fragmentShader = patched;
  for (let i = 0; i < 4; i++) material.uniforms[`uOff${i}`] = { value: new THREE.Vector2() };
  material.userData.worldAnchored = true;
  material.needsUpdate = true;
}

interface OceanProps {
  /** Plane edge length in render units (≥ 2 × camera far plane so its edge is never seen). */
  size?: number;
}

export function Ocean({ size = 6000 }: OceanProps) {
  const ref = useRef<Water>(null);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  // Load water normals texture
  const waterNormals = useLoader(THREE.TextureLoader, "/textures/waternormals.jpg");
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

  const geom = useMemo(() => new THREE.PlaneGeometry(size, size), [size]);

  // Configure water properties
  const config = useMemo(
    () => ({
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: new THREE.Vector3(0, 1, 0), // Sun above
      sunColor: 0xffffff, // White sunlight
      waterColor: 0x001e0f, // Deep blue-green
      distortionScale: 3.7, // Wave distortion
      fog: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: (gl as any).encoding,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [waterNormals, (gl as any).encoding],
  );

  useFrame((_state, delta) => {
    const water = ref.current;
    if (!water) return;
    const mat = water.material as THREE.ShaderMaterial;
    patchWaterShader(mat);
    mat.uniforms.time.value += delta;

    // Follow the camera (render space); waves stay anchored via the travel offsets.
    water.position.set(camera.position.x, -10, camera.position.z);
    if (mat.userData.worldAnchored) {
      // Plane is rotated −90° about X: shader worldPosition.xz = render x/z; `size` uniform scales uv.
      const s = (mat.uniforms.size?.value as number) ?? 1;
      const tx = renderFocus.travelX * s;
      const tz = renderFocus.travelZ * s;
      for (let i = 0; i < 4; i++) {
        const [dx, dz] = WATER_NOISE_DIVISORS[i];
        (mat.uniforms[`uOff${i}`].value as THREE.Vector2).set(fract(tx, dx), fract(tz, dz));
      }
    }
  });

  return <water ref={ref} args={[geom, config]} rotation-x={-Math.PI / 2} position={[0, -10, 0]} receiveShadow />;
}
