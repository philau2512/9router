/**
 * Provider definitions — barrel re-export.
 *
 * This file was auto-split into sub-modules under ./providers/.
 * Consumer imports remain unchanged — this barrel re-exports everything.
 */

// Re-export sub-module data
export { THINKING_CONFIG } from "./providers/thinking-config.js";
export { FREE_PROVIDERS } from "./providers/free-providers.js";
export { FREE_TIER_PROVIDERS } from "./providers/free-tier-providers.js";
export { OAUTH_PROVIDERS } from "./providers/oauth-providers.js";
export { APIKEY_PROVIDERS } from "./providers/apikey-providers.js";
export { WEB_COOKIE_PROVIDERS } from "./providers/web-cookie-providers.js";
export { MEDIA_PROVIDER_KINDS } from "./providers/media-provider-kinds.js";
export {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "./providers/usage-constants.js";
const MEDIA_ENTRY_KEYS = [
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig", "credentialFallback",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
];

// Re-export helpers (no AI_PROVIDERS dependency)
export {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
  CUSTOM_EMBEDDING_PREFIX,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  AUTH_METHODS,
} from "./providers/helpers.js";

// Compose AI_PROVIDERS from all provider categories
import { FREE_PROVIDERS } from "./providers/free-providers.js";
import { FREE_TIER_PROVIDERS } from "./providers/free-tier-providers.js";
import { OAUTH_PROVIDERS } from "./providers/oauth-providers.js";
import { APIKEY_PROVIDERS } from "./providers/apikey-providers.js";
import { WEB_COOKIE_PROVIDERS } from "./providers/web-cookie-providers.js";

// All providers (combined)
export const AI_PROVIDERS = {
  ...FREE_PROVIDERS,
  ...FREE_TIER_PROVIDERS,
  ...OAUTH_PROVIDERS,
  ...APIKEY_PROVIDERS,
  ...WEB_COOKIE_PROVIDERS,
};

// Helper: Get provider by alias
export function getProviderByAlias(alias) {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias) {
      return provider;
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId) {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId) {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  return acc;
}, {});

// ID to Alias mapping
export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {});

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind) {
  return Object.values(AI_PROVIDERS)
    .filter((p) => {
      const kinds = p.serviceKinds ?? ["llm"];
      if (!kinds.includes(kind)) return false;
      if (p.hidden) return false;
      if (p.hiddenKinds?.includes(kind)) return false;
      return true;
    })
    .sort((a, b) => (a.mediaPriority ?? 100) - (b.mediaPriority ?? 100));
}
