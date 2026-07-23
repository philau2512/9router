// Add usageHistory.performance JSON column for TTFT / tokens-per-second metrics.
// Wrapped in try-catch: SQLite has no IF NOT EXISTS for ALTER TABLE ADD COLUMN.
export default {
  version: 7,
  name: "usage-history-performance",
  up(db) {
    try {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN performance TEXT`);
    } catch {
      // Column already exists
    }
  },
};