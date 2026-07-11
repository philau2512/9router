import { getProviderCredentials } from "@/sse/services/provider-credentials";
import { resolveProviderId } from "@/shared/constants/providers";
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
 * POST /v1/video/generations — OpenAI-style text-to-video (xAI/Grok).
 *
 * Body: { model: "xai/<model>" | "xai", prompt, ...params }
 * Optional routing params (from the media-provider playground):
 *   - operation: "generations" (default) | "edits" | "extensions"
 *   - request_id: poll GET /videos/{request_id} instead of creating
 * Credentials resolved from the model's provider prefix (defaults to xai/grok-cli).
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

  // Resolve credentials: try the resolved provider id, then xai, then grok-cli.
  const candidates = [
    resolveProviderId(providerAlias),
    "xai",
    "grok-cli",
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let credentials = null;
  for (const provider of candidates) {
    try {
      const c = await getProviderCredentials(provider);
      if (c?.accessToken) {
        credentials = c;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!credentials?.accessToken) {
    return json(401, {
      error: {
        message:
          "No active Grok (xAI) connection. Connect an xAI / grok-cli account first.",
      },
    });
  }

  const proxyOptions = await resolveConnectionProxyConfig(
    credentials.providerSpecificData || {},
  );

  // Forward everything except our routing-only `model` prefix wrapper; keep the
  // bare upstream model id when present so xAI can pick the right video model.
  const forwardBody = { ...body };
  if (modelId) forwardBody.model = modelId;
  else delete forwardBody.model;

  const idempotencyKey = request.headers.get("x-idempotency-key") || null;

  const result = await handleXaiVideo({
    body: forwardBody,
    credentials,
    proxyOptions,
    log: console,
    idempotencyKey,
  });

  return json(result.status || (result.ok ? 200 : 502), result.data ?? {});
}
