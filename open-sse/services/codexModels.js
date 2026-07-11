/**
 * Codex (OpenAI) live model catalog resolver.
 *
 * Fetches the dynamic Codex model list the official `codex` CLI uses:
 *   GET https://chatgpt.com/backend-api/codex/models?client_version=<ver>
 * with the OAuth access token + chatgpt-account-id + codex_cli_rs identity.
 * Ported from CLIProxyAPI cmd/fetch_codex_models/main.go.
 *
 * Returns { models: [{ id, name }] } on success, or null on any failure so the
 * /v1/models route falls back to the static PROVIDER_MODELS["cx"] catalog.
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { fetchWithFallback, credentialCacheKey } from "./dynamicModels.js";

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const DEFAULT_CLIENT_VERSION = "0.144.1";
const DEFAULT_USER_AGENT =
  "codex_cli_rs/0.144.1 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9";

/** @type {Map<string, { expiresAt: number, value: { models: object[] } }>} */
const catalogCache = new Map();

function buildHeaders(credentials) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    Originator: "codex_cli_rs",
    "User-Agent": DEFAULT_USER_AGENT,
  };
  const accountId =
    credentials?.providerSpecificData?.workspaceId ||
    credentials?.providerSpecificData?.chatgptAccountId ||
    credentials?.providerSpecificData?.accountId;
  if (typeof accountId === "string" && accountId) {
    headers["Chatgpt-Account-Id"] = accountId;
  }
  return headers;
}

/**
 * @param {object} credentials - { accessToken, providerSpecificData }
 * @param {object} [options] - { log, proxyOptions, forceRefresh, clientVersion }
 * @returns {Promise<{ models: object[] } | null>}
 */
export async function resolveCodexModels(credentials, options = {}) {
  if (!credentials || !credentials.accessToken) {
    options.log?.debug?.("CODEX_MODELS", "No accessToken; skipping live fetch");
    return null;
  }

  const clientVersion = options.clientVersion || DEFAULT_CLIENT_VERSION;
  const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(clientVersion)}`;

  return fetchWithFallback({
    cache: catalogCache,
    key: credentialCacheKey("codex", credentials),
    forceRefresh: options.forceRefresh,
    log: options.log,
    label: "CODEX_MODELS",
    fetcher: async (signal) => {
      const res = await proxyAwareFetch(
        url,
        { method: "GET", headers: buildHeaders(credentials), signal },
        options.proxyOptions || null,
      );
      if (!res.ok) {
        options.log?.debug?.("CODEX_MODELS", `HTTP ${res.status}`);
        return null;
      }
      const data = await res.json().catch(() => null);
      const rawModels = Array.isArray(data?.models) ? data.models : null;
      if (!rawModels || rawModels.length === 0) return null;
      const models = rawModels
        .map((m) => {
          const id = (m?.id || m?.slug || m?.name || "").toString().trim();
          if (!id) return null;
          const name = (m?.display_name || m?.title || id).toString();
          return { id, name };
        })
        .filter(Boolean);
      return models.length ? { models } : null;
    },
  });
}

export function clearCodexModelCache() {
  catalogCache.clear();
}
