// Role enums — fixed per format. Pure data (no logic).
export const ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
  SYSTEM: "system",
  DEVELOPER: "developer",
};

// Gemini / Antigravity use "model" instead of "assistant".
export const GEMINI_ROLE = {
  USER: "user",
  MODEL: "model",
};
