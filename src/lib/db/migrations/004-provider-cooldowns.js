// Add provider_cooldowns table for persistent cooldown state across restarts.
const migration = {
  version: 4,
  name: "provider-cooldowns",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_cooldowns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        auth_id TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        next_retry_after INTEGER NOT NULL,
        reason TEXT,
        status TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_cooldowns_key
        ON provider_cooldowns(provider, auth_id, model)
    `);
  },
};
export default migration;
