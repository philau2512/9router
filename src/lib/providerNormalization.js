import { AI_PROVIDERS } from "../shared/constants/providers.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase(),
  );
  return providerByName?.id || trimmed;
}

// Clamp caps for custom compatible-provider timeout knobs (ms raw, no convert).
// connect max = 120s (matches qoder built-in), stall max = 10 min.
export const CONNECTION_TIMEOUT_MAX_MS = 120000;
export const STALL_TIMEOUT_MAX_MS = 600000;

/**
 * Resolve a timeout field from a request body into a persist-ready value.
 * Three-state contract (agreed with product):
 *   undefined → caller keeps existing value (field absent from body / old client)
 *   null      → caller clears the field (empty UI input → back to runtime default)
 *   number    → clamped to [1, maxMs] and set
 * Garbage (NaN, <=0, non-number) is treated as clear (null) — never persist dirty values.
 * @param {*} raw
 * @param {number} maxMs
 * @returns {number|null|undefined}
 */
export function resolveTimeoutField(raw, maxMs) {
  if (raw === undefined) return undefined; // client did not send → keep
  if (raw === null || raw === "") return null; // empty input → clear
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null; // garbage → clear
  return Math.min(n, maxMs); // clamp to cap
}

export function normalizeProviderSpecificData(
  provider,
  body = {},
  providerSpecificData = null,
) {
  const next =
    providerSpecificData && typeof providerSpecificData === "object"
      ? { ...providerSpecificData }
      : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  return Object.keys(next).length > 0 ? next : null;
}
