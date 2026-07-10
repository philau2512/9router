import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];

/** Get candidate db paths by platform */
function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
      ),
      join(
        home,
        "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
      ),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        appData,
        "Cursor - Insiders",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        localAppData,
        "Programs",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

const normalize = (value) => {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
};

/**
 * Extract tokens via better-sqlite3 (bundled dependency).
 * This is the preferred strategy — no external CLI required.
 */
async function extractTokensViaBetterSqlite(dbPath) {
  // Use dynamic import so vi.mock("better-sqlite3") can intercept in tests
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const normalize = (value) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  // Exact key lookup via bulk IN query
  const allKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const placeholders = allKeys.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`)
    .all(...allKeys);
  const rowMap = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    if (rowMap[key]) {
      accessToken = normalize(rowMap[key]);
      break;
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    if (rowMap[key]) {
      machineId = normalize(rowMap[key]);
      break;
    }
  }

  // Fuzzy fallback: single LIKE query, then partition by key content
  if (!accessToken || !machineId) {
    try {
      const fuzzyRows = db
        .prepare(
          "SELECT key, value FROM itemTable WHERE key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ? LIMIT 20",
        )
        .all("%accessToken%", "%access_token%", "%machineId%", "%machine_id%");
      for (const r of fuzzyRows || []) {
        if (!r.value) continue;
        const k = r.key.toLowerCase();
        if (
          !accessToken &&
          (k.includes("accesstoken") || k.includes("access_token"))
        ) {
          accessToken = normalize(r.value);
        } else if (
          !machineId &&
          (k.includes("machineid") || k.includes("machine_id"))
        ) {
          machineId = normalize(r.value);
        }
      }
    } catch {
      /* ignore */
    }
  }

  db.close();
  return { accessToken, machineId };
}

/**
 * Extract tokens via sqlite3 CLI.
 * Fallback when better-sqlite3 native bindings are unavailable.
 */
async function extractTokensViaCLI(dbPath) {
  const normalize = (raw) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (sql) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        accessToken = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        machineId = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 → sqlite3 CLI → manual fallback
 */
export async function GET() {
  try {
    const platform = process.platform;
    if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
      return NextResponse.json(
        { found: false, error: "Unsupported platform" },
        { status: 400 },
      );
    }
    const candidates = getCandidatePaths(platform);

    let dbPath = null;
    // Linux: single hardcoded path, no probing — keep backward compat
    if (platform === "linux") {
      const linuxPath = candidates[0];
      if (!linuxPath) {
        return NextResponse.json({
          found: false,
          error:
            "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
        });
      }
      try {
        // Check file exists via sync stat
        const fsSync = require("fs");
        if (!fsSync.existsSync(linuxPath)) throw new Error("not found");
        dbPath = linuxPath;
      } catch {
        return NextResponse.json({
          found: false,
          error:
            "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
        });
      }
    } else {
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.R_OK);
          dbPath = candidate;
          break;
        } catch {
          // Try next candidate
        }
      }
    }

    if (!dbPath && platform !== "linux") {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found in known macOS locations. Checked:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    // On Linux, verify Cursor is actually installed (not just leftover config)
    if (platform === "linux") {
      let cursorInstalled = false;
      try {
        await execFileAsync("which", ["cursor"], { timeout: 5000 });
        cursorInstalled = true;
      } catch {
        try {
          const desktopFile = join(
            homedir(),
            ".local/share/applications/cursor.desktop",
          );
          await access(desktopFile, constants.R_OK);
          cursorInstalled = true;
        } catch {
          /* not found */
        }
      }
      if (!cursorInstalled) {
        return NextResponse.json({
          found: false,
          error:
            "Cursor config files found but Cursor IDE does not appear to be installed. Skipping auto-import.",
        });
      }
    }

    // Strategy 1: better-sqlite3 (bundled — no external tools required)
    try {
      const tokens = await extractTokensViaBetterSqlite(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
      // Tokens not found even after fuzzy — login required
      if (!tokens.accessToken && !tokens.machineId) {
        return NextResponse.json({
          found: false,
          error: "Please login to Cursor IDE first and try again.",
        });
      }
    } catch (dbErr) {
      // Surface open errors (e.g. SQLITE_CANTOPEN) clearly
      const msg = dbErr?.message || String(dbErr);
      if (
        msg &&
        (msg.includes("SQLITE_") ||
          msg.includes("CANTOPEN") ||
          !msg.toLowerCase().includes("bindings"))
      ) {
        return NextResponse.json({
          found: false,
          error: `Cursor database found at ${dbPath} but could not open it: ${msg}`,
        });
      }
      // Native bindings unavailable — try CLI fallback
    }

    // Strategy 2: sqlite3 CLI
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // sqlite3 CLI not available either
    }

    // No tokens found — prompt login
    return NextResponse.json({
      found: false,
      error: "Please login to Cursor IDE first and try again.",
    });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
