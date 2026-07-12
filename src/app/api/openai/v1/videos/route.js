import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { resolveXaiVideoCredentials } from "@/lib/xaiVideoCredentials";
import {
  handleXaiVideo,
  hasVideoCredentials,
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
 * POST /openai/v1/videos - xAI (Grok) video generation.
 *
 * Body: standard xAI video payload, plus optional routing fields:
 *   - operation: "generations" (default) | "edits" | "extensions"
 *   - request_id: when set, polls GET /videos/{request_id} instead of creating
 * Credentials: same pool as /v1/video/generations (xai API key or OAuth / grok-cli).
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: { message: "Invalid JSON body" } });
  }

  let credentials;
  try {
    const preferredConnectionId =
      request.headers.get("x-connection-id") || null;
    credentials = await resolveXaiVideoCredentials("xai", {
      preferredConnectionId,
    });
  } catch (err) {
    return json(502, {
      error: {
        message: `Failed to resolve Grok credentials: ${err?.message || err}`,
      },
    });
  }
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

  const idempotencyKey = request.headers.get("x-idempotency-key") || null;

  const result = await handleXaiVideo({
    body,
    credentials,
    proxyOptions,
    log: console,
    idempotencyKey,
  });

  return json(result.status || (result.ok ? 200 : 502), result.data ?? {});
}