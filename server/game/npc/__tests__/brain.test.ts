import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../archetypes";
import { COMBAT_ENTER, MIN_DWELL_MS, decide, isDecisionTick, newBrain, type Perception } from "../brain";
import { firepower } from "../tactics";

function perceive(over: Partial<Perception> & { nowMs: number }): Perception {
  return { hpFrac: 1, myPower: firepower("galleon"), target: null, loot: null, hasRoute: true, ...over };
}
const target = (o: Partial<NonNullable<Perception["target"]>> = {}) => ({
  eid: 9,
  dist: 500,
  threat: 5,
  hostility: 1,
  power: firepower("sloop"),
  ...o,
});

describe("brain", () => {
  it("decisions are 4 Hz and staggered by eid", () => {
    const ticks = [...Array(20).keys()];
    expect(ticks.filter((t) => isDecisionTick(t, 3)).length).toBe(4);
    const firstFor = (eid: number) => ticks.find((t) => isDecisionTick(t, eid));
    expect(new Set([1, 2, 3, 4, 5].map(firstFor)).size).toBe(5);
  });

  it("peaceful: merchants travel, navies patrol", () => {
    expect(decide(newBrain("patrol", 0), ARCHETYPES.merchant, perceive({ nowMs: 5000 })).state).toBe("travel");
    expect(decide(newBrain("travel", 0), ARCHETYPES.navy, perceive({ nowMs: 5000 })).state).toBe("patrol");
  });

  it("a navy ship engages a close hostile target and pursues a distant one", () => {
    const b = decide(newBrain("patrol", 0), ARCHETYPES.navy, perceive({ nowMs: 100, target: target() }));
    expect(b.state).toBe("engage");
    expect(b.targetEid).toBe(9);
    const b2 = decide(newBrain("patrol", 0), ARCHETYPES.navy, perceive({ nowMs: 100, target: target({ dist: 1700 }) }));
    expect(b2.state).toBe("pursue");
  });

  it("needs COMBAT_ENTER threat to start a fight, and keeps fighting down to COMBAT_EXIT", () => {
    const b = decide(newBrain("patrol", 0), ARCHETYPES.navy, perceive({ nowMs: 100, target: target({ threat: COMBAT_ENTER * 0.5 }) }));
    expect(b.state).toBe("patrol");
    const fighting = newBrain("engage", 0);
    decide(fighting, ARCHETYPES.navy, perceive({ nowMs: 100, target: target({ threat: COMBAT_ENTER * 0.5 }) }));
    expect(fighting.state).toBe("engage");
  });

  it("merchants flee threats, then surrender at low hp (sticky)", () => {
    const b = decide(newBrain("travel", 0), ARCHETYPES.merchant, perceive({ nowMs: 100, myPower: firepower("sloop"), target: target() }));
    expect(b.state).toBe("flee");
    decide(b, ARCHETYPES.merchant, perceive({ nowMs: 200, hpFrac: 0.2, myPower: firepower("sloop"), target: target() }));
    expect(b.state).toBe("surrender");
    decide(b, ARCHETYPES.merchant, perceive({ nowMs: 5000, hpFrac: 0.2, myPower: firepower("sloop"), target: target({ dist: 3000 }) }));
    expect(b.state).toBe("surrender");
    // combat over → back to travel
    decide(b, ARCHETYPES.merchant, perceive({ nowMs: 9000, hpFrac: 0.2, target: null }));
    expect(b.state).toBe("travel");
  });

  it("pirates break off when badly outgunned", () => {
    const b = decide(
      newBrain("patrol", 0),
      ARCHETYPES.pirate,
      perceive({ nowMs: 100, myPower: firepower("sloop"), target: target({ power: firepower("man-o-war") }) }),
    );
    expect(b.state).toBe("flee");
  });

  it("hysteresis: no flip-flop between engage and pursue inside the dwell time", () => {
    const b = decide(newBrain("patrol", 0), ARCHETYPES.navy, perceive({ nowMs: 100, target: target({ dist: 800 }) }));
    expect(b.state).toBe("engage");
    // target slips just past the engage distance: stays engaged within MIN_DWELL_MS
    decide(b, ARCHETYPES.navy, perceive({ nowMs: 400, target: target({ dist: 900 }) }));
    expect(b.state).toBe("engage");
    // far away and long after: switches to pursue
    decide(b, ARCHETYPES.navy, perceive({ nowMs: 100 + MIN_DWELL_MS + 1, target: target({ dist: 2000 }) }));
    expect(b.state).toBe("pursue");
  });

  it("collects loot when peaceful", () => {
    const b = decide(newBrain("patrol", 0), ARCHETYPES.pirate, perceive({ nowMs: 5000, loot: { dist: 100 } }));
    expect(b.state).toBe("loot");
  });
});
