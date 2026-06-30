/**
 * Pending request tracking and active request queries.
 *
 * Tracks in-flight requests by model and account, with timeout-based
 * cleanup and debounced event emission.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import {
  PENDING_TIMEOUT_MS,
  pendingRequests,
  lastErrorProvider,
  pendingTimers,
  recentRing,
  emitPending,
  RING_CAP,
  connCache,
  CONN_CACHE_TTL_MS,
} from "./usage-state.js";
import {
  deduplicateRecentRequests,
  extractActiveFromPending,
} from "./usage-helpers.js";

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("../connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [RING_CAP],
    );
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      apiKey: r.apiKey,
      endpoint: r.endpoint,
      cost: r.cost,
      status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

// --- Public API ---

export function trackPendingRequest(
  model,
  provider,
  connectionId,
  started,
  error = false,
) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(
    0,
    pendingRequests.byModel[modelKey] + (started ? 1 : -1),
  );
  if (pendingRequests.byModel[modelKey] === 0)
    delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId])
      pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey])
      pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(
      0,
      pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1),
    );
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0)
        pendingRequests.byModel[modelKey] = 0;
      if (
        connectionId &&
        pendingRequests.byAccount[connectionId]?.[modelKey] > 0
      ) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      emitPending();
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  const t = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(
    `[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`,
  );
  emitPending();
}

export async function getActiveRequests() {
  const connectionMap = await getConnectionMapCached();
  const activeRequests = extractActiveFromPending(
    pendingRequests,
    connectionMap,
  );

  await ensureRingInitialized();
  const recentRequests = deduplicateRecentRequests(recentRing.items);

  const errorProvider =
    Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}
