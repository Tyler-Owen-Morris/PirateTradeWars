/**
 * Boots the game server, waits for /api/health, runs scripts/bots.ts --assert, kills the server.
 * Usage: tsx scripts/run-bot-test.ts [--bots 30] [--duration 20] [--port 5055] [--allow-remote-redis] [--json out.json]
 * Needs REDIS_CONN_STRING in the environment. Exit code = the bots' exit code (2 = harness failure).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const args = process.argv.slice(2);
function opt(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const bots = opt("bots", "30");
const duration = opt("duration", "20");
const port = opt("port", "5055");
const json = opt("json", "");
const allowRemote = args.includes("--allow-remote-redis");
const isWin = process.platform === "win32";

const redis = process.env.REDIS_CONN_STRING;
if (!redis) {
  console.error("run-bot-test: REDIS_CONN_STRING is not set (e.g. redis://localhost:6379)");
  process.exit(2);
}
if (/upstash/i.test(redis) && !allowRemote) {
  console.error("run-bot-test: REDIS_CONN_STRING points at upstash (shared/prod?). Refusing; pass --allow-remote-redis to override.");
  process.exit(2);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let server: ChildProcess | null = null;
let serverExited = false;

function killServer(): void {
  if (!server || !server.pid || serverExited) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); } }
  } catch { /* already gone */ }
}

async function waitHealthy(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (serverExited) return false;
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

async function main(): Promise<number> {
  console.log(`run-bot-test: starting server on :${port}`);
  server = spawn("npx tsx server/index.ts", {
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
    detached: !isWin, // own process group on POSIX so we can kill the whole tree
    // Dummy third-party keys: segmentClient/stripeRoutes throw at import without them (CI has none). Real env wins.
    env: { SEGMENT_WRITE_KEY: "bot-test-dummy-key", STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy", ...process.env, PORT: port, NODE_ENV: "development" },
  });
  server.on("exit", () => { serverExited = true; });

  if (!(await waitHealthy(60000))) {
    console.error(serverExited ? "run-bot-test: server exited before becoming healthy" : "run-bot-test: server not healthy within 60 s");
    return 2;
  }
  console.log("run-bot-test: server healthy, running bots");

  const botArgs = ["tsx", "scripts/bots.ts", "--assert", "--bots", bots, "--duration", duration, "--url", `ws://localhost:${port}/game-ws`];
  if (json) botArgs.push("--json", json);
  const res = spawnSync("npx", botArgs, { stdio: "inherit", shell: true });
  if (serverExited) console.error("run-bot-test: WARNING server exited during the run");
  return serverExited ? 1 : res.status ?? 2;
}

process.on("SIGINT", () => { killServer(); process.exit(130); });
process.on("SIGTERM", () => { killServer(); process.exit(143); });

main()
  .then((code) => { killServer(); process.exit(code); })
  .catch((e) => { console.error(e); killServer(); process.exit(2); });
