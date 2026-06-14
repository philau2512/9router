/**
 * Prefix constants, check functions, and auth methods.
 * @module providers/helpers
 */

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

export function isOpenAICompatibleProvider(providerId) {
  return (
    typeof providerId === "string" &&
    providerId.startsWith(OPENAI_COMPATIBLE_PREFIX)
  );
}

export function isAnthropicCompatibleProvider(providerId) {
  return (
    typeof providerId === "string" &&
    providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)
  );
}

export function isCustomEmbeddingProvider(providerId) {
  return (
    typeof providerId === "string" &&
    providerId.startsWith(CUSTOM_EMBEDDING_PREFIX)
  );
}

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth", name: "OAuth", icon: "lock" },
  apikey: { id: "apikey", name: "API Key", icon: "key" },
  cookie: { id: "cookie", name: "Browser Cookie", icon: "cookie" },
};
