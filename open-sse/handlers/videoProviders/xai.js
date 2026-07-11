/**
 * xAI video generation handler.
 *
 * Mirrors CLIProxyAPI internal/runtime/executor/xai_executor.go executeVideos:
 *   POST {base}/videos/generations   — create a video job
 *   POST {base}/videos/edits         — edit
 *   POST {base}/videos/extensions    — extend
 *   GET  {base}/videos/{request_id}  — poll job status (when body has request_id)
 * base defaults to https://api.x.ai/v1 (xAI DefaultAPIBaseURL).
 *
 * Auth reuses the grok-cli OAuth access token (same credential pool as chat).
 * The handler is a thin pass-through: it forwards the JSON payload and returns
 * the upstream JSON verbatim so clients can poll with the returned request_id.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";

const VIDEO_PATHS = {
  generations: "/videos/generations",
  edits: "/videos/edits",
  extensions: "/videos/extensions",
};

function resolveBaseUrl(credentials) {
  const base =
    credentials?.providerSpecificData?.baseUrl ||
    credentials?.baseURL ||
    DEFAULT_BASE_URL;
  return String(base).replace(/\/$/, "");
}

function buildHeaders(credentials, { idempotencyKey } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
  };
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}

/**
 * Decide endpoint + method for a video request.
 * - body.request_id present  → GET /videos/{request_id} (poll)
 * - body.operation edits/extensions → matching POST path
 * - otherwise                → POST /videos/generations
 */
export function resolveVideoEndpoint(body = {}) {
  const requestId =
    typeof body.request_id === "string" ? body.request_id.trim() : "";
  if (requestId) {
    return {
      method: "GET",
      path: `/videos/${encodeURIComponent(requestId)}`,
      hasBody: false,
    };
  }
  const op = String(body.operation || "generations").toLowerCase();
  const path = VIDEO_PATHS[op] || VIDEO_PATHS.generations;
  return { method: "POST", path, hasBody: true };
}

/**
 * @param {object} args
 * @param {object} args.body - request payload (may include request_id / operation)
 * @param {object} args.credentials - { accessToken, providerSpecificData }
 * @param {object} [args.proxyOptions]
 * @param {object} [args.log]
 * @param {string} [args.idempotencyKey]
 * @returns {Promise<{ status:number, ok:boolean, data:any }>}
 */
export async function handleXaiVideo({
  body = {},
  credentials,
  proxyOptions = null,
  log = null,
  idempotencyKey = null,
}) {
  if (!credentials?.accessToken) {
    return {
      status: 401,
      ok: false,
      data: { error: { message: "xAI video: no access token available" } },
    };
  }

  const { method, path, hasBody } = resolveVideoEndpoint(body);
  const url = resolveBaseUrl(credentials) + path;

  // Strip our routing-only fields before forwarding.
  const forwardBody = { ...body };
  delete forwardBody.request_id;
  delete forwardBody.operation;

  const init = {
    method,
    headers: buildHeaders(credentials, { idempotencyKey }),
  };
  if (hasBody) init.body = JSON.stringify(forwardBody);

  log?.debug?.("XAI_VIDEO", `${method} ${path}`);

  let res;
  try {
    res = await proxyAwareFetch(url, init, proxyOptions);
  } catch (err) {
    return {
      status: 502,
      ok: false,
      data: {
        error: { message: `xAI video request failed: ${err?.message || err}` },
      },
    };
  }

  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}
