/**
 * Usage entry persistence — cost calculation and database writes.
 *
 * Handles both Worker Thread offloading and synchronous fallback,
 * plus daily aggregation and lifetime counter updates.
 */

import { getAdapter, getObservabilityWorker } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import { setMeta } from "../../helpers/metaStore.js";
import { getLocalDateKey, aggregateEntryToDay } from "./usage-helpers.js";
import { pushToRing, emitUpdate } from "./usage-state.js";

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const [{ getPricingForModel }, { calculateCostFromTokens }] =
      await Promise.all([
        import("../pricingRepo.js"),
        import("@/shared/constants/pricing.js"),
      ]);
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export async function saveRequestUsage(entry) {
  try {
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost =
      entry.cost ??
      (await calculateCost(entry.provider, entry.model, entry.tokens));

    const worker = await getObservabilityWorker();
    if (worker) {
      // Offload to background Worker Thread
      worker.postMessage({
        type: "write_usage",
        payload: { entry },
      });
    } else {
      // Defer sync write to next event loop tick to avoid blocking active streams
      const _entry = { ...entry };
      setImmediate(async () => {
        try {
          const db = await getAdapter();
          const tokens = _entry.tokens || {};
          const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
          const completionTokens =
            tokens.completion_tokens || tokens.output_tokens || 0;

          let inserted = false;

          db.transaction(() => {
            // Deduplicate: skip if an identical record already exists (prevents double-count
            // when streaming usage is logged at source AND via onStreamComplete).
            const existing = db.get(
              `SELECT id, endpoint FROM usageHistory
               WHERE timestamp = ?
                 AND COALESCE(provider, '') = COALESCE(?, '')
                 AND COALESCE(model, '') = COALESCE(?, '')
                 AND COALESCE(connectionId, '') = COALESCE(?, '')
                 AND COALESCE(apiKey, '') = COALESCE(?, '')
                 AND promptTokens = ?
                 AND completionTokens = ?
               ORDER BY id DESC LIMIT 1`,
              [
                _entry.timestamp,
                _entry.provider || null,
                _entry.model || null,
                _entry.connectionId || null,
                _entry.apiKey || null,
                promptTokens,
                completionTokens,
              ],
            );
            if (existing) {
              if (!existing.endpoint && _entry.endpoint) {
                db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [
                  _entry.endpoint,
                  existing.id,
                ]);
              }
              return;
            }

            db.run(
              `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta, performance) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                _entry.timestamp,
                _entry.provider || null,
                _entry.model || null,
                _entry.connectionId || null,
                _entry.apiKey || null,
                _entry.endpoint || null,
                promptTokens,
                completionTokens,
                _entry.cost || 0,
                _entry.status || "ok",
                stringifyJson(tokens),
                stringifyJson({}),
                _entry.performance ? stringifyJson(_entry.performance) : null,
              ],
            );

            const dateKey = getLocalDateKey(_entry.timestamp);
            const row = db.get(
              `SELECT data FROM usageDaily WHERE dateKey = ?`,
              [dateKey],
            );
            const day = row
              ? parseJson(row.data, {})
              : {
                  requests: 0,
                  promptTokens: 0,
                  completionTokens: 0,
                  cost: 0,
                  byProvider: {},
                  byModel: {},
                  byAccount: {},
                  byApiKey: {},
                  byEndpoint: {},
                };
            aggregateEntryToDay(day, _entry);
            db.run(
              `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
              [dateKey, stringifyJson(day)],
            );

            // Atomic counter increment in same transaction
            const cur = db.get(
              `SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`,
            );
            const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
            db.run(
              `INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [String(next)],
            );
            inserted = true;
          });
        } catch (e) {
          console.error("Failed to save usage stats (deferred):", e);
        }
      });
    }

    pushToRing(entry);
    emitUpdate();
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}
