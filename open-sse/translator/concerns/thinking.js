// Concern: reasoning_effort ↔ provider-native thinking config.
// Central source of truth for level↔budget maps (web-standard values).
// Provider-specific application lives in thinkingUnified.js; this file is maps-only.

// Discrete effort levels, ordered low→high.
export const EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// Web-standard level → budget_tokens (Anthropic/Gemini docs).
export const LEVEL_TO_BUDGET = {
  none: 0,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 128000,
};

// Returns budget_tokens for an effort level, or undefined if unknown.
// 0 means "no thinking"; undefined means "effort not recognized".
export function effortToBudget(effort) {
  if (!effort) return undefined;
  return LEVEL_TO_BUDGET[String(effort).toLowerCase()];
}

// OpenAI reasoning_effort → Gemini thinkingLevel (gemini-3 enum: minimal|low|medium|high).
// Gemini 3 cannot fully disable thinking; "none"/"off" map to "minimal".
export function effortToThinkingLevel(effort) {
  const e = String(effort).toLowerCase().trim();
  if (e === "none" || e === "off") return "minimal";
  if (e === "xhigh" || e === "max") return "high";
  return e;
}

// Numeric budget → nearest discrete level (reverse map via thresholds).
// Returns null when budget <= 0 (no reasoning).
export function budgetToLevel(budget) {
  const b = Number(budget);
  if (!b || b <= 0) return null;
  if (b <= 768) return "minimal";
  if (b <= 4096) return "low";
  if (b <= 16384) return "medium";
  if (b <= 28672) return "high";
  return "xhigh";
}

// Gemini thinkingBudget (numeric) → OpenAI reasoning_effort (antigravity reverse map).
export function budgetToEffort(budget) {
  if (!budget || budget <= 0) return null;
  if (budget <= 2048) return "low";
  if (budget <= 16384) return "medium";
  return "high";
}

// auto → -1 sentinel (CLIProxyAPI canonical: auto=-1)
export const LEVEL_TO_BUDGET_WITH_AUTO = { ...LEVEL_TO_BUDGET, auto: -1 };

// Model suffix parser: "model-name(value)" → { modelName, thinkingConfig }
// value can be: level string (high/low/...), numeric budget, "none", "auto"
// Returns { modelName, thinkingConfig: { mode, level?, budget? } | null }
export function parseModelThinkingSuffix(modelName) {
  if (!modelName || typeof modelName !== "string")
    return { modelName, thinkingConfig: null };
  const m = modelName.match(/^(.+?)\(([a-zA-Z0-9]+)\)$/);
  if (!m) return { modelName, thinkingConfig: null };
  const base = m[1];
  const raw = m[2].toLowerCase();
  if (raw === "none")
    return { modelName: base, thinkingConfig: { mode: "none" } };
  if (raw === "auto")
    return { modelName: base, thinkingConfig: { mode: "auto" } };
  if (LEVEL_TO_BUDGET[raw] !== undefined)
    return { modelName: base, thinkingConfig: { mode: "level", level: raw } };
  const budget = parseInt(raw, 10);
  if (!isNaN(budget) && budget >= 0)
    return { modelName: base, thinkingConfig: { mode: "budget", budget } };
  // Unrecognized suffix — treat as part of model name (defensive)
  return { modelName, thinkingConfig: null };
}

// Per-provider applyThinking registry
// applierFn(body, config, capabilities) → body
const _appliers = new Map();
export function registerThinkingApplier(provider, applierFn) {
  if (provider && typeof applierFn === "function")
    _appliers.set(provider, applierFn);
}
export function applyThinking(provider, body, config, capabilities) {
  if (!config || !body) return body;
  const fn = _appliers.get(provider);
  if (!fn) return body;
  try {
    return fn(body, config, capabilities) || body;
  } catch {
    return body;
  }
}

// Register built-in appliers
// openai / codex: reasoning_effort string
function _applyOpenAI(body, config) {
  const b = { ...body };
  if (config.mode === "none") {
    delete b.reasoning_effort;
    return b;
  }
  if (config.mode === "auto") {
    b.reasoning_effort = "high";
    return b;
  }
  if (config.mode === "level") {
    b.reasoning_effort =
      config.level === "xhigh" || config.level === "max"
        ? "high"
        : config.level;
    return b;
  }
  if (config.mode === "budget") {
    b.reasoning_effort = budgetToLevel(config.budget) || "medium";
    return b;
  }
  return b;
}
registerThinkingApplier("openai", _applyOpenAI);
registerThinkingApplier("codex", _applyOpenAI);

// claude: thinking { type, budget_tokens }
function _applyClaude(body, config, caps) {
  const b = { ...body };
  const fmt = caps?.thinkingFormat || "claude-budget";
  if (config.mode === "none") {
    if (caps?.thinkingCanDisable === false) {
      b.thinking = {
        type: "enabled",
        budget_tokens: caps?.thinkingRange?.min || 512,
      };
    } else {
      b.thinking = { type: "disabled" };
    }
    return b;
  }
  if (config.mode === "auto" || fmt === "claude-adaptive") {
    b.thinking = { type: "enabled" };
    return b;
  }
  const budget =
    config.mode === "budget"
      ? config.budget
      : config.mode === "level"
        ? (LEVEL_TO_BUDGET[config.level] ?? 8192)
        : 8192;
  const clamped = caps?.thinkingRange
    ? Math.min(Math.max(budget, caps.thinkingRange.min), caps.thinkingRange.max)
    : budget;
  b.thinking = { type: "enabled", budget_tokens: clamped };
  return b;
}
registerThinkingApplier("claude", _applyClaude);

// antigravity / gemini / gemini-cli: thinkingConfig.thinkingBudget
function _applyGemini(body, config) {
  const b = { ...body };
  const gc = b.generationConfig ? { ...b.generationConfig } : {};
  if (config.mode === "none") {
    gc.thinkingConfig = { thinkingBudget: 0 };
  } else if (config.mode === "auto") {
    gc.thinkingConfig = { thinkingBudget: -1 };
  } else if (config.mode === "level") {
    gc.thinkingConfig = {
      thinkingBudget: LEVEL_TO_BUDGET[config.level] ?? 8192,
    };
  } else if (config.mode === "budget") {
    gc.thinkingConfig = { thinkingBudget: config.budget };
  }
  b.generationConfig = gc;
  return b;
}
registerThinkingApplier("antigravity", _applyGemini);
registerThinkingApplier("gemini", _applyGemini);
registerThinkingApplier("gemini-cli", _applyGemini);

// deepseek: extra_body.thinking.type + reasoning_effort
function _applyDeepSeek(body, config) {
  const b = { ...body };
  if (config.mode === "none") {
    b.extra_body = { ...(b.extra_body || {}), thinking: { type: "disabled" } };
    delete b.reasoning_effort;
    return b;
  }
  b.extra_body = { ...(b.extra_body || {}), thinking: { type: "enabled" } };
  if (config.mode === "level") b.reasoning_effort = config.level;
  else if (config.mode === "budget")
    b.reasoning_effort = budgetToLevel(config.budget) || "medium";
  else if (config.mode === "auto") b.reasoning_effort = "high";
  return b;
}
registerThinkingApplier("deepseek", _applyDeepSeek);
