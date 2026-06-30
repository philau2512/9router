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
const LEVEL = LOG_LEVELS[levelName] ?? LOG_LEVELS.INFO;

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
      const keys = Object.keys(data);
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

export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[36m[${formatTime()}] ${prefix}🔍 [${tag}] ${message}${dataStr}\x1b[0m`,
    );
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[32m[${formatTime()}] ${prefix}ℹ️  [${tag}] ${message}${dataStr}\x1b[0m`,
    );
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[33m[${formatTime()}] ${prefix}⚠️  [${tag}] ${message}${dataStr}\x1b[0m`,
    );
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[31m[${formatTime()}] ${prefix}❌ [${tag}] ${message}${dataStr}\x1b[0m`,
    );
  }
}

export function request(method, path, extra) {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  const prefix = getContextPrefix();
  console.log(
    `\x1b[36m[${formatTime()}] ${prefix}📥 ${method} ${path}${dataStr}\x1b[0m`,
  );
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  const color = status < 400 ? "\x1b[32m" : "\x1b[31m";
  const prefix = getContextPrefix();
  console.log(
    `${color}[${formatTime()}] ${prefix}${icon} ${status} (${duration}ms)${dataStr}\x1b[0m`,
  );
}

export function stream(event, data) {
  const dataStr = data ? ` ${formatData(data)}` : "";
  const prefix = getContextPrefix();
  console.log(
    `\x1b[35m[${formatTime()}] ${prefix}🌊 [STREAM] ${event}${dataStr}\x1b[0m`,
  );
}

export function ttft(message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    const prefix = getContextPrefix();
    console.log(
      `\x1b[34m[${formatTime()}] ${prefix}🤯 [TTFT] ${message} | ${dataStr}\x1b[0m`,
    );
  }
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
