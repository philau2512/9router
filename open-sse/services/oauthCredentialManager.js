import {
  getRefreshLeadMs,
  isUnrecoverableRefreshError,
  refreshTokenByProvider,
  TOKEN_EXPIRY_BUFFER_MS,
} from "./tokenRefresh.js";

export const CODEX_MAX_REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Usage/quota polls must NOT use chat proactive leads (Codex = 5 days) or the
 * 8-day lastRefresh rotation — those burn single-use refresh tokens on every
 * dashboard refresh. Only rotate when the access token is expired / within buffer.
 */
export const USAGE_TOKEN_REFRESH_LEAD_MS = TOKEN_EXPIRY_BUFFER_MS;

const refreshLocks = new Map();

function parseTimeMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toExpiresAt(expiresIn, nowMs = Date.now()) {
  if (!expiresIn) return null;
  return new Date(nowMs + expiresIn * 1000).toISOString();
}

export function getCredentialExpiryMs(credentials) {
  return parseTimeMs(credentials?.expiresAt ?? credentials?.tokenExpiresAt);
}

export function getCredentialLastRefreshMs(credentials) {
  return parseTimeMs(
    credentials?.lastRefreshAt ??
      credentials?.lastRefresh ??
      credentials?.providerSpecificData?.lastRefreshAt,
  );
}

export function isCodexRefreshStale(credentials, nowMs = Date.now()) {
  const lastRefreshMs = getCredentialLastRefreshMs(credentials);
  return !lastRefreshMs || nowMs - lastRefreshMs >= CODEX_MAX_REFRESH_AGE_MS;
}

export function shouldRefreshCredentials(
  provider,
  credentials,
  nowMs = Date.now(),
) {
  if (!credentials) return false;

  const expiresAtMs = getCredentialExpiryMs(credentials);
  if (
    expiresAtMs !== null &&
    expiresAtMs - nowMs < getRefreshLeadMs(provider)
  ) {
    return true;
  }

  if (
    provider === "codex" &&
    credentials.refreshToken &&
    isCodexRefreshStale(credentials, nowMs)
  ) {
    return true;
  }

  return false;
}

/**
 * Gate for GET /api/usage and auto-ping: keep a valid access token only.
 * Does not apply chat proactive lead times or Codex lastRefresh stale rotation.
 *
 * @param {string} provider
 * @param {object|null|undefined} credentials
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function shouldRefreshCredentialsForUsage(
  provider,
  credentials,
  nowMs = Date.now(),
) {
  if (!credentials) return false;
  // No refresh token → nothing to rotate (apikey / bare access_token).
  if (!credentials.refreshToken) return false;

  const expiresAtMs = getCredentialExpiryMs(credentials);
  // Unknown expiry: keep current accessToken; auth-fail path force-refreshes.
  if (expiresAtMs === null) {
    return !credentials.accessToken;
  }

  return expiresAtMs - nowMs < USAGE_TOKEN_REFRESH_LEAD_MS;
}

export function mergeProviderSpecificData(existing, next) {
  if (!next || typeof next !== "object") return existing;
  return {
    ...(existing || {}),
    ...next,
  };
}

export function mergeRefreshedCredentials(
  provider,
  currentCredentials,
  refreshedCredentials,
  nowMs = Date.now(),
) {
  if (!refreshedCredentials) return null;
  if (isUnrecoverableRefreshError(refreshedCredentials))
    return refreshedCredentials;

  const next = {};
  const nowIso = new Date(nowMs).toISOString();

  if (refreshedCredentials.accessToken)
    next.accessToken = refreshedCredentials.accessToken;
  if (refreshedCredentials.apiKey) next.apiKey = refreshedCredentials.apiKey;
  if (refreshedCredentials.token) next.token = refreshedCredentials.token;

  const refreshToken =
    refreshedCredentials.refreshToken ?? currentCredentials?.refreshToken;
  if (refreshToken) next.refreshToken = refreshToken;

  const idToken = refreshedCredentials.idToken ?? currentCredentials?.idToken;
  if (idToken) next.idToken = idToken;

  if (refreshedCredentials.expiresIn) {
    next.expiresIn = refreshedCredentials.expiresIn;
    next.expiresAt = toExpiresAt(refreshedCredentials.expiresIn, nowMs);
  } else if (refreshedCredentials.expiresAt) {
    next.expiresAt = refreshedCredentials.expiresAt;
  }

  if (refreshedCredentials.projectId)
    next.projectId = refreshedCredentials.projectId;

  if (refreshedCredentials.providerSpecificData) {
    next.providerSpecificData = mergeProviderSpecificData(
      currentCredentials?.providerSpecificData,
      refreshedCredentials.providerSpecificData,
    );
  }

  if (refreshedCredentials.copilotToken)
    next.copilotToken = refreshedCredentials.copilotToken;
  if (refreshedCredentials.copilotTokenExpiresAt) {
    next.copilotTokenExpiresAt = refreshedCredentials.copilotTokenExpiresAt;
  }

  if (
    provider === "codex" ||
    next.accessToken ||
    next.apiKey ||
    next.token ||
    next.refreshToken ||
    next.copilotToken
  ) {
    next.lastRefreshAt = refreshedCredentials.lastRefreshAt || nowIso;
  }

  return next;
}

function getRefreshLockKey(provider, credentials) {
  const stableId =
    credentials?.connectionId ||
    credentials?.id ||
    credentials?.email ||
    credentials?.name ||
    credentials?.refreshToken?.slice?.(-16) ||
    "default";
  return `${provider}:${stableId}`;
}

export async function withCredentialRefreshLock(
  provider,
  credentials,
  refreshFn,
) {
  const key = getRefreshLockKey(provider, credentials);
  const existing = refreshLocks.get(key);
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(refreshFn)
    .finally(() => {
      refreshLocks.delete(key);
    });

  refreshLocks.set(key, pending);
  return pending;
}

export async function refreshProviderCredentials(provider, credentials, log) {
  if (!credentials) return null;

  return withCredentialRefreshLock(provider, credentials, async () => {
    const refreshed = await refreshTokenByProvider(provider, credentials, log);
    return mergeRefreshedCredentials(provider, credentials, refreshed);
  });
}
