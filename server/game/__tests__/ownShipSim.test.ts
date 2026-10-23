// End-to-end own-ship netcode regression (bug 2026-10-23: "my ship jumps back, then warps forward
// 10 km"). Real client Predictor + real server World/FixedStepLoop over simulated TCP links; see
// ownShipSim.ts. Before the fix (server stepped a starved ship with its last input) these scenarios
// produced corrections of one tick of travel FORWARD per starved tick (12 units for a sloop) and
// 72-132 units BACKWARD when the post-stall burst overflowed the 10-input queue.
import { describe, it, expect } from "vitest";
import { simulate, type SimOptions } from "./ownShipSim";
import type { ShipInput } from "@shared/physics";

const D = 30_000;
/** Wiggly helm: ahead, with alternating left/right turns and a second of coasting every 7 s. */
const helm = (t: number): ShipInput => {
  const s = Math.floor(t / 1000);
  return { th: s % 7 === 6 ? 0 : 1, ru: s % 4 === 1 ? 1 : s % 4 === 3 ? -1 : 0, f: 0 };
};

const scenarios: [string, SimOptions][] = [
  ["clean link", { durationMs: D }],
  ["jitter 60 ms", { durationMs: D, jitterMs: 60, seed: 7 }],
  ["45 fps + jitter 30 ms", { durationMs: D, frameMs: 1000 / 45, jitterMs: 30, seed: 3 }],
  ["uplink TCP stall 800 ms (dreadnaught)", { durationMs: D, uplinkStalls: [{ at: 10_000, ms: 800 }], shipType: "dreadnaught" }],
  [
    "repeated uplink stalls 150-1500 ms",
    {
      durationMs: D,
      jitterMs: 25,
      seed: 11,
      uplinkStalls: [
        { at: 4000, ms: 150 },
        { at: 9000, ms: 400 },
        { at: 15_000, ms: 1500 },
        { at: 22_000, ms: 300 },
      ],
    },
  ],
  ["downlink stall 700 ms", { durationMs: D, downlinkStalls: [{ at: 12_000, ms: 700 }] }],
  ["server event-loop stall 1 s", { durationMs: D, serverStalls: [{ at: 10_000, ms: 1000 }] }],
  ["client frame hitch 600 ms", { durationMs: D, clientHitches: [{ at: 10_000, ms: 600 }] }],
  [
    "everything at once + turning helm (galleon)",
    {
      durationMs: D,
      jitterMs: 40,
      seed: 5,
      input: helm,
      shipType: "galleon",
      uplinkStalls: [{ at: 6000, ms: 500 }],
      serverStalls: [{ at: 14_000, ms: 400 }],
      clientHitches: [{ at: 20_000, ms: 350 }],
    },
  ],
];

describe("own ship over a lossy link (prediction + server input queue)", () => {
  for (const [name, opts] of scenarios) {
    it(`${name}: no reconciliation correction at all`, () => {
      const r = simulate(opts);
      if (!opts.input) expect(r.crossedSeam).toBe(true); // straight runs cross the x wrap seam
      expect(r.snaps).toBe(0);
      expect(r.maxCorrection).toBeLessThan(1e-6);
      expect(r.finalGap).toBeLessThan(1e-6);
    });
  }

  it("an uplink outage longer than the input queue (3 s) costs only a bounded backward correction", () => {
    const r = simulate({ durationMs: D, uplinkStalls: [{ at: 10_000, ms: 3000 }] });
    const big = r.corrections.filter((c) => c.dist > 1);
    expect(big.length).toBeGreaterThan(0);
    expect(big.length).toBeLessThanOrEqual(2);
    // Inputs dropped by the queue cap were never simulated → backward only, never a forward warp.
    for (const c of big) expect(c.along).toBeLessThan(0);
    // 3 s = 60 inputs, the queue keeps 40 → ~20 ticks of sloop travel (12/tick), not more.
    expect(big.reduce((a, c) => a + c.dist, 0)).toBeLessThan(21 * 12 + 1);
    expect(r.finalGap).toBeLessThan(1e-6);
  });
});
