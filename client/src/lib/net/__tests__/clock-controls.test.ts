import { describe, it, expect } from "vitest";
import { ServerClock, RESET_THRESHOLD_MS } from "../clock";
import { controlsToInput, combineControls, NEUTRAL_CONTROLS } from "../controls";
import { backoffDelay } from "../connection";

describe("ServerClock", () => {
  it("takes the first sample directly", () => {
    const c = new ServerClock();
    c.onServerTime(10_000, 1_000);
    expect(c.offset).toBe(9_000);
    expect(c.serverNow(1_500)).toBe(10_500);
  });

  it("smooths jitter: converges to the true offset and filters spikes", () => {
    const c = new ServerClock();
    const trueOffset = 5_000;
    // Snapshots every 50 ms with ±20 ms of arrival jitter (deterministic pattern).
    const jitter = [0, 12, -5, 20, 3, -8, 15, 0, 9, -2];
    for (let i = 0; i < 400; i++) {
      const st = 100_000 + i * 50;
      const local = st - trueOffset + 30 + jitter[i % jitter.length]; // 30 ms base latency
      c.onServerTime(st, local);
    }
    // The estimate settles near "st − arrival" with the earliest arrivals weighted more.
    const est = c.offset;
    expect(est).toBeGreaterThan(trueOffset - 30 - 20);
    expect(est).toBeLessThan(trueOffset - 30 + 5 + 1);

    // A single late spike (+200 ms) moves the estimate only slightly.
    const before = c.offset;
    c.onServerTime(200_000, 200_000 - trueOffset + 230);
    expect(Math.abs(c.offset - before)).toBeLessThan(200 * 0.06);
  });

  it("resets on a large jump (tab sleep / server restart)", () => {
    const c = new ServerClock();
    c.onServerTime(10_000, 0);
    c.onServerTime(10_000 + RESET_THRESHOLD_MS * 5, 0);
    expect(c.offset).toBe(10_000 + RESET_THRESHOLD_MS * 5);
  });

  it("smooths RTT from pongs", () => {
    const c = new ServerClock();
    c.onPong(1000, 1100);
    expect(c.rtt).toBe(100);
    c.onPong(2000, 2200);
    expect(c.rtt).toBeCloseTo(125, 6);
  });
});

describe("controlsToInput (PROTOCOL §2/§4 mapping)", () => {
  it("W/Up → th 1 (full ahead), S/Down → th −1 (reverse)", () => {
    expect(controlsToInput({ forward: true })).toEqual({ th: 1, ru: 0, f: 0 });
    expect(controlsToInput({ backward: true })).toEqual({ th: -1, ru: 0, f: 0 });
  });
  it("A/Left → ru 1, D/Right → ru −1, Space/F → f 1", () => {
    expect(controlsToInput({ left: true })).toEqual({ th: 0, ru: 1, f: 0 });
    expect(controlsToInput({ right: true })).toEqual({ th: 0, ru: -1, f: 0 });
    expect(controlsToInput({ fire: true })).toEqual({ th: 0, ru: 0, f: 1 });
  });
  it("opposing keys cancel; neutral is all zeros", () => {
    expect(controlsToInput({ forward: true, backward: true, left: true, right: true })).toEqual({ th: 0, ru: 0, f: 0 });
    expect(controlsToInput(NEUTRAL_CONTROLS)).toEqual({ th: 0, ru: 0, f: 0 });
  });
  it("combineControls ORs keyboard and touch sources", () => {
    const c = combineControls({ forward: true }, { left: true, fire: true }, null, undefined);
    expect(c).toEqual({ forward: true, backward: false, left: true, right: false, fire: true });
    expect(controlsToInput(c)).toEqual({ th: 1, ru: 1, f: 1 });
  });
});

describe("backoffDelay", () => {
  it("doubles from 0.5 s and caps at 8 s", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoffDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
});
