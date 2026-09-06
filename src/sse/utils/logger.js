import { AsyncLocalStorage } from "async_hooks";

// Logger utility for cloud

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const levelName = (
  process.env.LOG_LEVEL ||
  process.env.NINE_ROUTER_LOG_LEVEL ||
  "INFO"
)
  .toUpperCase()
  .trim();
// Level resolved from env at load time — the baseline to restore when the
// runtime debug toggle is turned off.
const ENV_LEVEL = LOG_LEVELS[levelName] ?? LOG_LEVELS.INFO;
// Mutable so the Settings "Debug Logging" toggle can raise/lower verbosity at
// runtime without a restart. Each gate reads this live (see setDebugEnabled).
let currentLevel = ENV_LEVEL;

// Runtime toggle for the Settings debug-log switch. true → force DEBUG level;
// false → restore whatever the environment configured at boot.
export function setDebugEnabled(enabled) {
  currentLevel = enabled ? LOG_LEVELS.DEBUG : ENV_LEVEL;
}

// Expose the resolved level for callers that need to branch on verbosity.
export function isDebugLevel() {
  return currentLevel <= LOG_LEVELS.DEBUG;
}

export const logContextStore = new AsyncLocalStorage();

export function getContextPrefix() {
  const store = logContextStore.getStore();
  if (store) {
    const reqPart = store.reqId || "";
    const connPart = store.connectionId
      ? `:${store.connectionId.slice(0, 6)}`
      : "";
    return `[${reqPart}${connPart}] `;
  }
  return "";
}

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatData(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      if (keys.every((k) => typeof data[k] !== "object")) {
        return keys.map((k) => `${k}=${data[k]}`).join(" | ");
      }
    } catch {}
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// Bold amber/orange — scan-friendly for model & combo names in terminal logs.
// Level color only wraps the prefix so these codes stay visible mid-line.
export const MODEL_HL = "\x1b[1;38;5;214m";
export const MODEL_HL_RESET = "\x1b[22;39m";

/** Wrap a model or combo name for terminal highlight (amber-orange). */
export function hlModel(name) {
  if (name == null || name === "") return "";
  return `${MODEL_HL}${name}${MODEL_HL_RESET}`;
}

export function debug(tag, message, data) {
  if (currentLevel <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[36m[${formatTime()}] ${prefix}🔍 [${tag}]\x1b[0m ${message}${dataStr}`,
    );
  }
}

export function info(tag, message, data) {
  if (currentLevel <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[32m[${formatTime()}] ${prefix}ℹ️  [${tag}]\x1b[0m ${message}${dataStr}`,
    );
  }
}

export function warn(tag, message, data) {
  if (currentLevel <= LOG_LEVELS.WARN) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[33m[${formatTime()}] ${prefix}⚠️  [${tag}]\x1b[0m ${message}${dataStr}`,
    );
  }
}

export function error(tag, message, data) {
  if (currentLevel <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[31m[${formatTime()}] ${prefix}❌ [${tag}]\x1b[0m ${message}${dataStr}`,
    );
  }
}

export function request(method, path, extra) {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  const prefix = getContextPrefix();
  console.log(
    `\x1b[36m[${formatTime()}] ${prefix}📥\x1b[0m ${method} ${path}${dataStr}`,
  );
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  const color = status < 400 ? "\x1b[32m" : "\x1b[31m";
  const prefix = getContextPrefix();
  console.log(
    `${color}[${formatTime()}] ${prefix}${icon}\x1b[0m ${status} (${duration}ms)${dataStr}`,
  );
}

export function stream(event, data) {
  const dataStr = data ? ` ${formatData(data)}` : "";
  const prefix = getContextPrefix();
  console.log(
    `\x1b[35m[${formatTime()}] ${prefix}🌊 [STREAM]\x1b[0m ${event}${dataStr}`,
  );
}

export function ttft(message, data) {
  if (currentLevel <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[34m[${formatTime()}] ${prefix}🤯 [TTFT]\x1b[0m ${message} | ${dataStr}`,
    );
  }
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ── Unified request lifecycle logging (upstream a625ea9fd) ──────────────────

// Colored-dot tags to correlate request lines by session in the terminal log.
const REQ_TAGS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
let tagCursor = 0;

// Pick next tag in round-robin order.
export function nextTag() {
  return REQ_TAGS[tagCursor++ % REQ_TAGS.length];
}

// Deterministically pick a tag from a seed string (stable per session/connectionId).
export function tagForSession(seed) {
  if (!seed) return nextTag();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

// Emit a structured INFO log line tagged with a session dot.
export function line(tag, symbol, message) {
  if (currentLevel > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Emit a log line regardless of LOG_LEVEL (used for errors/fallback).
export function errorLine(tag, symbol, message) {
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Format a thinking intent object into a short display string.
export function fmtThink(intent) {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k =
      intent.budget >= 1000
        ? `${Math.round(intent.budget / 1000)}k`
        : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level;
  return null;
}
