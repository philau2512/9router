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
 * Auth: Bearer from OAuth accessToken OR console.x.ai apiKey (Imagine API).
 * Thin pass-through: forwards JSON and returns upstream JSON so clients poll
 * with the returned request_id (prefer client-side poll over long HTTP holds).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_VIDEO_MODEL = "grok-imagine-video";

/** Models that only support image-to-video (xAI rejects text-only). */
const IMAGE_REQUIRED_VIDEO_MODELS = new Set(["grok-imagine-video-1.5"]);

const VIDEO_PATHS = {
  generations: "/videos/generations",
  edits: "/videos/edits",
  extensions: "/videos/extensions",
};

/** Routing-only fields never sent upstream. */
const ROUTING_KEYS = new Set([
  "request_id",
  "operation",
  "auto_poll",
  "duration_seconds",
]);

function bareVideoModelId(model) {
  const raw = String(model || "").trim();
  if (!raw) return DEFAULT_VIDEO_MODEL;
  return raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
}

/** True when model only accepts image-to-video (not text-to-video). */
export function videoModelRequiresImage(model) {
  return IMAGE_REQUIRED_VIDEO_MODELS.has(bareVideoModelId(model));
}

function hasStartImage(body = {}) {
  const candidates = [body.image, body.image_url, body.imageUrl];
  return candidates.some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}

/**
 * Local validation before hitting xAI.
 * Returns { ok:true } or { ok:false, status, data } for early response.
 */
export function validateVideoBody(body = {}) {
  // Poll / non-create paths do not need image
  const requestId =
    typeof body.request_id === "string" ? body.request_id.trim() : "";
  if (requestId) return { ok: true };

  const op = String(body.operation || "generations").toLowerCase();
  // edits/extensions use `video`, not start-frame image
  if (op === "edits" || op === "extensions") return { ok: true };

  const model = bareVideoModelId(body.model || DEFAULT_VIDEO_MODEL);
  if (videoModelRequiresImage(model) && !hasStartImage(body)) {
    return {
      ok: false,
      status: 400,
      data: {
        error: {
          message: `${model} is image-to-video only: provide body.image (URL, data URL, or file id). Text-to-video is not supported for this model — use grok-imagine-video for prompt-only.`,
          type: "invalid_request_error",
          code: "image_required",
        },
      },
    };
  }
  return { ok: true };
}

export function resolveBearerToken(credentials) {
  const token = credentials?.accessToken || credentials?.apiKey;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export function hasVideoCredentials(credentials) {
  return !!resolveBearerToken(credentials);
}

function resolveBaseUrl(credentials) {
  const base =
    credentials?.providerSpecificData?.baseUrl ||
    credentials?.baseURL ||
    DEFAULT_BASE_URL;
  return String(base).replace(/\/$/, "");
}

function buildHeaders(token, { idempotencyKey } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
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
 * Map playground aliases → xAI REST fields; drop empty optionals.
 * Does not strip request_id/operation (caller uses those for routing first).
 */
export function normalizeVideoBody(body = {}) {
  const out = { ...body };

  // Playground historically used duration_seconds; xAI expects duration (1–15).
  if (
    (out.duration === undefined || out.duration === null || out.duration === "") &&
    out.duration_seconds !== undefined &&
    out.duration_seconds !== null &&
    out.duration_seconds !== ""
  ) {
    const n = Number(out.duration_seconds);
    if (!Number.isNaN(n)) out.duration = n;
  }
  delete out.duration_seconds;
  delete out.auto_poll;

  // Comma/newline-separated UI string → array for reference_images
  if (typeof out.reference_images === "string") {
    const list = out.reference_images
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) out.reference_images = list;
    else delete out.reference_images;
  }

  if (!out.model || out.model === "") {
    out.model = DEFAULT_VIDEO_MODEL;
  }

  // Drop empty strings / null (keep 0/false)
  for (const key of Object.keys(out)) {
    if (ROUTING_KEYS.has(key)) continue;
    const v = out[key];
    if (v === "" || v === null || v === undefined) delete out[key];
  }

  return out;
}

/**
 * @param {object} args
 * @param {object} args.body - request payload (may include request_id / operation)
 * @param {object} args.credentials - { accessToken?, apiKey?, providerSpecificData? }
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
  const token = resolveBearerToken(credentials);
  if (!token) {
    return {
      status: 401,
      ok: false,
      data: {
        error: {
          message:
            "xAI video: no credentials. Use console.x.ai API key or an active xAI / grok-cli OAuth token.",
        },
      },
    };
  }

  // Fail fast: grok-imagine-video-1.5 rejects text-only generations
  const preflight = validateVideoBody(body);
  if (!preflight.ok) {
    return {
      status: preflight.status,
      ok: false,
      data: preflight.data,
    };
  }

  const { method, path, hasBody } = resolveVideoEndpoint(body);
  const url = resolveBaseUrl(credentials) + path;

  const normalized = normalizeVideoBody(body);
  // Strip routing-only keys before upstream POST
  const forwardBody = { ...normalized };
  delete forwardBody.request_id;
  delete forwardBody.operation;

  const init = {
    method,
    headers: buildHeaders(token, { idempotencyKey }),
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

/**
 * Candidate provider ids for video credential lookup (order = preference).
 * @param {string} [providerAlias]
 * @returns {string[]}
 */
export function xaiVideoCredentialCandidates(providerAlias = "xai") {
  const alias = String(providerAlias || "xai").trim() || "xai";
  return [alias, "xai", "grok-cli"].filter((v, i, a) => v && a.indexOf(v) === i);
}

export { DEFAULT_VIDEO_MODEL };