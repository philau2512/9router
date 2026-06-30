/**
 * Usage statistics aggregation — the core stats pipeline.
 *
 * Aggregates usage data from daily summaries (usageDaily) and live history
 * (usageHistory) into a unified stats object with breakdowns by provider,
 * model, account, API key, and endpoint.
 *
 * Internally split into focused sub-functions for readability.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import {
  PERIOD_MS,
  pendingRequests,
  lastErrorProvider,
} from "./usage-state.js";
import {
  getLocalDateKey,
  loadDaysInRange,
  createStatsEntry,
  incrementStatsEntry,
  deduplicateRecentRequests,
  extractActiveFromPending,
  parseDateOrNull,
  normalizeApiKeyValue,
  maskApiKey,
} from "./usage-helpers.js";

// --- Internal: aggregate daily summary data into stats ---

function aggregateDailyData(
  dayRows,
  stats,
  connectionMap,
  providerNodeNameMap,
  apiKeyMap,
) {
  for (const dr of dayRows) {
    const dateKey = dr.dateKey;
    const day = parseJson(dr.data, {});
    stats.totalPromptTokens += day.promptTokens || 0;
    stats.totalCompletionTokens += day.completionTokens || 0;
    stats.totalCost += day.cost || 0;

    aggregateByProvider(day.byProvider, stats);
    aggregateByModel(day.byModel, stats, dateKey, providerNodeNameMap);
    aggregateByAccount(
      day.byAccount,
      stats,
      dateKey,
      connectionMap,
      providerNodeNameMap,
    );
    aggregateByApiKey(
      day.byApiKey,
      stats,
      dateKey,
      apiKeyMap,
      providerNodeNameMap,
    );
    aggregateByEndpoint(day.byEndpoint, stats, dateKey, providerNodeNameMap);
  }
}

function aggregateByProvider(byProvider, stats) {
  for (const [prov, p] of Object.entries(byProvider || {})) {
    if (!stats.byProvider[prov]) stats.byProvider[prov] = createStatsEntry();
    stats.byProvider[prov].requests += p.requests || 0;
    stats.byProvider[prov].promptTokens += p.promptTokens || 0;
    stats.byProvider[prov].completionTokens += p.completionTokens || 0;
    stats.byProvider[prov].cost += p.cost || 0;
  }
}

function aggregateByModel(byModel, stats, dateKey, providerNodeNameMap) {
  for (const [mk, m] of Object.entries(byModel || {})) {
    const rawModel = m.rawModel || mk.split("|")[0];
    const provider = m.provider || mk.split("|")[1] || "";
    const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
    const providerDisplayName = providerNodeNameMap[provider] || provider;
    if (!stats.byModel[statsKey]) {
      stats.byModel[statsKey] = createStatsEntry({
        rawModel,
        provider: providerDisplayName,
        lastUsed: dateKey,
      });
    }
    stats.byModel[statsKey].requests += m.requests || 0;
    stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
    stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
    stats.byModel[statsKey].cost += m.cost || 0;
    if (dateKey > (stats.byModel[statsKey].lastUsed || ""))
      stats.byModel[statsKey].lastUsed = dateKey;
  }
}

function aggregateByAccount(
  byAccount,
  stats,
  dateKey,
  connectionMap,
  providerNodeNameMap,
) {
  for (const [connId, a] of Object.entries(byAccount || {})) {
    const accountName =
      connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
    const rawModel = a.rawModel || "";
    const provider = a.provider || "";
    const providerDisplayName = providerNodeNameMap[provider] || provider;
    const accountKey = `${rawModel} (${provider} - ${accountName})`;
    if (!stats.byAccount[accountKey]) {
      stats.byAccount[accountKey] = createStatsEntry({
        rawModel,
        provider: providerDisplayName,
        connectionId: connId,
        accountName,
        lastUsed: dateKey,
      });
    }
    stats.byAccount[accountKey].requests += a.requests || 0;
    stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
    stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
    stats.byAccount[accountKey].cost += a.cost || 0;
    if (dateKey > (stats.byAccount[accountKey].lastUsed || ""))
      stats.byAccount[accountKey].lastUsed = dateKey;
  }
}

function aggregateByApiKey(
  byApiKey,
  stats,
  dateKey,
  apiKeyMap,
  providerNodeNameMap,
) {
  for (const [akKey, ak] of Object.entries(byApiKey || {})) {
    const rawModel = ak.rawModel || "";
    const provider = ak.provider || "";
    const providerDisplayName = providerNodeNameMap[provider] || provider;
    const apiKeyVal = ak.apiKey;
    const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
    const keyName =
      keyInfo?.name ||
      (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
    const apiKeyMasked = maskApiKey(apiKeyVal);
    const apiKeyKey = apiKeyMasked || "local-no-key";
    // Use apiKeyKey (masked) as outer dict key — akKey from stored daily summaries
    // contains the raw API key string, which would expose keys in response object keys.
    if (!stats.byApiKey[apiKeyKey]) {
      stats.byApiKey[apiKeyKey] = createStatsEntry({
        rawModel,
        provider: providerDisplayName,
        apiKeyMasked,
        keyName,
        apiKeyKey,
        lastUsed: dateKey,
      });
    }
    stats.byApiKey[apiKeyKey].requests += ak.requests || 0;
    stats.byApiKey[apiKeyKey].promptTokens += ak.promptTokens || 0;
    stats.byApiKey[apiKeyKey].completionTokens += ak.completionTokens || 0;
    stats.byApiKey[apiKeyKey].cost += ak.cost || 0;
    if (dateKey > (stats.byApiKey[apiKeyKey].lastUsed || ""))
      stats.byApiKey[apiKeyKey].lastUsed = dateKey;
  }
}

function aggregateByEndpoint(byEndpoint, stats, dateKey, providerNodeNameMap) {
  for (const [epKey, ep] of Object.entries(byEndpoint || {})) {
    const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
    const rawModel = ep.rawModel || "";
    const provider = ep.provider || "";
    const providerDisplayName = providerNodeNameMap[provider] || provider;
    if (!stats.byEndpoint[epKey]) {
      stats.byEndpoint[epKey] = createStatsEntry({
        endpoint,
        rawModel,
        provider: providerDisplayName,
        lastUsed: dateKey,
      });
    }
    stats.byEndpoint[epKey].requests += ep.requests || 0;
    stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
    stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
    stats.byEndpoint[epKey].cost += ep.cost || 0;
    if (dateKey > (stats.byEndpoint[epKey].lastUsed || ""))
      stats.byEndpoint[epKey].lastUsed = dateKey;
  }
}

// --- Internal: overlay precise lastUsed timestamps from history ---

function overlayLastUsedFromHistory(db, stats, maxDays, connectionMap) {
  const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
  const histRows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
    [new Date(overlayCutoff).toISOString()],
  );
  for (const e of histRows) {
    const ts = e.timestamp;
    const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
    if (
      stats.byModel[modelKey] &&
      new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)
    )
      stats.byModel[modelKey].lastUsed = ts;

    if (e.connectionId) {
      const accountName =
        connectionMap[e.connectionId] ||
        `Account ${e.connectionId.slice(0, 8)}...`;
      const accountKey = `${e.model} (${e.provider} - ${accountName})`;
      if (
        stats.byAccount[accountKey] &&
        new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)
      )
        stats.byAccount[accountKey].lastUsed = ts;
    }

    const apiKeyKey =
      e.apiKey && typeof e.apiKey === "string"
        ? `${maskApiKey(e.apiKey)}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
    if (
      stats.byApiKey[apiKeyKey] &&
      new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)
    )
      stats.byApiKey[apiKeyKey].lastUsed = ts;

    const endpoint = e.endpoint || "Unknown";
    const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
    if (
      stats.byEndpoint[endpointKey] &&
      new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)
    )
      stats.byEndpoint[endpointKey].lastUsed = ts;
  }
}

// --- Internal: aggregate live history (24h / today) ---

function aggregateLiveHistory(
  filtered,
  stats,
  connectionMap,
  apiKeyMap,
  providerNodeNameMap,
) {
  for (const r of filtered) {
    const tokens = parseJson(r.tokens, {}) || {};
    const promptTokens = tokens.prompt_tokens || 0;
    const completionTokens = tokens.completion_tokens || 0;
    const entryCost = r.cost || 0;
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCost += entryCost;

    // By provider
    if (!stats.byProvider[r.provider])
      stats.byProvider[r.provider] = createStatsEntry();
    const prov = stats.byProvider[r.provider];
    prov.requests++;
    prov.promptTokens += promptTokens;
    prov.completionTokens += completionTokens;
    prov.cost += entryCost;

    // By model
    const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = createStatsEntry({
        rawModel: r.model,
        provider: providerDisplayName,
        lastUsed: r.timestamp,
      });
    }
    incrementStatsEntry(
      stats.byModel[modelKey],
      promptTokens,
      completionTokens,
      entryCost,
      r.timestamp,
    );

    // By account
    if (r.connectionId) {
      const accountName =
        connectionMap[r.connectionId] ||
        `Account ${r.connectionId.slice(0, 8)}...`;
      const accountKey = `${r.model} (${r.provider} - ${accountName})`;
      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = createStatsEntry({
          rawModel: r.model,
          provider: providerDisplayName,
          connectionId: r.connectionId,
          accountName,
          lastUsed: r.timestamp,
        });
      }
      incrementStatsEntry(
        stats.byAccount[accountKey],
        promptTokens,
        completionTokens,
        entryCost,
        r.timestamp,
      );
    }

    // By API key
    if (r.apiKey && typeof r.apiKey === "string") {
      const keyInfo = apiKeyMap[r.apiKey];
      const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
      const apiKeyMasked = maskApiKey(r.apiKey);
      const akKey = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = createStatsEntry({
          rawModel: r.model,
          provider: providerDisplayName,
          apiKeyMasked,
          keyName,
          apiKeyKey: apiKeyMasked,
          lastUsed: r.timestamp,
        });
      }
      incrementStatsEntry(
        stats.byApiKey[akKey],
        promptTokens,
        completionTokens,
        entryCost,
        r.timestamp,
      );
    } else {
      if (!stats.byApiKey["local-no-key"]) {
        stats.byApiKey["local-no-key"] = createStatsEntry({
          rawModel: r.model,
          provider: providerDisplayName,
          apiKeyMasked: null,
          keyName: "Local (No API Key)",
          apiKeyKey: "local-no-key",
          lastUsed: r.timestamp,
        });
      }
      incrementStatsEntry(
        stats.byApiKey["local-no-key"],
        promptTokens,
        completionTokens,
        entryCost,
        r.timestamp,
      );
    }

    // By endpoint
    const endpoint = r.endpoint || "Unknown";
    const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    if (!stats.byEndpoint[epKey]) {
      stats.byEndpoint[epKey] = createStatsEntry({
        endpoint,
        rawModel: r.model,
        provider: providerDisplayName,
        lastUsed: r.timestamp,
      });
    }
    incrementStatsEntry(
      stats.byEndpoint[epKey],
      promptTokens,
      completionTokens,
      entryCost,
      r.timestamp,
    );
  }
}

// --- Internal: build active requests list ---

function buildActiveRequests(connectionMap) {
  return extractActiveFromPending(pendingRequests, connectionMap);
}

// --- Internal: build recent requests (10-minute buckets) ---

function buildLast10Minutes(db) {
  const now = new Date();
  const currentMinuteStart = new Date(
    Math.floor(now.getTime() / 60000) * 60000,
  );
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  const last10Minutes = [];
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
    };
    last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()],
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }
  return last10Minutes;
}

// --- Public API ---

export async function getUsageStats(period = "all") {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] =
    await Promise.all([
      import("../connectionsRepo.js"),
      import("../apiKeysRepo.js"),
      import("../nodesRepo.js"),
    ]);

  // Build lookup maps
  let allConnections = [];
  try {
    allConnections = await getProviderConnections();
  } catch {}
  const connectionMap = {};
  for (const c of allConnections)
    connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes)
      if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try {
    allApiKeys = await getApiKeys();
  } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys)
    apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // Recent requests from live history
  const recentRows = db.all(
    `SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`,
  );
  const recentRequests = deduplicateRecentRequests(recentRows);

  // Initialize stats object
  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: buildActiveRequests(connectionMap),
    recentRequests,
    errorProvider:
      Date.now() - lastErrorProvider.ts < 10000
        ? lastErrorProvider.provider
        : "",
  };

  // 10-minute buckets
  stats.last10Minutes = buildLast10Minutes(db);

  // Aggregate by period type
  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);
    aggregateDailyData(
      dayRows,
      stats,
      connectionMap,
      providerNodeNameMap,
      apiKeyMap,
    );
    overlayLastUsedFromHistory(db, stats, maxDays, connectionMap);
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff],
    );
    aggregateLiveHistory(
      filtered,
      stats,
      connectionMap,
      apiKeyMap,
      providerNodeNameMap,
    );
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce(
    (sum, p) => sum + (p.requests || 0),
    0,
  );
  return stats;
}
