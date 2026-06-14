// Add latency_json and tokens_json columns to requestDetails for fast list queries.
// Extracts metadata from the monolithic data blob to avoid fetching large payloads.
const migration = {
  version: 3,
  name: "request-details-metadata",
  up(db) {
    // Add metadata columns (safe: ALTER TABLE ADD COLUMN is no-op if column exists)
    db.exec(`ALTER TABLE requestDetails ADD COLUMN latency_json TEXT`);
    db.exec(`ALTER TABLE requestDetails ADD COLUMN tokens_json TEXT`);

    // Backfill existing data from data blob
    const rows = db.all(`SELECT id, data FROM requestDetails`);
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        db.run(
          `UPDATE requestDetails SET latency_json = ?, tokens_json = ? WHERE id = ?`,
          [
            JSON.stringify(data.latency || {}),
            JSON.stringify(data.tokens || {}),
            row.id,
          ],
        );
      } catch {
        // Skip rows with invalid JSON
      }
    }

    // Add composite index for common list query pattern
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_rd_status_ts ON requestDetails(status, timestamp DESC)`,
    );
  },
};

export default migration;
