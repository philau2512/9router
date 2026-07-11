/**
 * Shared usage helpers (cross-provider).
 * Created for upstream a11937cdd (grok-cli usage).
 */

import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

// usage endpoints: single source from registry transport.usage
export const U = (id) => PROVIDERS[id]?.usage || {};

/**
 * Parse reset date/time to ISO string.
 * Handles multiple formats: Unix timestamp (ms/s), ISO date string, etc.
 */
export function parseResetTime(resetValue) {
  if (!resetValue) return null;
  try {
    if (resetValue instanceof Date) return resetValue.toISOString();
    if (typeof resetValue === "number") {
      return new Date(
        resetValue < 1e12 ? resetValue * 1000 : resetValue,
      ).toISOString();
    }
    if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const ts = Number(resetValue);
        return new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
      }
      return new Date(resetValue).toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

export function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (
    project &&
    typeof project === "object" &&
    typeof project.id === "string"
  ) {
    return project.id.trim() || null;
  }
  return null;
}

export async function fetchWithTimeout(
  url,
  opts,
  ms = 10000,
  proxyOptions = null,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await proxyAwareFetch(
      url,
      { ...opts, signal: controller.signal },
      proxyOptions,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
