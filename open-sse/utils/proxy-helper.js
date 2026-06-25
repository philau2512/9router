import { CONNECTION_PROXY_HEADERS_TIMEOUT_MS } from "../config/runtimeConfig.js";

export function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const patterns = noProxy
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith("."))
      return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
export function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try {
    protocol = new URL(targetUrl).protocol;
  } catch {
    return null;
  }

  if (protocol === "https:") {
    return (
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
    );
  }

  return (
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  );
}

/**
 * Normalize proxy URL (allow host:port)
 */
export function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {
    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

export function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled =
    proxyOptions?.enabled === true ||
    proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(
    proxyOptions?.url ?? proxyOptions?.connectionProxyUrl,
  );
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(
    proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy,
  );
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

export function maskProxyUrl(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<invalid-proxy-url>";
  }
}

export function sanitizeProxyError(error) {
  const name = normalizeString(error?.name) || "Error";
  const code = normalizeString(error?.code);
  const message = normalizeString(error?.message)
    .replace(/\b(?:https?|socks5?|socks4):\/\/[^\s]+/gi, "<redacted-url>")
    .replace(
      /(proxy-authorization|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=<redacted>",
    )
    .slice(0, 240);

  return `${name}${code ? `/${code}` : ""}${message ? `: ${message}` : ""}`;
}

export function resolveProxyHeadersTimeoutMs(proxyOptions) {
  const configured = Number(
    proxyOptions?.connectionProxyHeadersTimeoutMs ??
      proxyOptions?.headersTimeoutMs,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return CONNECTION_PROXY_HEADERS_TIMEOUT_MS;
}
