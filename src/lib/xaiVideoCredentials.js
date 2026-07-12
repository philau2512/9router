/**
 * Shared credential resolution for xAI / Grok Imagine video routes.
 * Kept outside route modules to avoid route→route imports.
 *
 * IMPORTANT: Imagine Video (`api.x.ai/v1/videos/*`) needs a console.x.ai API key
 * (or xAI PKCE OAuth scoped for api.x.ai). Super Grok / grok-cli device-code
 * tokens target cli-chat-proxy.grok.com for chat and typically return
 * "Model not found: grok-imagine-video" on the Imagine API.
 */
import { getProviderCredentials } from "@/sse/services/provider-credentials";
import { resolveProviderId } from "@/shared/constants/providers";
import {
  hasVideoCredentials,
  xaiVideoCredentialCandidates,
} from "open-sse/handlers/videoProviders/xai.js";

/**
 * @param {string} [providerAlias]
 * @param {{ preferredConnectionId?: string|null }} [options]
 * @returns {Promise<object|null>}
 */
export async function resolveXaiVideoCredentials(
  providerAlias = "xai",
  options = {},
) {
  const preferredConnectionId = options?.preferredConnectionId || null;
  const candidates = xaiVideoCredentialCandidates(
    resolveProviderId(providerAlias),
  );

  for (const provider of candidates) {
    try {
      const c = await getProviderCredentials(provider, null, null, {
        preferredConnectionId,
      });
      if (hasVideoCredentials(c)) return c;
    } catch {
      // try next
    }
  }
  return null;
}