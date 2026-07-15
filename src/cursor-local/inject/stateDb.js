/**
 * Inject fake Ultra auth into Cursor state.vscdb + backup/restore + statsig gate disable.
 * Ported from cursor-byok state_db.go behavior.
 */
const fs = require("fs");
const path = require("path");
const { PATHS, ensureDirs } = require("../paths");
const { stateDbPath, pathExists } = require("./cursorPaths");
const { DEFAULTS } = require("../config/defaults");
const { log, err } = require("../logger");

const AUTH_KEYS = [
  "cursorAuth/accessToken",
  "cursorAuth/refreshToken",
  "cursorAuth/cachedEmail",
  "cursorAuth/cachedSignUpType",
  "cursorAuth/stripeMembershipType",
  "cursorAuth/stripeSubscriptionStatus",
];

const STATSIG_BOOTSTRAP_KEY = "workbench.experiments.statsigBootstrap";
const DISABLED_STATSIG_GATES = [
  "decompose_always_local_ext_host",
  "cursor_extensions_isolation_v2",
];

function openDb(dbPath, readonly = false) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, {
    readonly,
    fileMustExist: readonly,
  });
  try {
    db.pragma("busy_timeout = 2000");
  } catch {
    /* ignore */
  }
  return db;
}

function djb2Hash(value) {
  let hash = 0;
  const bytes = Buffer.from(String(value), "utf8");
  for (const b of bytes) {
    hash = (Math.imul(hash, 31) + b) >>> 0;
  }
  return String(hash);
}

function disableStatsigGate(featureGates, key) {
  let gate = featureGates[key];
  if (!gate || typeof gate !== "object") {
    gate = {
      name: key,
      rule_id: "local_disabled",
      ruleID: "local_disabled",
      group_name: "local_disabled",
      groupName: "local_disabled",
      id_type: "userID",
      idType: "userID",
    };
    featureGates[key] = gate;
  }
  gate.value = false;
}

function disableCursorStatsigGates(db) {
  try {
    const row = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get(STATSIG_BOOTSTRAP_KEY);
    if (!row?.value) return;
    let raw = row.value;
    if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    let featureGates = payload.feature_gates;
    if (!featureGates || typeof featureGates !== "object") {
      featureGates = {};
      payload.feature_gates = featureGates;
    }
    const hashUsed = String(payload.hash_used || "");
    for (const gate of DISABLED_STATSIG_GATES) {
      disableStatsigGate(featureGates, gate);
      if (hashUsed.toLowerCase() === "djb2") {
        disableStatsigGate(featureGates, djb2Hash(gate));
      }
    }
    db.prepare("UPDATE ItemTable SET value = ? WHERE key = ?").run(
      JSON.stringify(payload),
      STATSIG_BOOTSTRAP_KEY,
    );
    log("Statsig gates disabled for local Ultra");
  } catch (e) {
    err(`statsig disable skipped: ${e.message}`);
  }
}

function buildInjectValues(email, token) {
  return {
    "cursorAuth/accessToken": token,
    "cursorAuth/refreshToken": token,
    "cursorAuth/cachedEmail": email,
    "cursorAuth/cachedSignUpType": DEFAULTS.signUpType,
    "cursorAuth/stripeMembershipType": DEFAULTS.membershipType,
    "cursorAuth/stripeSubscriptionStatus": DEFAULTS.subscriptionStatus,
  };
}

function backupAuthKeys(dbPath) {
  ensureDirs();
  if (!pathExists(dbPath)) {
    fs.writeFileSync(
      PATHS.stateDbMeta,
      JSON.stringify(
        { at: new Date().toISOString(), dbPath, missing: true, keys: {} },
        null,
        2,
      ),
    );
    return;
  }
  const db = openDb(dbPath, true);
  try {
    const keys = {};
    for (const key of AUTH_KEYS) {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get(key);
      if (row) {
        keys[key] = {
          present: true,
          value:
            typeof row.value === "string"
              ? row.value
              : Buffer.isBuffer(row.value)
                ? row.value.toString("utf8")
                : String(row.value),
        };
      } else {
        keys[key] = { present: false };
      }
    }
    fs.writeFileSync(
      PATHS.stateDbMeta,
      `${JSON.stringify({ at: new Date().toISOString(), dbPath, keys }, null, 2)}\n`,
    );
    log("state.vscdb auth keys backed up");
  } finally {
    db.close();
  }
}

function ensureStateDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath, false);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
  } finally {
    db.close();
  }
}

function injectCursorUserInfo(
  email = DEFAULTS.injectAccountEmail,
  token = DEFAULTS.injectAuthToken,
) {
  const dbPath = stateDbPath();
  // byok creates DB if missing — do the same
  if (!pathExists(dbPath)) {
    log(`Creating state.vscdb at ${dbPath}`);
    ensureStateDb(dbPath);
  } else {
    ensureStateDb(dbPath);
  }
  backupAuthKeys(dbPath);
  const values = buildInjectValues(email, token);
  const db = openDb(dbPath, false);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO ItemTable(key, value) VALUES(?, ?)",
    );
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        stmt.run(key, value);
      }
      disableCursorStatsigGates(db);
    });
    tx();
    log(`Injected fake Ultra session for ${email}`);
    return { dbPath, email, keys: Object.keys(values) };
  } finally {
    db.close();
  }
}

function restoreCursorUserInfo() {
  ensureDirs();
  if (!fs.existsSync(PATHS.stateDbMeta)) {
    log("No state.vscdb backup meta — skip restore");
    return { restored: false, reason: "no_backup" };
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(PATHS.stateDbMeta, "utf8"));
  } catch (e) {
    err(`state meta parse failed: ${e.message}`);
    return { restored: false, reason: "bad_meta" };
  }
  const dbPath = meta.dbPath || stateDbPath();
  if (meta.missing || !pathExists(dbPath)) {
    return { restored: false, reason: "db_missing" };
  }
  const db = openDb(dbPath, false);
  try {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO ItemTable(key, value) VALUES(?, ?)",
    );
    const del = db.prepare("DELETE FROM ItemTable WHERE key = ?");
    const tx = db.transaction(() => {
      for (const [key, info] of Object.entries(meta.keys || {})) {
        if (info && info.present) insert.run(key, info.value);
        else del.run(key);
      }
    });
    tx();
    log("Restored original Cursor auth keys from backup");
    return { restored: true };
  } catch (e) {
    err(`restore auth failed: ${e.message}`);
    return { restored: false, reason: e.message };
  } finally {
    db.close();
  }
}

module.exports = {
  AUTH_KEYS,
  injectCursorUserInfo,
  restoreCursorUserInfo,
  backupAuthKeys,
  buildInjectValues,
  stateDbPath,
  disableCursorStatsigGates,
};
