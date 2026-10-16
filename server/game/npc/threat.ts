/**
 * Per-NPC threat table (proposal §3 "The threat system"). Pure, no world access.
 *
 * - at most THREAT_MAX_ENTRIES (8) entries; adding a 9th evicts the lowest
 * - being hit adds damage × THREAT_DAMAGE_MULT (2)
 * - being near adds hostility × proximity × dt (proximity = 1 at contact, 0 at sense radius)
 * - every entry decays THREAT_DECAY_PER_SEC (5 %) per second
 * - an entry not refreshed for THREAT_FORGET_MS (15 s) is forgotten
 * - the current target only changes when another entry leads it by THREAT_SWITCH_MARGIN (10 %)
 * - `callForHelp` propagates threat on an attacker to allies within HELP_RADIUS (1500)
 */
import type { NpcMetric } from "./metric";

export const THREAT_MAX_ENTRIES = 8;
export const THREAT_DAMAGE_MULT = 2;
export const THREAT_DECAY_PER_SEC = 0.05;
export const THREAT_FORGET_MS = 15_000;
export const THREAT_SWITCH_MARGIN = 0.1;
export const HELP_RADIUS = 1500;
/** Fraction of the triggering threat that each ally receives. */
export const HELP_SHARE = 0.5;
/** Entries below this are dropped on decay. */
export const THREAT_EPSILON = 0.01;

export interface ThreatEntry {
  eid: number;
  threat: number;
  /** Simulation ms of the last refresh (damage, proximity or help). */
  lastMs: number;
}

export class ThreatTable {
  readonly entries: ThreatEntry[] = [];
  /** Current target eid (sticky, see `top`). */
  current: number | null = null;

  get size(): number {
    return this.entries.length;
  }

  get(eid: number): ThreatEntry | undefined {
    for (const e of this.entries) if (e.eid === eid) return e;
    return undefined;
  }

  threatOf(eid: number): number {
    return this.get(eid)?.threat ?? 0;
  }

  /** Add raw threat to `eid` (creating or evicting as needed) and refresh it. */
  add(eid: number, amount: number, nowMs: number): void {
    if (!(amount > 0)) return;
    let e = this.get(eid);
    if (!e) {
      if (this.entries.length >= THREAT_MAX_ENTRIES) {
        let lo = 0;
        for (let i = 1; i < this.entries.length; i++) if (this.entries[i].threat < this.entries[lo].threat) lo = i;
        // A newcomer only displaces the weakest entry if it is stronger.
        if (this.entries[lo].threat >= amount) return;
        if (this.current === this.entries[lo].eid) this.current = null;
        this.entries.splice(lo, 1);
      }
      e = { eid, threat: 0, lastMs: nowMs };
      this.entries.push(e);
    }
    e.threat += amount;
    e.lastMs = nowMs;
  }

  /** Being hit: damage × 2. */
  addDamage(eid: number, damage: number, nowMs: number): void {
    this.add(eid, damage * THREAT_DAMAGE_MULT, nowMs);
  }

  /** Being near: hostility (0..1) × proximity (0..1) × dt (seconds). */
  addProximity(eid: number, hostility: number, proximity: number, dtSec: number, nowMs: number): void {
    this.add(eid, hostility * proximity * dtSec, nowMs);
  }

  /** Exponential 5 %/s decay; forget stale (15 s) or negligible entries. */
  decay(dtSec: number, nowMs: number): void {
    const f = Math.pow(1 - THREAT_DECAY_PER_SEC, dtSec);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.threat *= f;
      if (nowMs - e.lastMs > THREAT_FORGET_MS || e.threat < THREAT_EPSILON) this.removeAt(i);
    }
  }

  remove(eid: number): void {
    const i = this.entries.findIndex((e) => e.eid === eid);
    if (i >= 0) this.removeAt(i);
  }

  private removeAt(i: number): void {
    if (this.current === this.entries[i].eid) this.current = null;
    this.entries.splice(i, 1);
  }

  clear(): void {
    this.entries.length = 0;
    this.current = null;
  }

  /**
   * Current target with hysteresis. `allowed` filters out entries that may not be targeted (fair
   * play, dead ships). Keeps the current target unless another allowed entry exceeds it by 10 %.
   */
  top(allowed: (eid: number) => boolean = () => true): ThreatEntry | null {
    let best: ThreatEntry | null = null;
    for (const e of this.entries) {
      if (!allowed(e.eid)) continue;
      if (!best || e.threat > best.threat) best = e;
    }
    if (!best) {
      this.current = null;
      return null;
    }
    const cur = this.current !== null ? this.get(this.current) : undefined;
    if (cur && cur !== best && allowed(cur.eid) && best.threat <= cur.threat * (1 + THREAT_SWITCH_MARGIN)) {
      return cur;
    }
    this.current = best.eid;
    return best;
  }
}

/** An NPC that may answer a call for help. */
export interface HelpCandidate {
  eid: number;
  x: number;
  z: number;
  faction: string;
  threat: ThreatTable;
}

/**
 * Attacking an NPC raises threat on the attacker for every ally of the victim within HELP_RADIUS
 * ("call for help"). `areAllies(victimFaction, candidateFaction)` comes from factions.ts. Returns
 * how many NPCs answered.
 */
export function callForHelp(
  victim: { eid: number; x: number; z: number; faction: string },
  attackerEid: number,
  amount: number,
  candidates: Iterable<HelpCandidate>,
  areAllies: (a: string, b: string) => boolean,
  m: NpcMetric,
  nowMs: number,
): number {
  const r2 = HELP_RADIUS * HELP_RADIUS;
  let n = 0;
  for (const c of candidates) {
    if (c.eid === victim.eid || c.eid === attackerEid) continue;
    if (!areAllies(victim.faction, c.faction)) continue;
    if (m.distSq(victim.x, victim.z, c.x, c.z) > r2) continue;
    c.threat.add(attackerEid, amount * HELP_SHARE, nowMs);
    n++;
  }
  return n;
}
