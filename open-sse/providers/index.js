// Compatibility re-exports for upstream import paths.
//
// The fork stores provider data in open-sse/config/; this module bridges
// the gap so code targeting open-sse/providers/* continues to work without
// changing import paths across the codebase.
//
// Import pattern equivalence:
//   upstream: import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js"
//   fork:     same path now works via this package

// ── Transport config + OAuth settings ─────────────────────────────────────
export { PROVIDERS } from "../config/providers.js";

// ── Model lists (keyed by alias, matching upstream PROVIDERS export shape) ─
export {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelTargetFormat,
} from "../config/providerModels.js";

// ── PROVIDER_MEDIA re-export ───────────────────────────────────────────────
// Upstream ttsProviders/gemini.js imports PROVIDER_MEDIA from providers/index.js.
// In the fork, TTS config lives in config/ttsModels.js under TTS_MODELS_CONFIG.
import { TTS_MODELS_CONFIG } from "../config/ttsModels.js";
export const PROVIDER_MEDIA = TTS_MODELS_CONFIG;

// ── Model capabilities (contextWindow, vision, reasoning, thinkingFormat…) ─
export {
  DEFAULT_CAPABILITIES,
  MODEL_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  PATTERN_CAPABILITIES,
  getCapabilitiesForModel,
  capabilitiesFromServiceKind,
} from "./capabilities.js";

// ── Provider registry (for future upstream registry-based imports) ─────────
export { default as REGISTRY } from "./registry/index.js";