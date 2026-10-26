/**
 * Wire types of the admin API (docs/admin/README.md "API"), shared by the server (server/admin/) and
 * the /admin page (client/src/admin/). Types and constants only.
 */

export type AdminStatus = "combat" | "port" | "idle" | "sea";

export const ADMIN_ACTIONS = ["repairFull", "repairQuarter", "gold", "upgrade"] as const;
export type AdminActionName = (typeof ADMIN_ACTIONS)[number];
/** Largest single gold gift. */
export const MAX_ADMIN_GOLD = 1_000_000;

export interface AdminPlayerRow {
  id: string;
  name: string;
  shipType: string;
  /** Display name ("Man-o'-War"). */
  ship: string;
  /** Display name of the next ship in the upgrade path; null at the top (Dreadnaught). */
  nextShip: string | null;
  status: AdminStatus;
  /** Port name when docked (within the 300 interaction radius), else "Off <nearest port>". */
  where: string;
  lat: number;
  lon: number;
  hp: number;
  maxHp: number;
  gold: number;
  cargoUsed: number;
  cargoCapacity: number;
  /** shared/source.ts label ("TikTok", "Direct", "Search", or a domain). */
  source: string;
  campaign?: string;
  /** Wall ms when this player joined (or last reconnected). */
  onlineSince: number;
}

export interface AdminLogLine {
  at: number;
  text: string;
}

export interface AdminTodaySummary {
  /** YYYY-MM-DD in `timeZone` (server ADMIN_TZ, default America/Los_Angeles). */
  day: string;
  timeZone: string;
  /** Landing beacons by source. */
  visits: Record<string, number>;
  /** New captains (connects, not reconnects) by source. */
  captains: Record<string, number>;
  newCaptains: number;
  socialCaptains: number;
  socialBreakdown: Array<{ source: string; captains: number; visits: number }>;
  totalVisits: number;
  socialVisits: number;
}

export interface AdminStateResponse {
  now: number;
  captains: AdminPlayerRow[];
  /** NPC ships in the world right now (the active tier near players). */
  npcShips: number;
  /** NPC population records (all fleets), null when NPCs are off. */
  npcRecords: number | null;
  tickAvgMs: number;
  tickMaxMs: number;
  today: AdminTodaySummary;
  /** Newest first, at most 50. In memory: a restart clears it. */
  log: AdminLogLine[];
}

export interface AdminActionResponse {
  ok: true;
  row: AdminPlayerRow;
  text: string;
  warning?: string;
  log: AdminLogLine[];
}
