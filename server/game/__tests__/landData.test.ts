// Data-backed checks: the REAL generated land (client/public/world/land, card W2) through the W1
// runtime path (server loader → LandField → stepShip / World).
import { describe, expect, it } from "vitest";
import path from "path";
import { loadLandSync } from "../landLoader";
import { World } from "../world";
import { shipPhysicsStats, stepShip, type ShipKinematics } from "@shared/physics";
import { bearingDeg, rotationForHeading, xOfLon, zOfLat } from "@shared/world/geo";
import ports from "@shared/world/ports.json";

const land = loadLandSync([path.resolve(__dirname, "../../../client/public/world/land")], () => {}).field;
const at = (lat: number, lon: number) => land.distance(xOfLon(lon), zOfLat(lat));

describe("real land data through the server LandField", () => {
  it("loaded real tiles (not the fallback)", () => {
    expect(at(40.42, -3.7)).toBeLessThan(0); // would be +508 on the all-water fallback
  });

  it("Madrid, Jamaica, Cuba and Panama are land; the mid-Atlantic and mid-Pacific are water", () => {
    expect(at(40.42, -3.7)).toBeLessThan(-100); // Madrid, deep inland
    expect(at(18.15, -77.3)).toBeLessThan(0); // Jamaica
    expect(at(22.0, -79.5)).toBeLessThan(0); // Cuba
    expect(at(9.0, -79.5)).toBeLessThan(0); // Panama isthmus
    expect(at(30, -40)).toBeGreaterThan(400); // mid-Atlantic
    expect(at(0, -140)).toBeGreaterThan(400); // mid-Pacific
    expect(at(75, 0)).toBeLessThan(0); // polar ice
  });

  it("every port's dock and spawn are water by the runtime sampler (dock > 80, spawn > 150)", () => {
    expect(ports.length).toBeGreaterThanOrEqual(25);
    for (const p of ports) {
      expect(land.distance(p.dock.x, p.dock.z), `${p.id} dock`).toBeGreaterThan(80);
      expect(land.distance(p.spawn.x, p.spawn.z), `${p.id} spawn`).toBeGreaterThan(150);
    }
  });

  it("a ship sails out of Port Royal's spawn (away from the town) with no land contact for 3 s", () => {
    const pr = ports.find((p) => p.id === "port_royal")!;
    const stats = shipPhysicsStats("sloop");
    let s: ShipKinematics = {
      x: pr.spawn.x,
      z: pr.spawn.z,
      rotationY: rotationForHeading(bearingDeg(pr.x, pr.z, pr.spawn.x, pr.spawn.z)),
      velocity: 0,
    };
    let minD = Infinity;
    for (let i = 0; i < 60; i++) {
      s = stepShip(s, { th: 1, ru: 0, f: 0 }, stats, land);
      minD = Math.min(minD, land.distance(s.x, s.z));
    }
    expect(minD).toBeGreaterThan(stats.hullRadius);
    expect(Math.abs(s.velocity)).toBe(stats.maxSpeed); // never slowed by a coast
  });

  it("World.spawnPoint around each port spawn only yields water", () => {
    const w = new World({ land, rng: Math.random });
    for (const p of ports) {
      for (let i = 0; i < 10; i++) {
        const sp = w.spawnPoint(p.spawn, 100);
        expect(land.distance(sp.x, sp.z), p.id).toBeGreaterThan(60);
      }
    }
  });

  it("the default World spawn (Caribbean) is water with the real land", () => {
    const w = new World({ land, rng: Math.random });
    for (let i = 0; i < 50; i++) {
      const sp = w.spawnPoint();
      expect(land.distance(sp.x, sp.z)).toBeGreaterThan(60);
    }
  });
});
