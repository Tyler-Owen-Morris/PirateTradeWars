import { describe, expect, it } from "vitest";
import { torusMetric } from "../metric";
import { areAllies } from "../factions";
import {
  HELP_RADIUS,
  THREAT_FORGET_MS,
  THREAT_MAX_ENTRIES,
  ThreatTable,
  callForHelp,
} from "../threat";

const m = torusMetric(10000, 10000);

describe("ThreatTable", () => {
  it("damage counts double, proximity is hostility × proximity × dt", () => {
    const t = new ThreatTable();
    t.addDamage(5, 10, 0);
    expect(t.threatOf(5)).toBe(20);
    t.addProximity(6, 0.5, 0.8, 2, 0);
    expect(t.threatOf(6)).toBeCloseTo(0.8);
    t.addProximity(7, 0, 1, 1, 0); // not hostile → no entry
    expect(t.get(7)).toBeUndefined();
  });

  it("decays 5 % per second", () => {
    const t = new ThreatTable();
    t.add(1, 100, 0);
    t.decay(1, 1000);
    expect(t.threatOf(1)).toBeCloseTo(95);
    for (let i = 0; i < 9; i++) t.decay(1, 1000);
    expect(t.threatOf(1)).toBeCloseTo(100 * Math.pow(0.95, 10));
  });

  it("forgets entries not refreshed for 15 s", () => {
    const t = new ThreatTable();
    t.add(1, 100, 0);
    t.add(2, 100, 0);
    t.decay(1, THREAT_FORGET_MS - 1000);
    t.add(2, 1, THREAT_FORGET_MS - 1000); // refresh 2
    t.decay(1, THREAT_FORGET_MS + 1);
    expect(t.get(1)).toBeUndefined();
    expect(t.get(2)).toBeDefined();
  });

  it("holds at most 8 entries, evicting the weakest only for a stronger newcomer", () => {
    const t = new ThreatTable();
    for (let i = 1; i <= THREAT_MAX_ENTRIES; i++) t.add(i, i * 10, 0);
    expect(t.size).toBe(8);
    t.add(100, 5, 0); // weaker than the weakest (10): ignored
    expect(t.get(100)).toBeUndefined();
    t.add(101, 15, 0); // evicts eid 1 (10)
    expect(t.size).toBe(8);
    expect(t.get(1)).toBeUndefined();
    expect(t.get(101)).toBeDefined();
  });

  it("switches target only with a 10 % lead (hysteresis)", () => {
    const t = new ThreatTable();
    t.add(1, 100, 0);
    expect(t.top()?.eid).toBe(1);
    t.add(2, 105, 0);
    expect(t.top()?.eid).toBe(1); // 105 < 110
    t.add(2, 6, 0); // 111
    expect(t.top()?.eid).toBe(2);
    t.add(1, 12, 0); // 112 vs 111: not a 10 % lead
    expect(t.top()?.eid).toBe(2);
  });

  it("top() respects the allowed filter", () => {
    const t = new ThreatTable();
    t.add(1, 100, 0);
    t.add(2, 10, 0);
    expect(t.top((eid) => eid !== 1)?.eid).toBe(2);
    expect(t.top(() => false)).toBeNull();
  });
});

describe("callForHelp", () => {
  it("raises threat on the attacker for allies within 1500 only", () => {
    const victim = { eid: 1, x: 5000, z: 5000, faction: "spain" };
    const near = { eid: 2, x: 5000 + HELP_RADIUS - 100, z: 5000, faction: "portugal", threat: new ThreatTable() };
    const far = { eid: 3, x: 5000 + HELP_RADIUS + 100, z: 5000, faction: "spain", threat: new ThreatTable() };
    const pirate = { eid: 4, x: 5100, z: 5000, faction: "pirates", threat: new ThreatTable() };
    const n = callForHelp(victim, 99, 40, [near, far, pirate], areAllies, m, 0);
    expect(n).toBe(1);
    expect(near.threat.threatOf(99)).toBe(20);
    expect(far.threat.threatOf(99)).toBe(0);
    expect(pirate.threat.threatOf(99)).toBe(0);
  });
});
