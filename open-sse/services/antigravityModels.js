/**
 * Antigravity live model catalog resolver.
 *
 * Fetches the dynamic model list from Google Cloud Code:
 *   POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
 * with the OAuth access token + project id, trying prod → daily → sandbox base
 * URLs. Ported from CLIProxyAPI cmd/fetch_antigravity_models/main.go.
 *
 * Returns { models: [{ id, name }] } on success, or null on any failure so the
 * /v1/models route falls back to the static PROVIDER_MODELS["ag"] catalog.
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { getPlatformUserAgent } from "../config/appConstants.js";
import { fetchWithFallback, credentialCacheKey } from "./dynamicModels.js";
import {
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_DYNAMIC_MODEL_SKIP_IDS,
  ANTIGRAVITY_OPERATIONS,
} from "../providers/antigravity-provider-metadata.js";

/** @type {Map<string, { expiresAt: number, value: { models: object[] } }>} */
const catalogCache = new Map();

/**
 * @param {object} credentials - { accessToken, providerSpecificData }
 * @param {object} [options] - { log, proxyOptions, forceRefresh }
 * @returns {Promise<{ models: object[] } | null>}
 */
export async function resolveAntigravityModels(credentials, options = {}) {
  if (!credentials || !credentials.accessToken) {
    options.log?.debug?.("AG_MODELS", "No accessToken; skipping live fetch");
    return null;
  }

  const projectId =
    credentials?.providerSpecificData?.project_id ||
    credentials?.providerSpecificData?.projectId ||
    null;
  const payload = projectId
    ? JSON.stringify({ project: String(projectId).trim() })
    : "{}";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    "User-Agent": getPlatformUserAgent(),
  };

  return fetchWithFallback({
    cache: catalogCache,
    key: credentialCacheKey("antigravity", credentials),
    forceRefresh: options.forceRefresh,
    log: options.log,
    label: "AG_MODELS",
    fetcher: async (signal) => {
      for (const base of ANTIGRAVITY_BASE_URLS) {
        try {
          const res = await proxyAwareFetch(
            base + ANTIGRAVITY_OPERATIONS.fetchAvailableModels,
            { method: "POST", headers, body: payload, signal },
            options.proxyOptions || null,
          );
          if (!res.ok) continue;
          const data = await res.json().catch(() => null);
          const modelsMap = data?.models;
          if (!modelsMap || typeof modelsMap !== "object") continue;
          const models = [];
          for (const [rawId, modelData] of Object.entries(modelsMap)) {
            const id = String(rawId).trim();
            if (!id || ANTIGRAVITY_DYNAMIC_MODEL_SKIP_IDS.has(id)) continue;
            const name = (modelData?.displayName || id).toString();
            models.push({ id, name });
          }
          if (models.length) return { models };
        } catch {
          // try next base URL
        }
      }
      return null;
    },
  });
}

export function clearAntigravityModelCache() {
  catalogCache.clear();
}
