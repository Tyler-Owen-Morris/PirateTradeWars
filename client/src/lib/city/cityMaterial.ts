/**
 * Materials for the port-city kit. One ShaderMaterial per city (its uniforms carry the city's
 * floating-origin offset) sharing ONE program across all cities: same source, so three.js compiles it
 * once. Lighting matches the terrain chunks (lib/world/terrain.ts): sRGB vertex colours, the same sun
 * direction, sun colour and ambient, plus scene fog.
 *
 * Geometry convention (PortCity.tsx): x in world x-UNITS relative to the town, z/y metric. The vertex
 * shader applies the exact render transform of WORLD_SPEC §7 per vertex, like the terrain does:
 *     rx = (uOrigin.x + x) * metricX(uZ0 + z),   rz = uOrigin.y + z
 * with uOrigin = (wrappedDelta(F.x, town.x), town.z − F.z) computed in float64 on the CPU each frame.
 * So the town sits exactly on the terrain and never jitters or drifts.
 *
 * Flags: `aWave` (0 at the hoist .. 1 at the fly) displaces vertices along their normal with a
 * travelling sine (uTime), double-sided lighting.
 */
import * as THREE from "three";
import { WORLD_H } from "@shared/world/geo";

const SUN_DIR = new THREE.Vector3(50, 100, 50).normalize();

const VERT = /* glsl */ `
uniform vec2 uOrigin;
uniform float uZ0;
uniform float uWorldH;
uniform float uTime;
attribute vec3 aColor;
#ifdef FLAG
attribute float aWave;
#endif
varying vec3 vColor;
varying vec3 vNormal;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
#ifdef FLAG
  float ph = uTime * 4.2 - aWave * 6.5 + position.z * 0.07 + position.x * 0.05;
  p += normal * sin(ph) * aWave * 0.9;
#endif
  float mx = max(sin((uZ0 + p.z) * 3.141592653589793 / uWorldH), 0.01);
  vec3 r = vec3((uOrigin.x + p.x) * mx, p.y, uOrigin.y + p.z);
  vec4 mvPosition = modelViewMatrix * vec4(r, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vColor = aColor;
  vNormal = normal;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec3 vColor;
varying vec3 vNormal;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vNormal);
#ifdef FLAG
  if (!gl_FrontFacing) n = -n;
#endif
  float diff = max(dot(n, uSunDir), 0.0);
  // soft sky fill from above so shaded walls are not black
  float sky = 0.5 + 0.5 * n.y;
  vec3 base = pow(vColor, vec3(2.2));
  gl_FragColor = vec4(base * (uAmbient * (0.75 + 0.35 * sky) + uSunColor * diff), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type CityMaterial = THREE.ShaderMaterial & {
  uniforms: { uOrigin: { value: THREE.Vector2 }; uZ0: { value: number }; uTime: { value: number } };
};

export function createCityMaterial(flag = false): CityMaterial {
  return new THREE.ShaderMaterial({
    name: flag ? "CityFlag" : "City",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOrigin: { value: new THREE.Vector2() },
        uZ0: { value: 0 },
        uWorldH: { value: WORLD_H },
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
        uSunColor: { value: new THREE.Color(0.8, 0.78, 0.72) },
        uAmbient: { value: new THREE.Color(0.42, 0.45, 0.5) },
      },
    ]),
    defines: flag ? { FLAG: "" } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    side: flag ? THREE.DoubleSide : THREE.FrontSide,
  }) as CityMaterial;
}
