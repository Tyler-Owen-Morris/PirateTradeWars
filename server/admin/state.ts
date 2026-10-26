/**
 * Admin dashboard data (pure: no Redis, no sockets). Builds the captain rows for `GET /api/admin/state`
 * and validates/applies the `POST /api/admin/action` actions to a live world player.
 * docs/admin/README.md describes the fields; the wiring (queue, persistence) is in `live.ts`.
 */
import { SHIP_DISPLAY_NAMES, SHIP_UPGRADE_PATH, PORT_INTERACTION_RADIUS } from "@shared/gameConstants";
import { latOf, lonOf } from "@shared/world/geo";
import { PORTS, nearestDockPort, type GamePort } from "@shared/world/ports";
import { isNpcId, TICK_MS, type World, type WorldPlayer } from "../game/world";
import { ADMIN_ACTIONS, MAX_ADMIN_GOLD, type AdminActionName, type AdminPlayerRow, type AdminStatus } from "@shared/adminApi";

export type { AdminStatus, AdminPlayerRow, AdminActionName } from "@shared/adminApi";
export { ADMIN_ACTIONS, MAX_ADMIN_GOLD } from "@shared/adminApi";

/** Fired a broadside or took a hit within this long = "in combat". */
export const COMBAT_WINDOW_MS = 15_000;
/** No throttle/rudder/fire input for longer than this = "idle" (a hidden tab sends nothing). */
export const IDLE_AFTER_MS = 60_000;

/** "The Man-o'-War" -> "Man-o'-War". */
export function shipName(shipType: string): string {
  const n = (SHIP_DISPLAY_NAMES as Record<string, string>)[shipType];
  return n ? n.replace(/^The /, "") : shipType;
}

export function nextShipType(shipType: string): string | null {
  return SHIP_UPGRADE_PATH.find((o) => o.from === shipType)?.to ?? null;
}

/** A human player the admin can see and act on: in the world, connected, afloat. */
export function isAdminVisible(p: WorldPlayer | undefined): p is WorldPlayer {
  return !!p && p.controller === "player" && !isNpcId(p.id) && p.connected && !p.sunk && !p.dead;
}

export function playerStatus(
  p: Pick<WorldPlayer, "firedAtTick" | "hitAtTick" | "lastActiveWall">,
  tick: number,
  wallNow: number,
  docked: boolean,
): AdminStatus {
  const combatTicks = COMBAT_WINDOW_MS / TICK_MS;
  if (tick - p.firedAtTick < combatTicks || tick - p.hitAtTick < combatTicks) return "combat";
  if (docked) return "port";
  if (wallNow - p.lastActiveWall > IDLE_AFTER_MS) return "idle";
  return "sea";
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function adminRow(p: WorldPlayer, tick: number, wallNow: number, ports: readonly GamePort[] = PORTS): AdminPlayerRow {
  const near = nearestDockPort(p.x, p.z, ports);
  const docked = !!near && near.distance <= PORT_INTERACTION_RADIUS;
  const next = nextShipType(p.shipType);
  const row: AdminPlayerRow = {
    id: p.id,
    name: p.name,
    shipType: p.shipType,
    ship: shipName(p.shipType),
    nextShip: next ? shipName(next) : null,
    status: playerStatus(p, tick, wallNow, docked),
    where: near ? (docked ? near.port.name : `Off ${near.port.name}`) : "Open sea",
    lat: round2(latOf(p.z)),
    lon: round2(lonOf(p.x)),
    hp: Math.round(p.hp),
    maxHp: p.maxHp,
    gold: p.gold,
    cargoUsed: p.cargoUsed,
    cargoCapacity: p.cargoCapacity,
    source: p.source ?? "Direct",
    onlineSince: p.joinedAtWall ?? p.lastSeen,
  };
  if (p.campaign) row.campaign = p.campaign;
  return row;
}

/** Every visible captain, longest online first. */
export function adminRows(world: World, wallNow: number = Date.now()): AdminPlayerRow[] {
  const rows: AdminPlayerRow[] = [];
  world.players.forEach((p) => {
    if (isAdminVisible(p)) rows.push(adminRow(p, world.tick, wallNow));
  });
  rows.sort((a, b) => a.onlineSince - b.onlineSince || a.name.localeCompare(b.name));
  return rows;
}

/** NPC ships currently in the world (the active tier). */
export function npcShipCount(world: World): number {
  let n = 0;
  world.players.forEach((p) => {
    if (p.controller === "npc" && !p.sunk && !p.dead) n++;
  });
  return n;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

export interface AdminActionRequest {
  playerId: string;
  action: AdminActionName;
  amount?: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate a request body. Gold needs an integer amount 1..MAX_ADMIN_GOLD; the others take none. */
export function parseAdminAction(body: unknown): Parsed<AdminActionRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Bad request" };
  const b = body as Record<string, unknown>;
  const playerId = b.playerId;
  if (typeof playerId !== "string" || playerId.length === 0 || playerId.length > 64 || isNpcId(playerId)) {
    return { ok: false, error: "Bad player id" };
  }
  const action = b.action;
  if (typeof action !== "string" || !(ADMIN_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: "Unknown action" };
  if (action === "gold") {
    const amount = b.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_ADMIN_GOLD) {
      return { ok: false, error: `Gold amount must be a whole number from 1 to ${MAX_ADMIN_GOLD.toLocaleString("en-US")}` };
    }
    return { ok: true, value: { playerId, action, amount } };
  }
  return { ok: true, value: { playerId, action: action as AdminActionName } };
}

/**
 * Apply one action to the live player, synchronously (call it from the per-player queue, never from
 * the tick). The next snapshot `me` carries the new hp/gold/shipType to the player's client; an
 * upgrade also bumps metaVersion (setShipType) so viewers get a fresh `ent`.
 * Returns the log text on success.
 */
export function applyAdminAction(world: World, p: WorldPlayer | undefined, req: AdminActionRequest): Parsed<string> {
  if (!isAdminVisible(p)) return { ok: false, error: "That captain is no longer online" };
  switch (req.action) {
    case "repairFull":
      p.hp = p.maxHp;
      return { ok: true, value: `Repaired ${p.name} to full` };
    case "repairQuarter":
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp / 4));
      return { ok: true, value: `Gave ${p.name} +25% hull` };
    case "gold": {
      const amount = req.amount ?? 0;
      p.gold += amount;
      return { ok: true, value: `Gave ${p.name} +${amount.toLocaleString("en-US")} gold` };
    }
    case "upgrade": {
      const next = nextShipType(p.shipType);
      if (!next) return { ok: false, error: `${p.name} already sails the biggest ship` };
      // Same as the paid upgrade (socketHandler handleUpgradeShip) minus the cost: new stats and a full
      // hull; gold, cargo (cargoUsed + the Redis inventory) and position are untouched.
      world.setShipType(p.id, next);
      return { ok: true, value: `Upgraded ${p.name} to ${shipName(next)}` };
    }
  }
}
