/**
 * cursor-local process entry — spawned by src/lib/cursor-local/manager.js
 *
 * Env:
 *   CURSOR_LOCAL_ROUTER_BASE
 *   CURSOR_LOCAL_ROUTER_API_KEY / ROUTER_API_KEY
 *   CURSOR_LOCAL_SUDO_PASSWORD (optional)
 *   DATA_DIR
 */
const { ensureDirs, PATHS } = require("./paths");
const { log, err } = require("./logger");
const { startLifecycle, stopLifecycle, getLifecycleStatus } = require("./lifecycle/start");

async function main() {
  ensureDirs();
  log(`cursor-local starting pid=${process.pid}`);
  log(`data root=${PATHS.root}`);

  const shutdown = async (signal) => {
    log(`signal ${signal} — stopping`);
    try {
      await stopLifecycle();
    } catch (e) {
      err(`stop on signal: ${e.message}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await startLifecycle({
      sudoPassword: process.env.CURSOR_LOCAL_SUDO_PASSWORD || undefined,
    });
    log(`ready ${JSON.stringify(getLifecycleStatus())}`);
  } catch (e) {
    err(`fatal start: ${e.message}`);
    process.exit(1);
  }
}

main();
