import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { resolveXaiVideoCredentials } from "@/lib/xaiVideoCredentials";
import {
  handleXaiVideo,
  hasVideoCredentials,
  DEFAULT_VIDEO_MODEL,
} from "open-sse/handlers/videoProviders/xai.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

function json(status, payload) {
  return Response.json(payload, { status, headers: CORS });
}

/**
 * POST /v1/video/generations — OpenAI-style text-to-video (xAI/Grok Imagine).
 *
 * Body: { model: "xai/<model>" | "xai", prompt, ...params }
 * Optional routing params (from the media-provider playground):
 *   - operation: "generations" (default) | "edits" | "extensions"
 *   - request_id: poll GET /videos/{request_id} instead of creating
 * Credentials: prefer console.x.ai API key. Super Grok OAuth often lacks Imagine.
 * Header x-connection-id pins a specific connection when set.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: { message: "Invalid JSON body" } });
  }

  const rawModel = typeof body.model === "string" ? body.model.trim() : "";
  // model is "<providerAlias>/<model>" or just "<providerAlias>"; strip prefix.
  const providerAlias = rawModel.includes("/")
    ? rawModel.slice(0, rawModel.indexOf("/"))
    : rawModel || "xai";
  const modelId = rawModel.includes("/")
    ? rawModel.slice(rawModel.indexOf("/") + 1)
    : "";

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const credentials = await resolveXaiVideoCredentials(providerAlias, {
    preferredConnectionId,
  });

  if (!hasVideoCredentials(credentials)) {
    return json(401, {
      error: {
        message:
          "No active Grok (xAI) connection with credentials. Add a console.x.ai API key for Imagine video (Super Grok / grok-cli OAuth often cannot call api.x.ai video models).",
      },
    });
  }

  const proxyOptions = await resolveConnectionProxyConfig(
    credentials.providerSpecificData || {},
  );

  // Forward bare upstream model id; default official Imagine video model.
  const forwardBody = { ...body };
  if (modelId) forwardBody.model = modelId;
  else if (!forwardBody.model || forwardBody.model === providerAlias) {
    forwardBody.model = DEFAULT_VIDEO_MODEL;
  }

  const idempotencyKey = request.headers.get("x-idempotency-key") || null;

  const result = await handleXaiVideo({
    body: forwardBody,
    credentials,
    proxyOptions,
    log: console,
    idempotencyKey,
  });

  // Clarify common Super Grok OAuth failure for operators
  if (
    !result.ok &&
    result.status === 400 &&
    /model not found/i.test(
      JSON.stringify(result.data?.error || result.data || ""),
    )
  ) {
    const msg =
      result.data?.error?.message ||
      result.data?.error?.error ||
      result.data?.error ||
      "Model not found";
    return json(400, {
      error: {
        message: `${typeof msg === "string" ? msg : JSON.stringify(msg)}. Imagine Video requires a console.x.ai API key with Imagine access — Super Grok OAuth tokens usually cannot list this model on api.x.ai.`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
      ...(result.data && typeof result.data === "object" ? { upstream: result.data } : {}),
    });
  }

  return json(result.status || (result.ok ? 200 : 502), result.data ?? {});
}