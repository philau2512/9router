const path = require("path");
const os = require("os");
const fs = require("fs");

function cursorUserDir() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Cursor", "User");
  }
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
    );
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "Cursor", "User");
}

function settingsPath() {
  return path.join(cursorUserDir(), "settings.json");
}

function stateDbPath() {
  return path.join(cursorUserDir(), "globalStorage", "state.vscdb");
}

function pathExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

module.exports = {
  cursorUserDir,
  settingsPath,
  stateDbPath,
  pathExists,
};
