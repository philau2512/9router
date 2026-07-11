import { getProviderCredentials } from "@/sse/services/provider-credentials";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { handleXaiVideo } from "open-sse/handlers/videoProviders/xai.js";

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
 * Uses the grok-cli OAuth credential pool (same as chat).
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
    credentials = await getProviderCredentials("grok-cli");
  } catch (err) {
    return json(502, {
      error: {
        message: `Failed to resolve Grok credentials: ${err?.message || err}`,
      },
    });
  }
  if (!credentials?.accessToken) {
    return json(401, {
      error: {
        message:
          "No active Grok (xAI) OAuth connection. Connect a grok-cli account first.",
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
