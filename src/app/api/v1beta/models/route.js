import { PROVIDER_MODELS } from "@/shared/constants/models";
import { requireValidApiKey } from "@/sse/services/api-key-validation.js";
import { filterApiKeyAccessibleModels } from "@/sse/services/api-key-access.js";
import { getModelInfo } from "@/sse/services/model.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    // Collect all models from all providers
    const models = [];

    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    const auth = await requireValidApiKey(request);
    if (!auth.ok) {
      return Response.json(
        { error: { message: auth.message, code: auth.code } },
        { status: auth.status },
      );
    }
    const visibleModels = await filterApiKeyAccessibleModels(
      auth.keyInfo,
      models,
      async (entry) => {
        const [, provider, ...modelParts] = entry.name.split("/");
        return [await getModelInfo(`${provider}/${modelParts.join("/")}`)];
      },
    );

    return Response.json({ models: visibleModels });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message } },
      { status: 500 },
    );
  }
}
