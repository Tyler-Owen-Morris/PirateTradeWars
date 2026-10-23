import { describe, it, expect } from "vitest";
import { NetDebugStats, installNetDebug, netDebugEnabled } from "../netDebug";
import { NetClient } from "../netClient";
import { Predictor } from "../prediction";
import { WORLD_H } from "@shared/world/geo";

describe("netdebug overlay", () => {
  it("is enabled only by netdebug=1", () => {
    expect(netDebugEnabled("?netdebug=1")).toBe(true);
    expect(netDebugEnabled("?a=2&netdebug=1&b=3")).toBe(true);
    expect(netDebugEnabled("")).toBe(false);
    expect(netDebugEnabled("?netdebug=0")).toBe(false);
    expect(netDebugEnabled("?netdebug=10")).toBe(false);
  });

  it("install is a no-op outside a browser", () => {
    const net = new NetClient({ socketFactory: () => ({}) as any } as any);
    const off = installNetDebug(net);
    expect(net.predictor.onCorrection).toBeNull();
    off();
  });

  it("counts corrections > 1 unit in a 10 s window and ack stalls", () => {
    const s = new NetDebugStats();
    s.onCorrection(0, 0.5); // ignored
    s.onCorrection(100, 12);
    s.onCorrection(200, 40);
    s.onSnapshot(0, 5, 3);
    s.onSnapshot(50, 5, 4); // ack did not advance with inputs pending → stall
    s.onSnapshot(100, 6, 4);
    expect(s.summary(1000)).toEqual({ recent: 2, maxRecent: 40, snapsPerSec: 3, ackStalls: 1 });
    expect(s.summary(10_150)).toMatchObject({ recent: 1, maxRecent: 40, ackStalls: 0 });
    expect(s.totalCorrections).toBe(2);
    expect(s.maxEver).toBe(40);
  });

  it("Predictor.diag/onCorrection report reconcile corrections", () => {
    const p = new Predictor();
    const seen: number[] = [];
    p.onCorrection = (d) => seen.push(d);
    p.reconcile({ x: 1000, z: WORLD_H / 2, r: 0, v: 0 }, -1); // first: initializes, not counted
    p.reconcile({ x: 1000, z: WORLD_H / 2, r: 0, v: 0 }, -1);
    p.reconcile({ x: 1030, z: WORLD_H / 2, r: 0, v: 0 }, -1);
    expect(seen.length).toBe(2);
    expect(p.diag.reconciles).toBe(2);
    expect(p.diag.corrections).toBe(1);
    expect(p.diag.maxCorrection).toBeCloseTo(30, 6);
  });
});
