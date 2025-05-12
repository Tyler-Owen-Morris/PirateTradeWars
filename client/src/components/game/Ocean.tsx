import { useRef, useMemo } from "react";
import { extend, useThree, useLoader, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { MAP_WIDTH, MAP_HEIGHT } from "../../lib/constants";

// Extend Water class to use it as a JSX component
extend({ Water });

export function Ocean() {
  const ref = useRef();
  const gl = useThree((state) => state.gl);

  // Load water normals texture
  const waterNormals = useLoader(
    THREE.TextureLoader,
    "/textures/waternormals.jpg"
  );
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

  // Create plane geometry for the water surface
  const geom = useMemo(
    () => new THREE.PlaneGeometry(MAP_WIDTH * 3, MAP_HEIGHT * 3),
    []
  );

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
      format: gl.encoding,
    }),
    [waterNormals, gl.encoding]
  );

  // Animate water (update time for wave movement)
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.material.uniforms.time.value += delta;
    }
  });

  return (
    <water
      ref={ref}
      args={[geom, config]}
      rotation-x={-Math.PI / 2}
      position={[MAP_WIDTH / 2, -10, MAP_HEIGHT / 2]}
      receiveShadow
    />
  );
}