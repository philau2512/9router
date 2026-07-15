/**
 * Data layout for cursor-local subsystem.
 * Lives under DATA_DIR/cursor-local (separate from shared MITM).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const APP_NAME = "9router";

function defaultDataDir() {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function resolveDataDir() {
  const configured = process.env.DATA_DIR || process.env.CURSOR_LOCAL_DATA_DIR;
  if (!configured) return defaultDataDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
    // If CURSOR_LOCAL_DATA_DIR points at the leaf, use it as root
    if (process.env.CURSOR_LOCAL_DATA_DIR && !process.env.DATA_DIR) {
      return configured;
    }
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") return defaultDataDir();
    throw e;
  }
}

const DATA_DIR = resolveDataDir();
// When CURSOR_LOCAL_DATA_DIR is the full leaf path, ROOT is that path.
const ROOT =
  process.env.CURSOR_LOCAL_ROOT ||
  (process.env.CURSOR_LOCAL_DATA_DIR && !process.env.DATA_DIR
    ? DATA_DIR
    : path.join(DATA_DIR, "cursor-local"));

const PATHS = {
  root: ROOT,
  config: path.join(ROOT, "config.json"),
  pid: path.join(ROOT, "pid.json"),
  caDir: path.join(ROOT, "ca"),
  caKey: path.join(ROOT, "ca", "rootCA.key"),
  caCert: path.join(ROOT, "ca", "rootCA.crt"),
  leafCache: path.join(ROOT, "ca", "leaf-cache"),
  history: path.join(ROOT, "history"),
  logs: path.join(ROOT, "logs"),
  logFile: path.join(ROOT, "logs", "cursor-local.log"),
  backups: path.join(ROOT, "backups"),
  settingsBackup: path.join(ROOT, "backups", "settings.json.bak"),
  stateDbMeta: path.join(ROOT, "backups", "state.vscdb.meta.json"),
};

function ensureDirs() {
  for (const dir of [
    PATHS.root,
    PATHS.caDir,
    PATHS.leafCache,
    PATHS.history,
    PATHS.logs,
    PATHS.backups,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { DATA_DIR, ROOT, PATHS, ensureDirs };
