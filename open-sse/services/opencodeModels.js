// Live catalog fetcher for OpenCode free-tier models.
// Called by /v1/models route to prefer live models over static config.
// Returns { models: [{id, name}] } on success, null on failure (caller falls back to static).

const OPENCODE_MODELS_URL = "https://opencode.ai/zen/v1/models";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Models confirmed as free-tier that don't carry the "-free" suffix
const EXPLICIT_FREE_IDS = new Set([
  "big-pickle",
  "qwen3.6-plus-free",
  "minimax-m3-free",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
]);

// Module-level cache — avoids hammering opencode.ai on every /v1/models call
let _cache = { data: null, expiresAt: 0 };

/**
 * Returns true if the model id belongs to the free tier.
 * Free models either end in "-free" or are in the explicit allow-list.
 */
function isFreeModel(id) {
  if (typeof id !== "string") return false;
  return id.endsWith("-free") || EXPLICIT_FREE_IDS.has(id);
}

/**
 * Convert a raw model id to a human-readable display name.
 * e.g. "deepseek-v4-flash-free" → "DeepSeek V4 Flash Free"
 */
function toDisplayName(id) {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Fetch the live OpenCode free-tier model catalog.
 * Caches results for CACHE_TTL_MS. Returns null on any failure so callers
 * can fall back to the static PROVIDER_MODELS["oc"] list.
 *
 * @returns {Promise<{models: {id: string, name: string}[]}|null>}
 */
export async function resolveOpenCodeModels() {
  const now = Date.now();
  if (_cache.data && now < _cache.expiresAt) {
    return _cache.data;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      response = await fetch(OPENCODE_MODELS_URL, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.warn(`[opencodeModels] fetch failed: ${response.status}`);
      return null;
    }

    const raw = await response.json();
    // opencode.ai returns { data: [{id, ...}] } or [{id, ...}] directly
    const list = Array.isArray(raw) ? raw : (raw?.data ?? raw?.models ?? []);

    const models = list
      .map((m) => m?.id ?? null)
      .filter((id) => typeof id === "string" && isFreeModel(id))
      .map((id) => ({ id, name: toDisplayName(id) }));

    const result = { models };
    _cache = { data: result, expiresAt: now + CACHE_TTL_MS };
    return result;
  } catch (err) {
    console.warn(`[opencodeModels] fetch error: ${err?.message ?? err}`);
    return null;
  }
}

// Exported for unit testing
export const __test__ = {
  isFreeModel,
  toDisplayName,
  EXPLICIT_FREE_IDS,
  getCache: () => _cache,
  resetCache: () => {
    _cache = { data: null, expiresAt: 0 };
  },
};
