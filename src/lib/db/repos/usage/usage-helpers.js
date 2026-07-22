/**
 * Shared helper functions for usage tracking.
 *
 * Date/period utilities, summary builders, aggregation helpers,
 * and common patterns used across usage modules.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import { PERIOD_MS } from "./usage-state.js";

// --- API key masking ---

/** Mask an API key — show first 8 chars only. Returns null for empty keys. */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

// --- Date & period helpers ---

export function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getPeriodBounds(periodType, now = new Date()) {
  const current = new Date(now);
  if (periodType === "monthly") {
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    return { start, end };
  }
  const start = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  );
  const end = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 1,
  );
  return { start, end };
}

export function parseDateOrNull(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

export function periodFilterToDates(periodType) {
  const { start, end } = getPeriodBounds(periodType);
  return {
    startDate: start.toISOString(),
    endDate: new Date(end.getTime() - 1).toISOString(),
  };
}

export function resolveHistoryWindow(filter = {}) {
  if (filter.periodType === "daily" || filter.periodType === "monthly") {
    return periodFilterToDates(filter.periodType);
  }
  return {
    startDate: filter.startDate,
    endDate: filter.endDate,
  };
}

// --- Usage summary builders ---

export function buildEmptyUsageSummary() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
  };
}

export function sumUsageRows(rows) {
  return rows.reduce((acc, row) => {
    acc.requests += row.requests || 0;
    acc.promptTokens += row.promptTokens || 0;
    acc.completionTokens += row.completionTokens || 0;
    acc.cost += row.cost || 0;
    return acc;
  }, buildEmptyUsageSummary());
}

export function normalizeApiKeyValue(rawKey) {
  return rawKey && typeof rawKey === "string" ? rawKey : "local-no-key";
}

export function getNumericUsageForMetric(summary, metricType) {
  if (metricType === "requests") return summary.requests || 0;
  if (metricType === "tokens") {
    return (summary.promptTokens || 0) + (summary.completionTokens || 0);
  }
  return summary.cost || 0;
}

export function getLimitStatus(currentValue, limitValue) {
  if (!limitValue || limitValue <= 0) return "unlimited";
  if (currentValue >= limitValue) return "exceeded";
  if (currentValue >= limitValue * 0.8) return "near";
  return "healthy";
}

// --- Aggregation helpers ---

/**
 * Add values to a counter object, creating it if needed.
 * Used for byProvider, byModel, byAccount, byApiKey, byEndpoint aggregation.
 */
export function addToCounter(target, key, values) {
  if (!target[key])
    target[key] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cost: 0,
    };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

/**
 * Aggregate a single usage entry into a day summary object.
 * Mutates day in place.
 */
export function aggregateEntryToDay(day, entry) {
  const promptTokens =
    entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens =
    entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens =
    entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider
    ? `${entry.model}|${entry.provider}`
    : entry.model;
  addToCounter(day.byModel, modelKey, {
    ...vals,
    meta: { rawModel: entry.model, provider: entry.provider },
  });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, {
      ...vals,
      meta: { rawModel: entry.model, provider: entry.provider },
    });
  }

  const apiKeyVal =
    entry.apiKey && typeof entry.apiKey === "string"
      ? entry.apiKey
      : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, {
    ...vals,
    meta: {
      rawModel: entry.model,
      provider: entry.provider,
      apiKey: entry.apiKey || null,
    },
  });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, {
    ...vals,
    meta: { endpoint, rawModel: entry.model, provider: entry.provider },
  });
}

/**
 * Accumulate usage summary with a single entry's token counts.
 */
export function accumulateUsageSummary(
  summary,
  promptTokens,
  completionTokens,
  cost,
) {
  summary.requests += 1;
  summary.promptTokens += promptTokens;
  summary.completionTokens += completionTokens;
  summary.cost += cost;
}

/**
 * Initialize a new stats bucket entry for a dimension (byModel, byApiKey, etc.).
 */
export function createStatsEntry(overrides = {}) {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    ...overrides,
  };
}

/**
 * Increment an existing stats bucket entry with token counts.
 */
export function incrementStatsEntry(
  entry,
  promptTokens,
  completionTokens,
  cost,
  timestamp,
  cachedTokens = 0,
) {
  entry.requests++;
  entry.promptTokens += promptTokens;
  entry.completionTokens += completionTokens;
  entry.cachedTokens = (entry.cachedTokens || 0) + cachedTokens;
  entry.cost += cost;
  if (timestamp && new Date(timestamp) > new Date(entry.lastUsed || ""))
    entry.lastUsed = timestamp;
}

// --- Active request extraction from pendingRequests state ---

/**
 * Extract active requests from pendingRequests global state.
 *
 * Accounts with connectionId are tracked in byAccount; free/noAuth providers
 * (e.g. mimo-free) have no connectionId and are only in byModel.
 * This function handles both cases and deduplicates by provider.
 *
 * @param {object} pending - { byAccount, byModel }
 * @param {object} connectionMap - { [connectionId]: displayName }
 * @returns {Array<{model, provider, account, count}>}
 */
export function extractActiveFromPending(
  pending,
  connectionMap = {},
  connectionId,
) {
  const activeRequests = [];
  const seenProviders = new Set();

  // A per-account dashboard must never include free/global pending state.
  if (connectionId) {
    const models = pending.byAccount?.[connectionId] || {};
    const accountName =
      connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
    for (const [modelKey, count] of Object.entries(models)) {
      if (count <= 0) continue;
      const match = modelKey.match(/^(.*) \((.*)\)$/);
      activeRequests.push({
        model: match ? match[1] : modelKey,
        provider: match ? match[2] : "unknown",
        account: accountName,
        count,
      });
    }
    return activeRequests;
  }

  // 1) Requests with connectionId tracked in byAccount
  for (const [connectionId, models] of Object.entries(
    pending.byAccount || {},
  )) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count <= 0) continue;
      const accountName =
        connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
      const match = modelKey.match(/^(.*) \((.*)\)$/);
      const provider = match ? match[2] : "unknown";
      activeRequests.push({
        model: match ? match[1] : modelKey,
        provider,
        account: accountName,
        count,
      });
      seenProviders.add(provider.toLowerCase());
    }
  }

  // 2) Free/noAuth providers (e.g. mimo-free) only tracked in byModel
  for (const [modelKey, count] of Object.entries(pending.byModel || {})) {
    if (count <= 0) continue;
    const match = modelKey.match(/^(.*) \((.*)\)$/);
    if (!match) continue;
    const provider = match[2];
    if (seenProviders.has(provider.toLowerCase())) continue;
    seenProviders.add(provider.toLowerCase());
    activeRequests.push({
      model: match[1],
      provider,
      account: "(Free)",
      count,
    });
  }

  return activeRequests;
}

// --- Deduplication for recent requests ---

/**
 * Deduplicate recent request entries by model+provider+tokens+minute.
 * Used in both getActiveRequests and getUsageStats.
 */
export function deduplicateRecentRequests(
  rows,
  maxItems = 20,
  connectionId,
) {
  const seen = new Set();
  return (
    rows
      .filter((row) => !connectionId || row.connectionId === connectionId)
      .map((r) => {
        // tokens may be a JSON string (from DB) or already-parsed object (from ring buffer)
        const t =
          typeof r.tokens === "string"
            ? parseJson(r.tokens, {})
            : r.tokens || {};
        return {
          timestamp: r.timestamp,
          model: r.model,
          provider: r.provider || "",
          promptTokens: t.prompt_tokens || t.input_tokens || 0,
          completionTokens: t.completion_tokens || t.output_tokens || 0,
          cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
          cost: Number.isFinite(Number(r.cost)) ? Number(r.cost) : 0,
          status: r.status || "ok",
        };
      })
      .filter((e) => {
        if (e.promptTokens === 0 && e.completionTokens === 0) return false;
        const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
        const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${e.cachedTokens}|${minute}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      // Always return newest-first regardless of input order
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, maxItems)
  );
}

// --- Database helpers ---

export function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - maxDays + 1,
  );
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`,
    [cutoffKey],
  );
}

// --- Formatting ---

export function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getDayApiKeyTotals(day, apiKeyValue) {
  const totals = buildEmptyUsageSummary();
  const bucket = day?.byApiKey || {};
  for (const entry of Object.values(bucket)) {
    const rawApiKey = normalizeApiKeyValue(entry.apiKey);
    if (rawApiKey !== apiKeyValue) continue;
    totals.requests += entry.requests || 0;
    totals.promptTokens += entry.promptTokens || 0;
    totals.completionTokens += entry.completionTokens || 0;
    totals.cost += entry.cost || 0;
  }
  return totals;
}

export function normalizeHistoryFilter(filter = {}) {
  return {
    provider: filter.provider,
    model: filter.model,
    startDate: filter.startDate,
    endDate: filter.endDate,
    endpoint: filter.endpoint,
    status: filter.status,
  };
}

export function mergeHistoryFilter(filter = {}) {
  const windowFilter = resolveHistoryWindow(filter);
  return normalizeHistoryFilter({ ...filter, ...windowFilter });
}

export function applyExtendedUsageFilters(rows, filter = {}) {
  const start = parseDateOrNull(filter.startDate);
  const end = parseDateOrNull(filter.endDate, true);
  return rows.filter((row) => {
    if (filter.provider && row.provider !== filter.provider) return false;
    if (filter.model && row.model !== filter.model) return false;
    if (filter.endpoint && row.endpoint !== filter.endpoint) return false;
    if (filter.status && row.status !== filter.status) return false;
    const timestamp = row.timestamp ? new Date(row.timestamp) : null;
    if (start && timestamp && timestamp < start) return false;
    if (end && timestamp && timestamp > end) return false;
    return true;
  });
}

export function sortUsageHistoryDesc(rows) {
  return [...rows].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  );
}

export function limitRows(rows, maxItems = 100) {
  return rows.slice(0, maxItems);
}
