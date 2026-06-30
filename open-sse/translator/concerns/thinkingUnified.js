// Unified thinking normalization: extract client intent from any request shape.
// This is a registry-free subset of the upstream thinkingUnified.js concern —
// only extractThinking is ported here; full provider-native application (applyThinking)
// is deferred until the registry migration lands (Phase 6).

import { LEVEL_TO_BUDGET } from "./thinking.js";

// Extract unified thinking intent from a request body (post-translation, mixed shapes).
// Returns { mode, budget?, level? } or null when no thinking intent present.
//
// Supported client shapes:
//   - Claude output_config.effort (explicit effort string)
//   - Claude thinking { type, budget_tokens }
//   - OpenAI reasoning_effort (string) / reasoning.effort
//   - Gemini thinkingConfig.thinkingBudget / thinkingLevel
//   - Qwen enable_thinking / thinking_budget
export function extractThinking(body) {
  if (!body || typeof body !== "object") return null;

  // Claude output_config.effort (explicit) — priority over adaptive thinking
  const oc = body.output_config?.effort;
  if (typeof oc === "string" && oc) {
    const e = oc.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  // Claude shape
  const t = body.thinking;
  if (t && typeof t === "object") {
    if (t.type === "disabled") return { mode: "none" };
    if (t.type === "adaptive" || t.type === "enabled") {
      const budget = Number(t.budget_tokens);
      if (Number.isFinite(budget) && budget > 0)
        return { mode: "budget", budget };
      return { mode: "auto" };
    }
  }

  // OpenAI chat / Responses shape
  const effort =
    body.reasoning_effort ??
    (typeof body.reasoning === "object" ? body.reasoning?.effort : null);
  if (typeof effort === "string" && effort) {
    const e = effort.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  // Gemini shape (top-level, generationConfig, or request envelope)
  const tc =
    body.thinkingConfig ||
    body.generationConfig?.thinkingConfig ||
    body.request?.generationConfig?.thinkingConfig;
  if (tc && typeof tc === "object") {
    if (typeof tc.thinkingLevel === "string")
      return { mode: "level", level: tc.thinkingLevel.toLowerCase() };
    const tb = Number(tc.thinkingBudget);
    if (Number.isFinite(tb)) {
      if (tb === 0) return { mode: "none" };
      if (tb < 0) return { mode: "auto" };
      return { mode: "budget", budget: tb };
    }
  }

  // Qwen shape
  if (body.enable_thinking === false) return { mode: "none" };
  if (body.enable_thinking === true) {
    const tb = Number(body.thinking_budget);
    if (Number.isFinite(tb) && tb > 0) return { mode: "budget", budget: tb };
    return { mode: "auto" };
  }

  return null;
}

// Capture thinking intent from a body. Alias of extractThinking, named for clarity.
export const captureThinking = extractThinking;
