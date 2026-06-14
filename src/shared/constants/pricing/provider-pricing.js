/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 *
 * All rates in $/1M tokens.
 */
export const PROVIDER_PRICING = {
  // GitHub Copilot (gh) — gpt-5.3-codex has different rate than canonical
  gh: {
    "gpt-5.3-codex": {
      input: 1.75,
      output: 14.0,
      cached: 0.175,
      reasoning: 14.0,
      cache_creation: 1.75,
    },
  },
};
