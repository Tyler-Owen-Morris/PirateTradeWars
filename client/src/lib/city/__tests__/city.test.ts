import { describe, expect, it } from "vitest";
import { MeshBuilder, hex } from "../meshBuilder";
import { buildCity, resolveCityStyle } from "../layout";
import { cityInputFor, flatCoastSite, makeCitySite } from "../site";
import { STYLES } from "../styles";
import { CITY_CUSTOM } from "../cities";
import { EXTRA_PIECES } from "../pieces";
import { PORTS } from "@shared/world/ports";
import { loadLandSync } from "../../../../../server/game/landLoader";

/** Every triangle's normal points away from `c` (convex primitives). */
function outward(b: MeshBuilder, c: [number, number, number]) {
  const L = b.finish();
  let bad = 0;
  for (let i = 0; i < L.position.length; i += 9) {
    const mx = (L.position[i] + L.position[i + 3] + L.position[i + 6]) / 3;
    const my = (L.position[i + 1] + L.position[i + 4] + L.position[i + 7]) / 3;
    const mz = (L.position[i + 2] + L.position[i + 5] + L.position[i + 8]) / 3;
    const d = (mx - c[0]) * L.normal[i] + (my - c[1]) * L.normal[i + 1] + (mz - c[2]) * L.normal[i + 2];
    if (d <= 0) bad++;
  }
  return { bad, tris: L.triangles };
}

describe("MeshBuilder", () => {
  it("orients box, prism, hip and dome faces outward, also in rotated frames", () => {
    const b = new MeshBuilder();
    b.push(10, 0, -5, 0.7).box(0, 0, 0, 4, 3, 2, hex("#ffffff"), { bottom: true }).pop();
    expect(outward(b, [10, 1.5, -5])).toEqual({ bad: 0, tris: 12 });
    const p = new MeshBuilder().prism(0, 0, 0, 3, 2, 5, 8, hex("#ffffff"), { bottom: true });
    expect(outward(p, [0, 2.5, 0]).bad).toBe(0);
    const h = new MeshBuilder().hip(0, 0, 0, 10, 6, 3, 0, hex("#ffffff"));
    expect(outward(h, [0, 0.5, 0]).bad).toBe(0);
    const d = new MeshBuilder().dome(0, 0, 0, 5, 8, 3, hex("#ffffff"));
    expect(outward(d, [0, 0.5, 0]).bad).toBe(0);
  });
});

describe("styles + cities", () => {
  it("every custom entry references a real style and real extra pieces", () => {
    for (const [key, c] of Object.entries(CITY_CUSTOM)) {
      if (c.style) expect(STYLES[c.style], key).toBeTruthy();
      for (const e of [...(c.extras ?? []), ...(c.tweak?.extras ?? [])]) expect(EXTRA_PIECES[e.piece], `${key}: ${e.piece}`).toBeTruthy();
      expect(PORTS.some((p) => p.key === key), `${key} is a port`).toBe(true);
    }
    for (const s of Object.values(STYLES)) for (const e of s.extras) expect(EXTRA_PIECES[e.piece], e.piece).toBeTruthy();
  });

  it("resolves nation defaults", () => {
    expect(resolveCityStyle({ key: "x", nation: "spain" }).style.id).toBe("spanish_colonial");
    expect(resolveCityStyle({ key: "x", nation: "pirates" }).style.id).toBe("pirate_haven");
    expect(resolveCityStyle({ key: "elmina", nation: "netherlands" }).style.id).toBe("portuguese");
  });
});

describe("buildCity", () => {
  it("is deterministic and works on the flat fallback coast", () => {
    const input = { key: "test_town", name: "Test", nation: "spain", lat: 20, dock: { x: 0, z: 300 } };
    const a = buildCity(input, flatCoastSite(input.dock));
    const b = buildCity(input, flatCoastSite(input.dock));
    expect(a.main.triangles).toBe(b.main.triangles);
    expect(Array.from(a.main.position.slice(0, 30))).toEqual(Array.from(b.main.position.slice(0, 30)));
    expect(a.stats.houses).toBeGreaterThan(20);
  });

  it("builds every style on the flat coast", () => {
    for (const id of Object.keys(STYLES)) {
      const input = { key: `style_${id}`, name: id, nation: "england", lat: 30, dock: { x: 200, z: 200 } };
      // force the style through a temporary custom entry
      CITY_CUSTOM[input.key] = { style: id, note: "test" };
      const c = buildCity(input, flatCoastSite(input.dock));
      delete CITY_CUSTOM[input.key];
      expect(c.styleId).toBe(id);
      expect(c.stats.houses, id).toBeGreaterThan(10);
    }
  });

  const land = loadLandSync(undefined, () => {});
  it.skipIf(!land.version)("builds all ports on the real land within budget", () => {
    const rows: string[] = [];
    let total = 0;
    const checks: (() => void)[] = [];
    for (const p of PORTS) {
      const input = cityInputFor(p);
      const c = buildCity(input, makeCitySite(land.field, p.x, p.z));
      const tris = c.main.triangles + c.detail.triangles + c.flags.triangles;
      total += tris;
      rows.push(`${p.key.padEnd(13)} ${c.styleId.padEnd(17)} h${String(c.stats.houses).padStart(3)} w${c.stats.warehouses} piers${c.stats.piers} x${c.stats.extras} t${String(c.stats.trees).padStart(3)} tris ${c.main.triangles}+${c.detail.triangles}+${c.flags.triangles} ${c.stats.ms}ms`);
      checks.push(() => {
        expect(c.stats.houses, p.key).toBeGreaterThan(8);
        expect(tris, p.key).toBeLessThan(40000);
        expect(c.main.position.every(Number.isFinite), p.key).toBe(true); // nothing is NaN
      });
    }
    if (process.env.CITY_REPORT) console.log(rows.join("\n") + `\ntotal ${total}`);
    for (const ch of checks) ch();
  });
});
