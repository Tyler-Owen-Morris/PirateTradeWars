/**
 * NPC brain: a two-level (hierarchical) state machine whose transitions are chosen by utility
 * scores, with hysteresis. Pure: `decide()` maps (brain, archetype, perception) → brain.
 *
 *   Peaceful  { travel, patrol, loot }          Combat { engage, pursue, flee, surrender }
 *
 * 1. Super-state: enter Combat when the top threat exceeds COMBAT_ENTER and leave it only when it
 *    falls below COMBAT_EXIT (hysteresis band), or when the target is gone.
 * 2. Within the super-state every leaf state gets a utility score from hp, relative firepower,
 *    threat, hostility, distance, and the archetype's aggression/courage. The current state gets a
 *    +STAY_BONUS, and a state must have been held for MIN_DWELL_MS before a non-emergency switch.
 *    Flee and Surrender are emergencies (they bypass the dwell).
 * 3. Surrender is sticky: once struck, a merchant stays struck until combat ends.
 *
 * Decisions run at 4 Hz, staggered by eid (`isDecisionTick`), so 1/5 of the NPCs think per tick.
 * Per-tick motion (steering/tactics) is computed by the NPC system from the current state.
 */
import type { Archetype } from "./archetypes";
import { shouldDisengage } from "./tactics";

export type NpcState = "travel" | "patrol" | "engage" | "pursue" | "flee" | "loot" | "surrender";
export const PEACEFUL_STATES: readonly NpcState[] = ["travel", "patrol", "loot"];
export const COMBAT_STATES: readonly NpcState[] = ["engage", "pursue", "flee", "surrender"];

export function isCombatState(s: NpcState): boolean {
  return s === "engage" || s === "pursue" || s === "flee" || s === "surrender";
}

/** Ticks between decisions (20 Hz / 5 = 4 Hz). */
export const DECISION_EVERY_TICKS = 5;
export const DECISION_DT_SEC = DECISION_EVERY_TICKS / 20;
/** Threat needed to enter combat, and below which combat ends. */
export const COMBAT_ENTER = 1.0;
export const COMBAT_EXIT = 0.3;
export const STAY_BONUS = 0.15;
export const MIN_DWELL_MS = 1500;
/** Engage when within this × engageRange, otherwise pursue. */
export const ENGAGE_DIST_FACTOR = 1.4;
/** Merchants surrender below this hp fraction. */
export const SURRENDER_HP = 0.3;
/** Loot within this distance is worth collecting. */
export const LOOT_RADIUS = 800;

/** True on the ticks where NPC `eid` makes its 4 Hz decision. */
export function isDecisionTick(tick: number, eid: number): boolean {
  return (tick + eid) % DECISION_EVERY_TICKS === 0;
}

export interface Perception {
  nowMs: number;
  /** Own hp / maxHp. */
  hpFrac: number;
  /** Own combat power (tactics.firepower). */
  myPower: number;
  /** Top threat after fair-play filtering, or null. */
  target: {
    eid: number;
    dist: number;
    threat: number;
    /** baseHostility toward it, 0..1. */
    hostility: number;
    power: number;
  } | null;
  /** Nearest loot (gold) within LOOT_RADIUS, or null. */
  loot: { dist: number } | null;
  /** Has a lane to follow. */
  hasRoute: boolean;
}

export interface Brain {
  state: NpcState;
  enteredMs: number;
  targetEid: number | null;
}

export function newBrain(state: NpcState, nowMs: number): Brain {
  return { state, enteredMs: nowMs, targetEid: null };
}

/** Utility of every leaf state (−Infinity = not allowed). Exposed for tests and tuning. */
export function scoreStates(arch: Archetype, p: Perception, combat: boolean): Record<NpcState, number> {
  const s: Record<NpcState, number> = {
    travel: -Infinity,
    patrol: -Infinity,
    loot: -Infinity,
    engage: -Infinity,
    pursue: -Infinity,
    flee: -Infinity,
    surrender: -Infinity,
  };
  if (!combat || !p.target) {
    s.travel = p.hasRoute ? (arch.patrols ? 0.35 : 0.5) : -Infinity;
    s.patrol = arch.patrols ? 0.45 : p.hasRoute ? 0.1 : 0.3;
    if (p.loot) s.loot = (0.3 + 0.5 * arch.aggression) * (1 - p.loot.dist / LOOT_RADIUS) + 0.2;
    return s;
  }
  const t = p.target;
  const ratio = t.power / Math.max(1e-6, p.myPower); // > 1 = they are stronger
  const near = t.dist <= arch.engageRange * ENGAGE_DIST_FACTOR;
  const fight = arch.aggression * Math.max(t.hostility, 0.5) * (1 + arch.courage) / Math.max(0.5, ratio);
  s.engage = fight * (near ? 1 : 0.3);
  s.pursue = fight * (near ? 0.2 : 0.9);
  // Flee: hurt, outgunned or simply timid.
  s.flee =
    (1 - p.hpFrac) * (1 - arch.courage) +
    Math.max(0, ratio - 1) * (1 - arch.courage) * 0.5 +
    (arch.aggression < 0.2 ? 0.6 : 0) +
    (shouldDisengage(p.hpFrac, arch.courage, p.myPower, t.power) ? 1 : 0);
  if (arch.surrenders) s.surrender = p.hpFrac < SURRENDER_HP ? 2 + (SURRENDER_HP - p.hpFrac) : -Infinity;
  return s;
}

/**
 * One 4 Hz decision. Mutates and returns `brain`.
 */
export function decide(brain: Brain, arch: Archetype, p: Perception): Brain {
  const wasCombat = isCombatState(brain.state);
  const threat = p.target?.threat ?? 0;
  const combat = p.target !== null && (wasCombat ? threat >= COMBAT_EXIT : threat >= COMBAT_ENTER);

  // Sticky surrender while combat lasts.
  if (brain.state === "surrender" && combat) {
    brain.targetEid = p.target?.eid ?? brain.targetEid;
    return brain;
  }

  const scores = scoreStates(arch, p, combat);
  const current = brain.state;
  let best: NpcState = current;
  let bestScore = -Infinity;
  for (const k of Object.keys(scores) as NpcState[]) {
    const v = scores[k] + (k === current ? STAY_BONUS : 0);
    if (v > bestScore) {
      bestScore = v;
      best = k;
    }
  }
  if (bestScore === -Infinity) best = arch.patrols ? "patrol" : "travel";

  const superChanged = isCombatState(best) !== wasCombat;
  const emergency = best === "flee" || best === "surrender";
  const dwellOk = p.nowMs - brain.enteredMs >= MIN_DWELL_MS;
  if (best !== current && (superChanged || emergency || dwellOk)) {
    brain.state = best;
    brain.enteredMs = p.nowMs;
  }
  brain.targetEid = isCombatState(brain.state) ? (p.target?.eid ?? null) : null;
  return brain;
}
