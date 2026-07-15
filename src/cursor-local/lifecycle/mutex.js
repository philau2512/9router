/**
 * Product mutex: cursor-local vs shared MITM Cursor DNS + OAuth import.
 * Parent process (manager) should call these; child may skip DNS checks.
 */
const fs = require("fs");
const { PATHS } = require("../paths");

function isCursorLocalRunningFromPid() {
  try {
    if (!fs.existsSync(PATHS.pid)) return false;
    const meta = JSON.parse(fs.readFileSync(PATHS.pid, "utf8"));
    const pid = meta?.pid;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Check shared MITM dnsToolEnabled.cursor if settings available.
 * Returns { ok, reasons[] }
 */
async function checkStartMutex({ getSettings } = {}) {
  const reasons = [];
  if (typeof getSettings === "function") {
    try {
      const s = await getSettings();
      if (s?.dnsToolEnabled?.cursor) {
        reasons.push(
          "Shared MITM has Cursor DNS enabled — disable Cursor on MITM page first to avoid double-hijack",
        );
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function assertNotRunningForOAuth() {
  if (isCursorLocalRunningFromPid()) {
    const err = new Error(
      "Cursor Local is running — OAuth token import is disabled until stop (fake Ultra session active)",
    );
    err.code = "CURSOR_LOCAL_MUTEX";
    err.status = 409;
    throw err;
  }
}

module.exports = {
  isCursorLocalRunningFromPid,
  checkStartMutex,
  assertNotRunningForOAuth,
};
