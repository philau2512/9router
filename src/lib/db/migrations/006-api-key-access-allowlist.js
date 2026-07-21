// Store API-key access allowlists as JSON arrays. Existing keys remain open
// because NULL and [] both normalize to an unrestricted side at the repo layer.
const migration = {
  version: 6,
  name: "api-key-access-allowlist",
  up(db) {
    for (const column of ["allowedProviders", "allowedModels"]) {
      try {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN ${column} TEXT`);
      } catch (error) {
        if (!error.message?.includes("duplicate column name")) throw error;
      }
    }
  },
};

export default migration;