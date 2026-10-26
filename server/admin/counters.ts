/** The process-wide daily traffic counters (server/admin/stats.ts) on the real Redis. Used by the socket
 *  handler (new captains), `POST /api/visit` (visits) and the admin state endpoint. */
import { redisStorage } from "../redisStorage";
import { DailyStats } from "./stats";

export const dailyStats = new DailyStats(redisStorage);
