/**
 * Free providers (no auth required, limited models).
 * @module providers/free-providers
 */

import { RISK_NOTICE } from "./thinking-config.js";

// Free Providers (kiro first, iflow last)
export const FREE_PROVIDERS = {
  kiro: {
    id: "kiro",
    alias: "kr",
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    deprecated: true,
    deprecationNotice: RISK_NOTICE,
    website: "https://kiro.dev",
    notice: { signupUrl: "https://kiro.dev" },
  },
  // qwen: { id: "qwen", alias: "qw", name: "Qwen Code", icon: "psychology", color: "#10B981", mediaPriority: 999, deprecated: true, deprecationNotice: "Qwen OAuth free tier was discontinued by Alibaba on 2026-04-15. New connections will not work.", website: "https://chat.qwen.ai", notice: { signupUrl: "https://chat.qwen.ai" }, serviceKinds: ["llm", "tts"], ttsConfig: { baseUrl: "http://localhost:8000/v1/audio/speech", authType: "none", authHeader: "none", format: "openai", models: [{ id: "qwen3-tts", name: "Qwen3 TTS" }] } },
  "gemini-cli": {
    id: "gemini-cli",
    alias: "gc",
    name: "Gemini CLI",
    icon: "terminal",
    color: "#4285F4",
    deprecated: true,
    deprecationNotice: RISK_NOTICE,
    website: "https://github.com/google-gemini/gemini-cli",
    notice: { signupUrl: "https://github.com/google-gemini/gemini-cli" },
  },
  // gitlab: { id: "gitlab", alias: "gl", name: "GitLab Duo", icon: "code", color: "#FC6D26" },
  // qoder: { id: "qoder", alias: "qd", name: "Qoder AI", icon: "water_drop", color: "#EC4899" },
  // iflow: { id: "iflow", alias: "if", name: "iFlow AI", icon: "water_drop", color: "#6366F1", website: "https://iflow.cn", notice: { signupUrl: "https://iflow.cn" } },
  opencode: {
    id: "opencode",
    alias: "oc",
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    noAuth: true,
    passthroughModels: true,
    modelsFetcher: {
      url: "https://opencode.ai/zen/v1/models",
      type: "opencode-free",
    },
  },
  qoder: {
    id: "qoder",
    alias: "qd",
    name: "Qoder",
    icon: "water_drop",
    color: "#EC4899",
    deprecated: true,
    deprecationNotice: RISK_NOTICE,
    website: "https://qoder.com",
    notice: { signupUrl: "https://qoder.com" },
  },
  "mimo-free": {
    id: "mimo-free",
    alias: "mmf",
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
    noAuth: true,
    passthroughModels: true,
    modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  },
};
