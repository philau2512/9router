// Compatibility re-exports for upstream import paths.
//
// The fork stores provider data in open-sse/config/; this module bridges
// the gap so code targeting open-sse/providers/* continues to work without
// changing import paths across the codebase.
//
// Import pattern equivalence:
//   upstream: import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js"
//   fork:     same path now works via this package

// ── Transport config, OAuth settings, and model lists ──────────────────────
import { PROVIDERS as TRANSPORTS } from "../config/providers.js";
import {
  PROVIDER_MODELS as CONFIG_PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelTargetFormat,
} from "../config/providerModels.js";

export const PROVIDERS = TRANSPORTS;
export const PROVIDER_MODELS = CONFIG_PROVIDER_MODELS;

export { PROVIDER_ID_TO_ALIAS, getModelsByProviderId, getModelTargetFormat };

// ── Provider media config ─────────────────────────────────────────────────
// Keep legacy TTS config while exposing registry-owned media config such as
// xAI video jobs to upstream-compatible handlers.
import { TTS_MODELS_CONFIG } from "../config/ttsModels.js";
import REGISTRY from "./registry/index.js";

export const PROVIDER_OAUTH = Object.fromEntries(
  REGISTRY.filter((entry) => entry.oauth).map((entry) => [entry.id, entry.oauth]),
);

const MEDIA_KEYS = [
  "serviceKinds",
  "ttsConfig",
  "sttConfig",
  "embeddingConfig",
  "imageConfig",
  "imageToTextConfig",
  "videoConfig",
  "musicConfig",
  "searchViaChat",
  "searchConfig",
  "fetchConfig",
  "modelsFetcher",
  "mediaPriority",
  "hiddenKinds",
];

export const PROVIDER_MEDIA = { ...TTS_MODELS_CONFIG };
for (const entry of REGISTRY) {
  const media = { ...(entry.media || {}) };
  for (const key of MEDIA_KEYS) {
    if (entry[key] !== undefined) media[key] = entry[key];
  }
  if (Object.keys(media).length > 0) {
    PROVIDER_MEDIA[entry.id] = { ...PROVIDER_MEDIA[entry.id], ...media };
  }
}

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