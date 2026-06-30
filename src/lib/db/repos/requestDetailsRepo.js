import { getAdapter, getObservabilityWorker } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getSettings } from "./settingsRepo.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 30000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && Date.now() - cachedConfigTs < CONFIG_CACHE_TTL_MS)
    return cachedConfig;
  try {
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled =
      typeof settings.enableObservability === "boolean"
        ? settings.enableObservability
        : envEnabled;
    cachedConfig = {
      enabled,
      maxRecords:
        settings.observabilityMaxRecords ||
        parseInt(
          process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS),
          10,
        ),
      batchSize:
        settings.observabilityBatchSize ||
        parseInt(
          process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE),
          10,
        ),
      flushIntervalMs:
        settings.observabilityFlushIntervalMs ||
        parseInt(
          process.env.OBSERVABILITY_FLUSH_INTERVAL_MS ||
            String(DEFAULT_FLUSH_INTERVAL_MS),
          10,
        ),
      maxJsonSize:
        (settings.observabilityMaxJsonSize ||
          parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;
let flushCount = 0;
const PRUNE_EVERY_N_BATCHES = 5; // Prune every 5 batches (5 × 50 = 250 items max over limit)

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = [
    "authorization",
    "x-api-key",
    "cookie",
    "token",
    "api-key",
  ];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s)))
      delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return {
      _truncated: true,
      _originalSize: str.length,
      _preview: str.substring(0, 200),
    };
  }
  return obj || {};
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    const config = await getObservabilityConfig();
    const worker = await getObservabilityWorker();

    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      flushCount++;
      const shouldPrune = flushCount % PRUNE_EVERY_N_BATCHES === 0;

      if (worker) {
        // Offload to background Worker Thread
        worker.postMessage({
          type: "write_details",
          payload: {
            items,
            maxRecords: config.maxRecords,
            maxJsonSize: config.maxJsonSize,
            shouldPrune,
          },
        });
      } else {
        // Defer sync write to next event loop tick to avoid blocking active streams
        // Wrap in Promise to await completion before releasing isFlushing
        const _items = items;
        const _config = config;
        const _shouldPrune = shouldPrune;
        await new Promise((resolve) => {
          setImmediate(async () => {
            try {
              const db = await getAdapter();
              // Short transaction: insert only
              db.transaction(() => {
                for (const item of _items) {
                  if (!item.id) item.id = generateDetailId(item.model);
                  if (!item.timestamp)
                    item.timestamp = new Date().toISOString();
                  if (item.request?.headers)
                    item.request.headers = sanitizeHeaders(
                      item.request.headers,
                    );

                  const record = {
                    id: item.id,
                    provider: item.provider || null,
                    model: item.model || null,
                    connectionId: item.connectionId || null,
                    timestamp: item.timestamp,
                    status: item.status || null,
                    latency: item.latency || {},
                    tokens: item.tokens || {},
                    request: truncateField(item.request, _config.maxJsonSize),
                    providerRequest: truncateField(
                      item.providerRequest,
                      _config.maxJsonSize,
                    ),
                    providerResponse: truncateField(
                      item.providerResponse,
                      _config.maxJsonSize,
                    ),
                    response: truncateField(item.response, _config.maxJsonSize),
                  };

                  // Extract metadata for fast list queries
                  const latencyJson = JSON.stringify(record.latency);
                  const tokensJson = JSON.stringify(record.tokens);

                  db.run(
                    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, latency_json, tokens_json, data) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, latency_json = excluded.latency_json, tokens_json = excluded.tokens_json, data = excluded.data`,
                    [
                      record.id,
                      record.timestamp,
                      record.provider,
                      record.model,
                      record.connectionId,
                      record.status,
                      latencyJson,
                      tokensJson,
                      stringifyJson(record),
                    ],
                  );
                }
              });

              // Prune separately (outside insert transaction)
              if (_shouldPrune) {
                const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
                if (cnt && cnt.c > _config.maxRecords) {
                  db.run(
                    `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
                    [cnt.c - _config.maxRecords],
                  );
                }
              }
            } catch (e) {
              console.error("[requestDetailsRepo] Deferred write failed:", e);
            }
            resolve();
          });
        });
      }
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushToDatabase().catch((e) =>
      console.error("[requestDetailsRepo] flush err:", e),
    );
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
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
  if (filter.connectionId) {
    conds.push("connectionId = ?");
    params.push(filter.connectionId);
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
  const cntRow = db.get(
    `SELECT COUNT(*) as c FROM requestDetails ${where}`,
    params,
  );
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Fast list query — returns only metadata columns (no data blob).
 * Used for table view; detail view uses getRequestDetailById().
 */
export async function getRequestDetailsList(filter = {}) {
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
  if (filter.connectionId) {
    conds.push("connectionId = ?");
    params.push(filter.connectionId);
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
  const cntRow = db.get(
    `SELECT COUNT(*) as c FROM requestDetails ${where}`,
    params,
  );
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  // List query: select only metadata columns (NO data blob!)
  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, status, latency_json, tokens_json
     FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  // Parse only small metadata fields
  const details = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    provider: r.provider,
    model: r.model,
    connectionId: r.connectionId,
    status: r.status,
    latency: parseJson(r.latency_json, {}),
    tokens: parseJson(r.tokens_json, {}),
  }));

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

const _shutdownHandler = async () => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (writeBuffer.length > 0) await flushToDatabase();
};

// Use global flag to prevent duplicate listeners across HMR reloads
if (!global._requestDetailsShutdownRegistered) {
  global._requestDetailsShutdownRegistered = true;
  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}
