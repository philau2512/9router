// Add pxpipe_stats column to requestDetails table.
// PxPipe (P10, upstream dcf1927f2) stores compression stats per request.
// NULL-safe: existing rows have NULL, new rows store JSON. RED-TEAM fix F5.
// Wrapped in try-catch: SQLite has no IF NOT EXISTS for ALTER TABLE ADD COLUMN;
// some DB states (fresh install, parallel migration) may already have the column.
const migration = {
  version: 5,
  name: "pxpipe-stats",
  up(db) {
    try {
      db.exec(`ALTER TABLE requestDetails ADD COLUMN pxpipe_stats TEXT`);
    } catch (e) {
      // Ignore "duplicate column name" — column already added (schema pre-seeded or re-run).
      if (!e.message?.includes("duplicate column name")) throw e;
    }
  },
};
export default migration;
