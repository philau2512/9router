/**
 * Usage history query — SQL query builder with dynamic filters.
 *
 * Reads from usageHistory table with optional provider, model,
 * API key, endpoint, status, and date range filters.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import { normalizeApiKeyValue, maskApiKey } from "./usage-helpers.js";

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) {
    conds.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter.model) {
    conds.push("model = ?");
    params.push(filter.model);
  }
  if (filter.apiKey !== undefined) {
    conds.push("COALESCE(apiKey, 'local-no-key') = ?");
    params.push(normalizeApiKeyValue(filter.apiKey));
  }
  if (filter.endpoint) {
    conds.push("endpoint = ?");
    params.push(filter.endpoint);
  }
  if (filter.status) {
    conds.push("status = ?");
    params.push(filter.status);
  }
  if (filter.startDate) {
    conds.push("timestamp >= ?");
    params.push(new Date(filter.startDate).toISOString());
  }
  if (filter.endDate) {
    conds.push("timestamp <= ?");
    params.push(new Date(filter.endDate).toISOString());
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`,
    params,
  );

  return rows.map((r) => {
    const tokens = parseJson(r.tokens, {});
    const promptTokens =
      r.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0;
    const completionTokens =
      r.completionTokens ??
      tokens.completion_tokens ??
      tokens.output_tokens ??
      0;
    return {
      id: r.id,
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      apiKeyMasked: maskApiKey(r.apiKey),
      endpoint: r.endpoint,
      cost: r.cost,
      status: r.status,
      tokens,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  });
}
