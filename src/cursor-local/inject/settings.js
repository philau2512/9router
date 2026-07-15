/**
 * Apply/clear Cursor settings.json proxy keys (cursor-byok style).
 * Backs up previous values so stop can restore cleanly.
 */
const fs = require("fs");
const path = require("path");
const { PATHS, ensureDirs } = require("../paths");
const { settingsPath } = require("./cursorPaths");
const { proxyUrlFromListenAddr } = require("../config/defaults");
const { log, err } = require("../logger");

const INJECTED_KEYS = [
  "http.proxy",
  "http.proxyKerberosServicePrincipal",
  "http.proxySupport",
  "cursor.general.disableHttp2",
  "http.experimental.systemCertificatesV2",
];

/** Strip // and /* comments + trailing commas for JSONC */
function parseJsonc(text) {
  let s = String(text || "");
  // remove block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // remove line comments (not inside strings — best-effort)
  s = s
    .split("\n")
    .map((line) => {
      let out = "";
      let inStr = false;
      let esc = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          out += c;
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          out += c;
          continue;
        }
        if (c === "/" && line[i + 1] === "/") break;
        out += c;
      }
      return out;
    })
    .join("\n");
  // trailing commas
  s = s.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(s);
}

function readSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, "utf8");
  if (!raw.trim()) return {};
  try {
    return parseJsonc(raw);
  } catch (e) {
    // byok: delete broken settings and continue empty
    try {
      fs.unlinkSync(p);
      log(`Removed invalid Cursor settings.json: ${e.message}`);
    } catch {
      /* ignore */
    }
    return {};
  }
}

/** macOS/Linux: NODE_EXTRA_CA_CERTS so Electron/Node trusts MITM CA (byok). */
function setNodeExtraCACerts(caCertPath) {
  const p = String(caCertPath || "").trim();
  if (!p) return;
  try {
    process.env.NODE_EXTRA_CA_CERTS = p;
  } catch {
    /* ignore */
  }
  if (process.platform === "darwin") {
    try {
      const { execSync } = require("child_process");
      execSync(`launchctl setenv NODE_EXTRA_CA_CERTS ${JSON.stringify(p)}`, {
        stdio: "ignore",
      });
      log(`NODE_EXTRA_CA_CERTS set (launchctl): ${p}`);
    } catch (e) {
      err(`launchctl setenv NODE_EXTRA_CA_CERTS failed: ${e.message}`);
    }
  } else if (process.platform === "linux") {
    log("NODE_EXTRA_CA_CERTS applied to current process only (linux)");
  }
}

function clearNodeExtraCACerts() {
  try {
    delete process.env.NODE_EXTRA_CA_CERTS;
  } catch {
    /* ignore */
  }
  if (process.platform === "darwin") {
    try {
      const { execSync } = require("child_process");
      execSync("launchctl unsetenv NODE_EXTRA_CA_CERTS", { stdio: "ignore" });
      log("NODE_EXTRA_CA_CERTS cleared (launchctl)");
    } catch (e) {
      err(`launchctl unsetenv failed: ${e.message}`);
    }
  }
}

function writeSettings(obj) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const encoded = `${JSON.stringify(obj, null, 2)}\n`;
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, encoded);
  fs.renameSync(tmp, p);
}

function backupCurrentSettingsKeys() {
  ensureDirs();
  try {
    const settings = readSettings();
    const snapshot = {};
    for (const k of INJECTED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, k)) {
        snapshot[k] = settings[k];
      } else {
        snapshot[k] = { __absent: true };
      }
    }
    fs.writeFileSync(
      PATHS.settingsBackup,
      `${JSON.stringify({ at: new Date().toISOString(), keys: snapshot }, null, 2)}\n`,
    );
  } catch (e) {
    err(`settings backup failed: ${e.message}`);
  }
}

function applyProxySettings(proxyListenAddr, caCertPath) {
  const proxyURL = proxyUrlFromListenAddr(proxyListenAddr);
  backupCurrentSettingsKeys();
  const settings = readSettings();
  settings["http.proxy"] = proxyURL;
  settings["http.proxyKerberosServicePrincipal"] = proxyURL;
  settings["http.proxySupport"] = "on";
  settings["cursor.general.disableHttp2"] = true;
  settings["http.experimental.systemCertificatesV2"] = true;
  writeSettings(settings);
  if (caCertPath) setNodeExtraCACerts(caCertPath);
  log(`Cursor settings proxy applied: ${proxyURL}`);
  return { proxyURL, path: settingsPath() };
}

function clearProxySettings() {
  ensureDirs();
  clearNodeExtraCACerts();
  let settings;
  try {
    settings = readSettings();
  } catch (e) {
    err(`clear settings read failed: ${e.message}`);
    return { cleared: false, error: e.message };
  }

  // Prefer restore from backup
  if (fs.existsSync(PATHS.settingsBackup)) {
    try {
      const bak = JSON.parse(fs.readFileSync(PATHS.settingsBackup, "utf8"));
      const keys = bak.keys || {};
      for (const k of INJECTED_KEYS) {
        const prev = keys[k];
        if (prev && prev.__absent) delete settings[k];
        else if (prev !== undefined) settings[k] = prev;
        else delete settings[k];
      }
      writeSettings(settings);
      log("Cursor settings restored from backup");
      return { cleared: true, restored: true };
    } catch (e) {
      err(`settings restore failed, falling back to delete keys: ${e.message}`);
    }
  }

  for (const k of INJECTED_KEYS) delete settings[k];
  writeSettings(settings);
  log("Cursor proxy settings keys removed");
  return { cleared: true, restored: false };
}

module.exports = {
  INJECTED_KEYS,
  applyProxySettings,
  clearProxySettings,
  readSettings,
  settingsPath,
  setNodeExtraCACerts,
  clearNodeExtraCACerts,
};
