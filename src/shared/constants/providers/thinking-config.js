/**
 * Thinking config, risk notice, and MiniMax TTS models.
 * @module providers/thinking-config
 */

export const RISK_NOTICE =
  "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.";

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000,
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto",
  },
};

export const MINIMAX_TTS_MODELS = [
  { id: "speech-2.8-hd", name: "Speech 2.8 HD" },
  { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo" },
  { id: "speech-2.6-hd", name: "Speech 2.6 HD" },
  { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo" },
  { id: "speech-02-hd", name: "Speech 02 HD" },
  { id: "speech-02-turbo", name: "Speech 02 Turbo" },
  { id: "speech-01-hd", name: "Speech 01 HD" },
  { id: "speech-01-turbo", name: "Speech 01 Turbo" },
];
