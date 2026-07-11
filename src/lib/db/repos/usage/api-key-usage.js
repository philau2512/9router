/**
 * API key usage queries — limits, summaries, and history.
 *
 * Evaluates API key limits, computes usage summaries per key,
 * and builds presentation payloads for the UI.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import {
  getLocalDateKey,
  getPeriodBounds,
  getNumericUsageForMetric,
  buildEmptyUsageSummary,
  sumUsageRows,
  normalizeApiKeyValue,
  getDayApiKeyTotals,
  getLimitStatus,
  mergeHistoryFilter,
  applyExtendedUsageFilters,
  sortUsageHistoryDesc,
  limitRows,
} from "./usage-helpers.js";

// --- API key usage summary ---

export async function getApiKeyUsageSummary(
  apiKeyValue,
  periodType,
  now = new Date(),
) {
  const db = await getAdapter();
  const normalizedKey = normalizeApiKeyValue(apiKeyValue);
  const { start, end } = getPeriodBounds(periodType, now);

  if (periodType === "daily") {
    const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [
      getLocalDateKey(start),
    ]);
    const day = row ? parseJson(row.data, {}) : null;
    return getDayApiKeyTotals(day, normalizedKey);
  }

  const startKey = getLocalDateKey(start);
  const endKey = getLocalDateKey(new Date(end.getTime() - 1));
  const rows = db.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? AND dateKey <= ? ORDER BY dateKey ASC`,
    [startKey, endKey],
  );
  return sumUsageRows(
    rows.map((row) =>
      getDayApiKeyTotals(parseJson(row.data, {}), normalizedKey),
    ),
  );
}

// --- API key limit evaluation ---

export async function evaluateApiKeyLimitState(apiKey) {
  const limit = apiKey?.limit || null;
  if (
    !limit ||
    !limit.metricType ||
    !limit.periodType ||
    limit.limitValue == null
  ) {
    return {
      enabled: false,
      exceeded: false,
      metricType: null,
      periodType: null,
      limitValue: null,
      currentValue: 0,
      remainingValue: null,
      usageSummary: buildEmptyUsageSummary(),
      nextResetAt: null,
    };
  }

  const usageSummary = await getApiKeyUsageSummary(
    apiKey.key,
    limit.periodType,
  );
  const currentValue = getNumericUsageForMetric(usageSummary, limit.metricType);
  const { end } = getPeriodBounds(limit.periodType);
  return {
    enabled: true,
    exceeded: currentValue >= limit.limitValue,
    metricType: limit.metricType,
    periodType: limit.periodType,
    limitValue: limit.limitValue,
    currentValue,
    remainingValue: Math.max(0, limit.limitValue - currentValue),
    usageSummary,
    nextResetAt: end.toISOString(),
  };
}

// --- Batch API key summaries ---

export async function getApiKeysUsageSummary(apiKeys) {
  const results = [];
  for (const apiKey of apiKeys || []) {
    results.push({
      apiKeyId: apiKey.id,
      key: apiKey.key,
      summary: await evaluateApiKeyLimitState(apiKey),
    });
  }
  return results;
}

// --- API key usage history ---

function filterHistoryByApiKey(rows, apiKeyValue) {
  const normalized = normalizeApiKeyValue(apiKeyValue);
  return rows.filter((row) => normalizeApiKeyValue(row.apiKey) === normalized);
}

function buildApiKeyHistoryPayload(rows, apiKeyValue, filter = {}) {
  const filtered = filterHistoryByApiKey(rows, apiKeyValue);
  const refined = applyExtendedUsageFilters(
    filtered,
    mergeHistoryFilter(filter),
  );
  return limitRows(sortUsageHistoryDesc(refined), filter.limit || 100);
}

export async function getApiKeyUsageHistory(apiKeyValue, filter = {}) {
  // Import getUsageHistory from sibling to avoid circular deps
  const { getUsageHistory } = await import("./usage-query.js");
  return getUsageHistory({ ...filter, apiKey: apiKeyValue });
}

export async function getDetailedApiKeyUsage(apiKey, filter = {}) {
  const limitState = await evaluateApiKeyLimitState(apiKey);
  const { getUsageHistory } = await import("./usage-query.js");
  const history = await getUsageHistory(mergeHistoryFilter(filter));
  return {
    limitState,
    history: buildApiKeyHistoryPayload(history, apiKey.key, filter),
  };
}

// --- Presentation helper ---

export function buildApiKeyLimitPresentation(apiKey, limitState) {
  return {
    ...apiKey,
    limitState: {
      ...limitState,
      status: getLimitStatus(limitState.currentValue, limitState.limitValue),
    },
  };
}
