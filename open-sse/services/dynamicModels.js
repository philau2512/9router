/**
 * Shared dynamic-model-fetch helper (Phase 1).
 *
 * Provides a small per-credential TTL cache + timeout wrapper used by the
 * per-provider live catalog resolvers (codexModels, antigravityModels, ...).
 * On any failure the resolver returns null so the /v1/models route falls back
 * to the static PROVIDER_MODELS catalog — dynamic fetch is an enhancement, never
 * a hard dependency.
 *
 * Design mirrors services/kiroModels.js (per-credential Map cache, 5-min TTL).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Run a fetcher with a per-key TTL cache and timeout. Returns the fetcher's
 * result on success, or `null` on any error/timeout (caller falls back to
 * hardcoded models).
 *
 * @template T
 * @param {object} opts
 * @param {Map<string, {expiresAt:number, value:T}>} opts.cache - module-level cache Map
 * @param {string} opts.key - cache key (MUST include a credential discriminator)
 * @param {(signal: AbortSignal) => Promise<T|null>} opts.fetcher - performs the live fetch
 * @param {number} [opts.ttlMs] - cache TTL (default 5 min)
 * @param {number} [opts.timeoutMs] - abort timeout (default 15s)
 * @param {boolean} [opts.forceRefresh] - bypass cache
 * @param {object} [opts.log] - optional logger
 * @param {string} [opts.label] - log label
 * @returns {Promise<T|null>}
 */
export async function fetchWithFallback({
  cache,
  key,
  fetcher,
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  forceRefresh = false,
  log = null,
  label = "DYNAMIC_MODELS",
}) {
  const now = Date.now();
  if (cache && !forceRefresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const value = await fetcher(controller.signal);
    if (value == null) return null;
    if (cache) cache.set(key, { expiresAt: now + ttlMs, value });
    return value;
  } catch (err) {
    log?.debug?.(
      label,
      `live fetch failed, falling back: ${err?.message || err}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Build a cache key that never leaks across credentials. */
export function credentialCacheKey(provider, credentials) {
  const disc =
    credentials?.connectionId ||
    credentials?.id ||
    credentials?.providerSpecificData?.accountId ||
    credentials?.providerSpecificData?.chatgptAccountId ||
    credentials?.providerSpecificData?.project_id ||
    (credentials?.accessToken ? credentials.accessToken.slice(-16) : "anon");
  return `${provider}:${disc}`;
}
