/**
 * Usage/quota supported provider lists.
 * @module providers/usage-constants
 */

// Providers that support usage/quota API
export const USAGE_SUPPORTED_PROVIDERS = [
  "claude",
  "antigravity",
  "kiro",
  "github",
  "codex",
  "kimi-coding",
  "ollama",
  "gemini-cli",
  "glm",
  "glm-cn",
  "minimax",
  "minimax-cn",
  "qoder",
  "vercel-ai-gateway",
];

// Subset that uses apikey auth (still surfaced on quota page)
export const USAGE_APIKEY_PROVIDERS = [
  "glm",
  "glm-cn",
  "minimax",
  "minimax-cn",
  "vercel-ai-gateway",
];
