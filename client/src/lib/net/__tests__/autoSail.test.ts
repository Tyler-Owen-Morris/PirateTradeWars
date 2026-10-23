import { describe, it, expect } from "vitest";
import { AutoSail } from "../autoSail";

/** Tap = down then up, 50 ms apart. Returns the active state after the down edge. */
function tap(a: AutoSail, t: number) {
  const r = a.update(true, false, t);
  a.update(false, false, t + 50);
  return r;
}

describe("AutoSail", () => {
  it("single tap does not engage", () => {
    const a = new AutoSail();
    expect(tap(a, 0)).toBe(false);
    expect(a.active).toBe(false);
  });
  it("double tap within 300 ms engages and stays on with key released", () => {
    const a = new AutoSail();
    tap(a, 0);
    expect(a.update(true, false, 200)).toBe(true);
    expect(a.update(true, false, 300)).toBe(true); // still held
    expect(a.update(false, false, 400)).toBe(true);
    expect(a.update(false, false, 5000)).toBe(true);
  });
  it("slow double tap does not engage", () => {
    const a = new AutoSail();
    tap(a, 0);
    expect(tap(a, 400)).toBe(false);
  });
  it("fresh forward press cancels", () => {
    const a = new AutoSail();
    tap(a, 0);
    tap(a, 200);
    expect(a.active).toBe(true);
    expect(a.update(true, false, 1000)).toBe(false);
    expect(a.update(false, false, 1050)).toBe(false);
  });
  it("cancel press does not arm a double tap", () => {
    const a = new AutoSail();
    tap(a, 0);
    tap(a, 200);
    a.update(true, false, 1000); // cancel
    a.update(false, false, 1050);
    expect(a.update(true, false, 1150)).toBe(false); // first tap of a new pair
    a.update(false, false, 1200);
    expect(a.update(true, false, 1300)).toBe(true); // intentional new double tap
  });
  it("backward cancels", () => {
    const a = new AutoSail();
    tap(a, 0);
    tap(a, 200);
    expect(a.update(false, true, 600)).toBe(false);
    expect(a.update(false, false, 700)).toBe(false);
  });
  it("reset cancels and forgets the first tap", () => {
    const a = new AutoSail();
    tap(a, 0);
    tap(a, 200);
    a.reset();
    expect(a.active).toBe(false);
    const b = new AutoSail();
    tap(b, 0);
    b.reset();
    expect(tap(b, 100)).toBe(false);
  });
  it("held key at reset is not a fresh press", () => {
    const a = new AutoSail();
    a.reset(true);
    expect(a.update(true, false, 0)).toBe(false);
    a.update(false, false, 50);
    expect(a.update(true, false, 100)).toBe(false);
  });
});
