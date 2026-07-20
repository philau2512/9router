import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";

// Periodic checkpoint to keep WAL file small (avoid huge -wal/-shm growth)
const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath) {
  const db = new Database(filePath, { timeout: 10000 });
  if (typeof db.timeout === "function") {
    db.timeout(10000); // Configure native busy timeout (10 seconds)
  }
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  const stmtCache = new Map();

  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Truncate WAL periodically via PASSIVE checkpoint to avoid exclusive locks on Windows
  const checkpointTimer = setInterval(() => {
    try {
      db.pragma("wal_checkpoint(PASSIVE)");
    } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {}
    try {
      stmtCache.clear();
    } catch {}
    try {
      db.close();
    } catch {}
  }

  // Ensure WAL is flushed and -wal/-shm files removed on shutdown
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => {
    onShutdown();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    onShutdown();
    process.exit(0);
  });

  return {
    driver: "better-sqlite3",
    run(sql, params = []) {
      return prepare(sql).run(...params);
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) {
      return db.exec(sql);
    },
    transaction(fn) {
      const maxRetries = 5;
      let delay = 50;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return db.transaction(fn)();
        } catch (err) {
          const isBusy =
            err.code === "SQLITE_BUSY" ||
            err.message?.includes("database is locked");
          if (isBusy && i < maxRetries - 1) {
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              delay + Math.random() * 50,
            );
            delay *= 2;
            continue;
          }
          throw err;
        }
      }
    },
    checkpoint() {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {}
    },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
