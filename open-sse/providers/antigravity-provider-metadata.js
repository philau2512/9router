export const ANTIGRAVITY_BASE_URLS = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
];

export const ANTIGRAVITY_OPERATIONS = {
  fetchAvailableModels: "/v1internal:fetchAvailableModels",
  loadCodeAssist: "/v1internal:loadCodeAssist",
};

export const ANTIGRAVITY_USAGE_ENDPOINTS = {
  quotaApiUrl: `${ANTIGRAVITY_BASE_URLS[0]}${ANTIGRAVITY_OPERATIONS.fetchAvailableModels}`,
  loadProjectApiUrl: `${ANTIGRAVITY_BASE_URLS[0]}${ANTIGRAVITY_OPERATIONS.loadCodeAssist}`,
};

export const ANTIGRAVITY_MODEL_ALIASES = {
  "gemini-3.6-flash-agent": "gemini-3-flash-agent",
  "gemini-3.6-flash-high": "gemini-3-flash-agent",
  "gemini-3.6-flash-low": "gemini-3.5-flash-low",
  "gemini-3.6-flash-medium": "gemini-3.5-flash-low",
  "gemini-3.6-flash-extra-low": "gemini-3.5-flash-extra-low",
};

export const ANTIGRAVITY_STATIC_MODELS = [
  { id: "gemini-3.6-flash-agent", name: "Gemini 3.6 Flash (High)" },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Medium)" },
  {
    id: "gemini-3.6-flash-extra-low",
    name: "Gemini 3.6 Flash (Low)",
  },
  { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)" },
  { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)" },
  {
    id: "gemini-3.5-flash-extra-low",
    name: "Gemini 3.5 Flash (Low)",
  },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
  },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", thinking: false },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash (Image)",
    kind: "image",
    type: "image",
    imageGen: true,
    capabilities: ["textToImage"],
  },
];

export const ANTIGRAVITY_USAGE_MODEL_IDS = new Set(
  ANTIGRAVITY_STATIC_MODELS.map(({ id }) => id),
);

export const ANTIGRAVITY_DYNAMIC_MODEL_SKIP_IDS = new Set([
  "chat_20706",
  "chat_23310",
  "tab_flash_lite_preview",
  "tab_jump_flash_lite_preview",
  "gemini-2.5-flash-thinking",
  "gemini-2.5-pro",
]);
