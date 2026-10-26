/**
 * Live wiring of the admin API (server/admin/routes.ts) to the running game: the world snapshot for
 * `GET /api/admin/state` and the action path for `POST /api/admin/action`.
 *
 * Actions run on the per-player `playerQueue` (server/game/trade.ts), the same queue as trade, sellAll,
 * upgrade and repair, so they never interleave with a player's own read-await-write port action. The
 * change is applied synchronously to the live world player (never inside World.step), then persisted
 * with `redisStorage.updatePlayerState` like the socket handlers do. The player's client sees it on the
 * next snapshot: `me` carries hp/maxHp/gold/shipType/cargoCapacity every tick, and useSocket's
 * syncSelf pushes hp/gold/shipType changes to the HUD at once; prediction picks up the new ship stats
 * from `me.shipType`. Viewers get a fresh `ent` after an upgrade (setShipType bumps metaVersion).
 */
import { gameState } from "../game/gameState";
import { playerQueue } from "../game/trade";
import { redisStorage } from "../redisStorage";
import { trackEvent } from "../segmentClient";
import type { AdminDeps, AdminActResult, AdminWorldSnapshot } from "./routes";
import { adminRow, adminRows, applyAdminAction, npcShipCount, type AdminActionRequest } from "./state";
import { dailyStats } from "./counters";

function snapshot(): AdminWorldSnapshot {
  const world = gameState.world;
  const tick = gameState.tickStats;
  return {
    captains: adminRows(world),
    npcShips: npcShipCount(world),
    npcRecords: gameState.npcs ? gameState.npcs.stats.records : null,
    tickAvgMs: Math.round(tick.avgMs * 100) / 100,
    tickMaxMs: Math.round(tick.maxMs * 10) / 10,
  };
}

function act(req: AdminActionRequest): Promise<AdminActResult> {
  return playerQueue.run(req.playerId, async (): Promise<AdminActResult> => {
    const world = gameState.world;
    const p = world.getPlayer(req.playerId);
    const res = applyAdminAction(world, p, req); // synchronous: no tick can run in between
    if (!res.ok) return { ok: false, status: 409, error: res.error };
    const row = adminRow(p!, world.tick, Date.now());
    trackEvent(p!.id, "Admin Action", { action: req.action, amount: req.amount, gold: p!.gold, hp: p!.hp, shipType: p!.shipType });
    try {
      await redisStorage.updatePlayerState(p!);
    } catch (err) {
      console.error("[admin] persist failed:", err);
      return { ok: true, row, text: res.value, warning: "Applied in game, but saving to Redis failed (it is saved again on disconnect)." };
    }
    return { ok: true, row, text: res.value };
  });
}

export const liveAdminDeps: AdminDeps = { snapshot, act, stats: dailyStats };
