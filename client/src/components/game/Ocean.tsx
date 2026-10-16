/**
 * Ocean: a camera-following three.js `Water` plane (floating origin, WORLD_SPEC §7).
 *
 * The plane is `size`×`size` render units, re-centred under the camera every frame, so it never ends
 * and never needs to know about the map seam. To stop the waves "swimming" with the plane, the
 * Water fragment shader is patched: each of its four normal-map lookups gets a uniform offset
 * `uOffN = fract(travel / divisorN)`, where `travel` = renderFocus.travelX/Z (the float64 rendered
 * distance the origin has moved). A world point therefore always samples the same wave texel, and
 * computing the fract on the CPU in float64 keeps float32 precision fine for any session length.
 *
 * Shallow water + surf: the shader also reads a shore-distance texture (lib/world/shoreField.ts,
 * LandField.distance around the focus incl. the polar ice, rebuilt time-sliced as the ship moves).
 * Water within ~220 u of a coast is tinted turquoise and a moving foam band is drawn along the
 * first ~20 u. `uShoreOffset` = texture centre - travel (float64 on the CPU) maps render xz to uv.
 */
import { useEffect, useRef, useMemo } from "react";
import { extend, useThree, useLoader, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { renderFocus } from "@/lib/world/renderSpace";
import { clientLand } from "@/lib/world/landTiles";
import { ShoreField } from "@/lib/world/shoreField";

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

const SHORE_GLSL = /* glsl */ `
          vec2 shoreUv = ( worldPosition.xz - uShoreOffset ) / uShoreSize + 0.5;
          float shoreD = 508.0;
          if ( uShoreOn > 0.5 && shoreUv.x > 0.0 && shoreUv.x < 1.0 && shoreUv.y > 0.0 && shoreUv.y < 1.0 ) {
            shoreD = ( texture2D( uShore, shoreUv ).r * 255.0 - 128.0 ) * 4.0;
          }
          float shallow = 1.0 - smoothstep( 0.0, 220.0, shoreD );
          outgoingLight = mix( outgoingLight, vec3( 0.13, 0.5, 0.48 ), shallow * 0.5 );
          float surfBand = 1.0 - smoothstep( 3.0, 24.0, shoreD );
          float surfWave = 0.5 + 0.5 * sin( shoreD * 0.45 - time * 2.4 + noise.x * 4.0 );
          float foam = surfBand * ( 0.5 + 0.5 * surfWave ) * step( -6.0, shoreD );
          outgoingLight = mix( outgoingLight, vec3( 0.93, 0.96, 0.97 ), clamp( foam, 0.0, 1.0 ) * 0.8 );
`;

/** Patch three's Water shader: world-anchored noise offsets + shallow tint / surf foam. */
function patchWaterShader(material: THREE.ShaderMaterial): void {
  if (material.userData.worldAnchored) return;
  const src = material.fragmentShader;
  const patched = src
    .replace("vec4 getNoise( vec2 uv ) {", "uniform vec2 uOff0;\nuniform vec2 uOff1;\nuniform vec2 uOff2;\nuniform vec2 uOff3;\nvec4 getNoise( vec2 uv ) {")
    .replace("vec2 uv0 = ( uv / 103.0 )", "vec2 uv0 = ( uv / 103.0 ) + uOff0")
    .replace("vec2 uv1 = uv / 107.0", "vec2 uv1 = uv / 107.0 + uOff1")
    .replace("vec2 uv2 = uv / vec2( 8907.0, 9803.0 )", "vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + uOff2")
    .replace("vec2 uv3 = uv / vec2( 1091.0, 1027.0 )", "vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) + uOff3")
    .replace(
      "uniform vec2 uOff0;",
      "uniform sampler2D uShore;\nuniform vec2 uShoreOffset;\nuniform float uShoreSize;\nuniform float uShoreOn;\nuniform vec2 uOff0;",
    )
    .replace("vec3 outgoingLight = albedo;", "vec3 outgoingLight = albedo;\n" + SHORE_GLSL);
  if ((patched.match(/uOff/g) || []).length !== 8 || !patched.includes("shoreUv")) {
    console.warn("[Ocean] Water shader layout changed; waves will not be world-anchored");
    return;
  }
  material.fragmentShader = patched;
  for (let i = 0; i < 4; i++) material.uniforms[`uOff${i}`] = { value: new THREE.Vector2() };
  material.uniforms.uShore = { value: null };
  material.uniforms.uShoreOffset = { value: new THREE.Vector2() };
  material.uniforms.uShoreSize = { value: 1 };
  material.uniforms.uShoreOn = { value: 0 };
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

  // Shore distance field -> R8 texture (rebuilt time-sliced; see lib/world/shoreField.ts)
  const shore = useMemo(() => new ShoreField(clientLand.field), []);
  const shoreTex = useMemo(() => {
    const t = new THREE.DataTexture(shore.front, shore.size, shore.size, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }, [shore]);
  useEffect(() => () => shoreTex.dispose(), [shoreTex]);

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

      if (renderFocus.valid) {
        const f = renderFocus;
        if (shore.step(f.x, f.z, f.travelX, f.travelZ, clientLand.version)) {
          shoreTex.image.data = shore.front;
          shoreTex.needsUpdate = true;
        }
        if (shore.revision > 0) {
          mat.uniforms.uShore.value = shoreTex;
          mat.uniforms.uShoreOn.value = 1;
          mat.uniforms.uShoreSize.value = 2 * shore.half;
          (mat.uniforms.uShoreOffset.value as THREE.Vector2).set(shore.centerX - f.travelX, shore.centerZ - f.travelZ);
        }
      }
    }
  });

  return <water ref={ref} args={[geom, config]} rotation-x={-Math.PI / 2} position={[0, -10, 0]} receiveShadow />;
}
