/**
 * Dev-only gallery of the port-city kit (lib/city/README.md). Open `/?citydebug=1&citygallery=1` (or any
 * `citygallery` URL in `npm run dev`): every piece of the kit on flat ground, rows of houses per style,
 * forts, landmarks, extras, trees, boats and flags, with an orbit camera. `&citystyle=<style id>` shows a
 * whole generated town of that style on a straight coast instead. Not part of the game bundle's main
 * chunk (lazy-loaded from main.tsx only when the URL asks for it).
 */
import { useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { WORLD_H } from "@shared/world/geo";
import { MeshBuilder, type BuiltLayer } from "@/lib/city/meshBuilder";
import { STYLES, type FortKind, type LandmarkKind } from "@/lib/city/styles";
import { EXTRA_PIECES, flag, fort, house, landmark, tree, warehouse, boat, ship, rngFor, type CityCtx, type CitySite } from "@/lib/city/pieces";
import { buildCity } from "@/lib/city/layout";
import { flatCoastSite } from "@/lib/city/site";
import { createCityMaterial } from "@/lib/city/cityMaterial";
import { CITY_CUSTOM } from "@/lib/city/cities";

const NATION_OF: Record<string, string> = {
  spanish_colonial: "spain",
  english: "england",
  dutch: "netherlands",
  french: "france",
  portuguese: "portugal",
  pirate_haven: "pirates",
  east_asian: "portugal",
};

interface Label {
  text: string;
  x: number;
  z: number;
}

function geometry(layer: BuiltLayer): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(layer.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(layer.normal, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(layer.color, 3));
  if (layer.wave) g.setAttribute("aWave", new THREE.BufferAttribute(layer.wave, 1));
  return g;
}

/** Flat land for x < 700, water beyond. */
const SITE: CitySite = {
  sdf: (x) => (x < 700 ? -200 : 60),
  height: (x) => (x < 700 ? -6 : -16),
};

function buildGallery(): { layers: BuiltLayer[]; labels: Label[] } {
  const labels: Label[] = [];
  const base = (styleId: string): CityCtx => ({
    main,
    detail,
    flags,
    style: STYLES[styleId],
    rng: rngFor(styleId),
    nation: NATION_OF[styleId] ?? "england",
    lat: 30,
    site: SITE,
  });
  const main = new MeshBuilder(), detail = new MeshBuilder(), flags = new MeshBuilder();
  // rows of houses per style
  Object.keys(STYLES).forEach((id, row) => {
    const ctx = base(id);
    const st = ctx.style;
    const z = -400 + row * 45;
    labels.push({ text: id, x: -60, z });
    for (let i = 0; i < 8; i++) {
      const w = Math.min(st.houseW[0] + ((st.houseW[1] - st.houseW[0]) * i) / 7, st.lot - 0.3);
      const d = st.houseD[1];
      house(ctx, i * (st.lot + 2), z, 0, { w, d, floors: st.floors[i % 2] });
    }
    warehouse(ctx, 8 * (st.lot + 2) + 30, z, 0, 26, 14);
  });
  // landmarks
  const lms: LandmarkKind[] = ["bell_tower", "twin_towers", "steeple", "gothic_tower", "dome", "pagoda", "chapel", "windmill"];
  lms.forEach((k, i) => {
    const ctx = base(k === "dome" ? "english" : k === "pagoda" ? "east_asian" : k === "gothic_tower" || k === "windmill" ? "dutch" : k === "chapel" ? "pirate_haven" : "spanish_colonial");
    landmark(ctx, k, i * 70, -80, 0);
    labels.push({ text: k, x: i * 70, z: -40 });
  });
  // forts
  const forts: FortKind[] = ["star", "bastion", "castle", "morro", "palisade"];
  forts.forEach((k, i) => {
    const ctx = base(k === "castle" ? "portuguese" : k === "palisade" ? "pirate_haven" : k === "bastion" ? "english" : "spanish_colonial");
    fort(ctx, k, i * 110, 60, 0);
    labels.push({ text: `fort ${k}`, x: i * 110, z: 120 });
  });
  // extras
  const ex = ["windmill", "gallows", "careened_ship", "lighthouse", "round_tower", "belem_tower", "facade", "basilica_facade", "keep"];
  ex.forEach((k, i) => {
    const ctx = base("portuguese");
    EXTRA_PIECES[k](ctx, i * 60, 200, 0, 1);
    labels.push({ text: k, x: i * 60, z: 240 });
  });
  // trees
  (["palm", "broadleaf", "conifer"] as const).forEach((k, i) => {
    const ctx = base("english");
    for (let j = 0; j < 4; j++) tree(ctx, k, 560 + j * 14, -300 + i * 40);
    labels.push({ text: k, x: 600, z: -300 + i * 40 });
  });
  // water: boats, ships, flags
  const wctx = base("spanish_colonial");
  boat(wctx, 760, -200, 0, 1, false);
  boat(wctx, 790, -200, 0, 1.2, true);
  ship(wctx, 840, -200, 0, 1, "spain");
  ship(wctx, 900, -200, 0, 1, "pirates");
  labels.push({ text: "boats / ships", x: 830, z: -160 });
  ["england", "spain", "netherlands", "france", "portugal", "pirates"].forEach((n, i) => {
    main.box(560 + i * 22, -6, 0, 0.5, 16, 0.5, [0.3, 0.2, 0.1]);
    flag(flags, 560.25 + i * 22, 9.7, 0, 10, 6.5, n);
  });
  labels.push({ text: "flags", x: 610, z: 20 });
  return { layers: [main.finish(), detail.finish(), flags.finish()], labels };
}

function buildStyleTown(styleId: string): { layers: BuiltLayer[]; labels: Label[] } {
  const key = `gallery_${styleId}`;
  CITY_CUSTOM[key] = { style: styleId, note: "gallery" };
  const dock = { x: 0, z: 320 };
  const b = buildCity({ key, name: styleId, nation: NATION_OF[styleId], lat: 20, dock }, flatCoastSite(dock));
  delete CITY_CUSTOM[key];
  return { layers: [b.main, b.detail, b.flags], labels: [{ text: `${styleId}: ${b.stats.houses} houses, ${b.main.triangles + b.detail.triangles + b.flags.triangles} tris`, x: 0, z: -120 }] };
}

export default function CityGallery() {
  const params = new URLSearchParams(window.location.search);
  const styleId = params.get("citystyle");
  const { meshes, labels } = useMemo(() => {
    const g = styleId && STYLES[styleId] ? buildStyleTown(styleId) : buildGallery();
    const mat = createCityMaterial(false);
    const fmat = createCityMaterial(true);
    for (const m of [mat, fmat]) m.uniforms.uZ0.value = WORLD_H / 2; // metricX = 1
    const meshes = g.layers.map((l, i) => {
      const mesh = new THREE.Mesh(geometry(l), i === 2 ? fmat : mat);
      mesh.frustumCulled = false;
      return mesh;
    });
    return { meshes, labels: g.labels };
  }, [styleId]);
  const t0 = useMemo(() => performance.now(), []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#a9cbe8" }}>
      <Canvas camera={{ position: styleId ? [0, 220, 420] : [300, 260, 420], fov: 55, near: 1, far: 5000 }} onCreated={({ gl }) => gl.setClearColor("#a9cbe8")}>
        <mesh rotation-x={-Math.PI / 2} position={[styleId ? 0 : 350, -10.05, 0]}>
          <planeGeometry args={[3000, 3000]} />
          <meshBasicMaterial color="#5f8fa8" />
        </mesh>
        {!styleId && (
          <mesh rotation-x={-Math.PI / 2} position={[200, -6.05, -100]}>
            <planeGeometry args={[1000, 800]} />
            <meshBasicMaterial color="#8fae6a" />
          </mesh>
        )}
        {meshes.map((m, i) => (
          <primitive key={i} object={m} onUpdate={() => void 0} />
        ))}
        <FlagClock mats={meshes.map((m) => m.material as THREE.ShaderMaterial)} t0={t0} />
        {labels.map((l, i) => (
          <Billboard key={i} position={[l.x, 40, l.z]}>
            <Text fontSize={9} color="#222" outlineWidth={0.6} outlineColor="#fff">
              {l.text}
            </Text>
          </Billboard>
        ))}
        <OrbitControls target={styleId ? [0, 0, -60] : [300, 0, -60]} makeDefault />
      </Canvas>
    </div>
  );
}

function FlagClock({ mats, t0 }: { mats: THREE.ShaderMaterial[]; t0: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3; update(): void } | null };
  // screenshot hook: __galleryCam(x, y, z, tx, ty, tz)
  (window as any).__galleryCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
    camera.position.set(x, y, z);
    if (controls) {
      controls.target.set(tx, ty, tz);
      controls.update();
    } else camera.lookAt(tx, ty, tz);
  };
  useFrame(() => {
    for (const m of mats) m.uniforms.uTime.value = (performance.now() - t0) / 1000;
  });
  return null;
}
