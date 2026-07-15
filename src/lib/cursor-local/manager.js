/**
 * Parent-side manager: spawn/stop cursor-local child process.
 * Mirrors patterns from src/mitm/manager.js (PID, health poll, env).
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import { createRequire } from "module";
import {
  resolveCursorLocalEntry,
  cursorLocalPidPath,
  cursorLocalRoot,
  cursorLocalLogPath,
  cursorLocalConfigPath,
} from "./paths.js";

const require = createRequire(import.meta.url);
const { checkStartMutex } = require("../../cursor-local/lifecycle/mutex.js");

let childProc = null;

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile() {
  try {
    const p = cursorLocalPidPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function clearPidFile() {
  try {
    const p = cursorLocalPidPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function loadDiskConfig() {
  try {
    const p = cursorLocalConfigPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function pollBackendHealth(backendAddr, timeoutMs = 20000) {
  const url = `http://${backendAddr}/healthz`;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        let body = "";
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve({ ok: true, body: JSON.parse(body) });
            } catch {
              resolve({ ok: true });
            }
          } else if (Date.now() < deadline) setTimeout(tick, 400);
          else resolve({ ok: false });
        });
      });
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(tick, 400);
        else resolve({ ok: false });
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.routerBase]
 * @param {string} [opts.sudoPassword]
 * @param {function} [opts.getSettings]
 */
export async function startCursorLocal(opts = {}) {
  const mutex = await checkStartMutex({ getSettings: opts.getSettings });
  if (!mutex.ok) {
    const err = new Error(mutex.reasons.join("; "));
    err.code = "CURSOR_LOCAL_MUTEX";
    throw err;
  }

  // Already running?
  const existing = readPidFile();
  if (existing?.pid && isProcessAlive(existing.pid)) {
    const health = await pollBackendHealth(
      existing.backendListenAddr || "127.0.0.1:18090",
      3000,
    );
    if (health.ok) {
      return getCursorLocalStatus();
    }
    // stale
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    clearPidFile();
  }

  const entry = resolveCursorLocalEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`cursor-local entry not found: ${entry}`);
  }

  fs.mkdirSync(cursorLocalRoot(), { recursive: true });
  fs.mkdirSync(path.join(cursorLocalRoot(), "logs"), { recursive: true });

  const cfg = loadDiskConfig();
  const backendListenAddr = cfg.backendListenAddr || "127.0.0.1:18090";
  const routerBase =
    opts.routerBase ||
    cfg.routerBaseUrl ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://127.0.0.1:20128";

  const env = {
    ...process.env,
    CURSOR_LOCAL_ROUTER_BASE: routerBase.replace(/\/+$/, ""),
    CURSOR_LOCAL_ROUTER_API_KEY:
      opts.apiKey || process.env.ROUTER_API_KEY || "",
    ROUTER_API_KEY: opts.apiKey || process.env.ROUTER_API_KEY || "",
  };
  if (opts.sudoPassword) {
    env.CURSOR_LOCAL_SUDO_PASSWORD = opts.sudoPassword;
  }

  const logFd = fs.openSync(cursorLocalLogPath(), "a");
  childProc = spawn(process.execPath, [entry], {
    env,
    detached: false,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  fs.closeSync(logFd);

  childProc.on("exit", (code, signal) => {
    childProc = null;
    // leave pid file for diagnosis if crash; clear if clean
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
      clearPidFile();
    }
  });

  const health = await pollBackendHealth(backendListenAddr, 45000);
  if (!health.ok) {
    try {
      childProc?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    childProc = null;
    throw new Error(
      "cursor-local failed to become healthy — check logs at " +
        cursorLocalLogPath(),
    );
  }

  // Wait until full activation (CA + settings), not only backend health (byok contract)
  const readyDeadline = Date.now() + 60000;
  while (Date.now() < readyDeadline) {
    const meta = readPidFile();
    if (
      meta?.state?.ready === true ||
      (meta?.state?.settingsApplied === true && meta?.state?.running === true)
    ) {
      break;
    }
    if (meta?.state?.lastError) {
      try {
        childProc?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      throw new Error(`cursor-local start failed: ${meta.state.lastError}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return getCursorLocalStatus();
}

export async function stopCursorLocal() {
  const meta = readPidFile();
  const pid = meta?.pid || childProc?.pid;
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    // wait up to 8s
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && isProcessAlive(pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  childProc = null;
  clearPidFile();
  return getCursorLocalStatus();
}

export async function getCursorLocalStatus() {
  const meta = readPidFile();
  const pid = meta?.pid || null;
  const alive = pid ? isProcessAlive(pid) : false;
  let health = null;
  if (alive && meta?.backendListenAddr) {
    health = await pollBackendHealth(meta.backendListenAddr, 2000);
  }
  return {
    running: alive && !!health?.ok,
    pid: alive ? pid : null,
    backendListenAddr: meta?.backendListenAddr || null,
    proxyListenAddr: meta?.proxyListenAddr || null,
    phase: meta?.state?.phase || (alive ? "A" : null),
    certTrusted: meta?.state?.certTrusted ?? null,
    settingsApplied: meta?.state?.settingsApplied ?? null,
    authInjected: meta?.state?.authInjected ?? null,
    lastError: meta?.state?.lastError || null,
    startedAt: meta?.startedAt || null,
    entry: resolveCursorLocalEntry(),
    dataDir: cursorLocalRoot(),
    logPath: cursorLocalLogPath(),
  };
}

export function killCursorLocalSync() {
  const meta = readPidFile();
  const pid = meta?.pid;
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  childProc = null;
  clearPidFile();
}

export { isProcessAlive, readPidFile };
