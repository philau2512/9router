/**
 * Usage tracking — thin re-export barrel.
 *
 * Actual logic lives in ./usage/ sub-modules:
 *   - usage/usage-state.js      — global state, emitters
 *   - usage/usage-helpers.js    — shared utilities
 *   - usage/pending-requests.js — request tracking
 *   - usage/usage-writer.js     — cost calc + persistence
 *   - usage/usage-query.js      — history queries
 *   - usage/usage-stats.js      — stats aggregation
 *   - usage/usage-chart.js      — chart data
 *   - usage/api-key-usage.js    — API key queries
 *   - usage/recent-logs.js      — log formatting
 *
 * This file preserves backward compatibility for existing import paths.
 */

export { statsEmitter } from "./usage/usage-state.js";

export {
  trackPendingRequest,
  getActiveRequests,
} from "./usage/pending-requests.js";

export { saveRequestUsage } from "./usage/usage-writer.js";

export { getUsageHistory } from "./usage/usage-query.js";

export { getUsageStats } from "./usage/usage-stats.js";

export { getChartData } from "./usage/usage-chart.js";

export {
  getApiKeyUsageSummary,
  evaluateApiKeyLimitState,
  getApiKeysUsageSummary,
  getApiKeyUsageHistory,
  getDetailedApiKeyUsage,
  buildApiKeyLimitPresentation,
} from "./usage/api-key-usage.js";

export { appendRequestLog, getRecentLogs } from "./usage/recent-logs.js";
