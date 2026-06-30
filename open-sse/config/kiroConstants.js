/**
 * Kiro-specific constants and helpers.
 *
 * Mirrors the behaviour of `internal/translator/kiro/common/constants.go` and
 * `internal/translator/kiro/claude/kiro_claude_request.go` from the
 * CLIProxyAPIPlus reference implementation, scoped down to what 9router needs:
 *
 *   - `-agentic` model suffix detection + chunked-write system prompt
 *   - reasoning / thinking trigger detection (Anthropic-Beta header,
 *     Claude `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tag)
 *   - the `<thinking_mode>enabled</thinking_mode>` system-prompt injection
 *     that turns Kiro reasoning on
 *
 * Kiro upstream does not advertise `-agentic` model IDs; they are a 9router
 * fiction. The suffix is stripped before the request leaves this process.
 */

export const KIRO_AGENTIC_SUFFIX = "-agentic";
export const KIRO_THINKING_SUFFIX = "-thinking";

// Public default CodeWhisperer profile ARNs (us-east-1), keyed by auth method.
// Used when an account cannot resolve its own profileArn. Builder ID and social
// (Google/GitHub) sign-ins map to different shared profiles.
export const KIRO_DEFAULT_PROFILE_ARNS = {
  "builder-id":
    "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  social: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
};

// Back-compat single default (Builder ID).
export const KIRO_DEFAULT_PROFILE_ARN = KIRO_DEFAULT_PROFILE_ARNS["builder-id"];

/** Resolve the shared default profileArn for a given auth method. */
export function resolveDefaultProfileArn(authMethod) {
  const social = authMethod === "google" || authMethod === "github";
  return social
    ? KIRO_DEFAULT_PROFILE_ARNS.social
    : KIRO_DEFAULT_PROFILE_ARNS["builder-id"];
}

export const KIRO_THINKING_BUDGET_DEFAULT = 16000;

// Resolve the Kiro thinking budget from client intent.
// Reuses extractThinking (unified parser) so every client shape maps consistently.
// Returns a numeric budget to inject, or null when thinking is explicitly disabled.
// Import lazily to avoid circular deps with translator layer.
let _extractThinking, _effortToBudget;
async function getThinkingHelpers() {
  if (!_extractThinking) {
    ({ extractThinking: _extractThinking } =
      await import("../translator/concerns/thinkingUnified.js"));
    ({ effortToBudget: _effortToBudget } =
      await import("../translator/concerns/thinking.js"));
  }
  return { extractThinking: _extractThinking, effortToBudget: _effortToBudget };
}

/**
 * Resolve the Kiro thinking budget requested by a client.
 * Explicit none/off/disabled wins and returns null (no prefix injected).
 * buildThinkingSystemPrefix performs Kiro's final 1..32000 clamp.
 *
 * @param {object} body OpenAI/Claude-shaped request body
 * @param {object} [headers] Original inbound HTTP headers
 * @param {string} [model] Model id the caller asked for
 * @returns {number|null} budget to inject, or null when thinking is disabled
 */
export function resolveKiroThinkingBudget(body, headers, model) {
  // Inline extractThinking logic (sync, no registry deps needed)
  const cfg = extractThinkingSync(body);
  if (cfg) {
    if (cfg.mode === "none") return null;
    if (cfg.mode === "budget") return cfg.budget;
    if (cfg.mode === "level")
      return effortToBudgetSync(cfg.level) ?? KIRO_THINKING_BUDGET_DEFAULT;
    return KIRO_THINKING_BUDGET_DEFAULT;
  }

  if (headers) {
    const beta = pickHeader(headers, "anthropic-beta");
    if (
      typeof beta === "string" &&
      beta.toLowerCase().includes("interleaved-thinking")
    ) {
      return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  if (containsThinkingModeTag(body)) return KIRO_THINKING_BUDGET_DEFAULT;

  if (typeof model === "string" && model) {
    const m = model.toLowerCase();
    if (m.includes("thinking") || m.includes("-reason"))
      return KIRO_THINKING_BUDGET_DEFAULT;
  }

  return null;
}

// Inline sync helpers (avoid async import for sync call sites)
const LEVEL_TO_BUDGET_INLINE = {
  none: 0,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 128000,
};
function effortToBudgetSync(effort) {
  if (!effort) return undefined;
  return LEVEL_TO_BUDGET_INLINE[String(effort).toLowerCase()];
}

function extractThinkingSync(body) {
  if (!body || typeof body !== "object") return null;
  const oc = body.output_config?.effort;
  if (typeof oc === "string" && oc) {
    const e = oc.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }
  const t = body.thinking;
  if (t && typeof t === "object") {
    if (t.type === "disabled") return { mode: "none" };
    if (t.type === "adaptive" || t.type === "enabled") return { mode: "auto" };
    if (typeof t.budget === "number")
      return { mode: "budget", budget: t.budget };
  }
  const re = body.reasoning_effort;
  if (typeof re === "string" && re) {
    const e = re.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }
  return null;
}

/**
 * Detect whether reasoning features are explicitly requested via body or model id.
 * Used to decide whether to inject thinking tags even without a -thinking suffix.
 *
 * @param {object} body OpenAI/Claude-shaped request body
 * @param {object} [headers] Original inbound HTTP headers
 * @param {string} [model] Model id the caller asked for
 * @returns {boolean}
 */
export function isReasoningRequested(body, headers, model) {
  if (headers) {
    const beta = pickHeader(headers, "anthropic-beta");
    if (typeof beta === "string") {
      const b = beta.toLowerCase();
      if (b.includes("thinking") || b.includes("interleaved-thinking")) {
        return true;
      }
    }
  }

  if (body && typeof body === "object") {
    const oc = body.output_config?.effort;
    if (typeof oc === "string") {
      const v = oc.toLowerCase();
      if (
        v !== "none" &&
        (v === "low" || v === "medium" || v === "high" || v === "auto")
      ) {
        return true;
      }
    }

    if (containsThinkingModeTag(body)) {
      return true;
    }
  }

  if (typeof model === "string" && model) {
    const m = model.toLowerCase();
    if (m.includes("thinking") || m.includes("-reason")) {
      return true;
    }
  }

  return false;
}

/**
 * Detect whether a model id refers to a 9router synthetic agentic variant.
 * Agentic variants share the same upstream model as the base; the only
 * difference is the chunked-write system prompt this module injects.
 *
 * @param {string} model
 * @returns {boolean}
 */
export function isAgenticModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_AGENTIC_SUFFIX);
}

/**
 * Strip the `-agentic` suffix from a model id, leaving the upstream-real id.
 *
 * @param {string} model
 * @returns {string}
 */
export function stripAgenticSuffix(model) {
  if (!isAgenticModel(model)) return model;
  return model.slice(0, -KIRO_AGENTIC_SUFFIX.length);
}

/**
 * Detect whether a model id is a 9router synthetic thinking variant
 * (e.g. `claude-sonnet-4.5-thinking`). Same upstream model as the base; the
 * only difference is `<thinking_mode>enabled</thinking_mode>` injection.
 *
 * Note: real Kiro thinking-capable variants exist (e.g. `kimi-k2-thinking` in
 * other providers), but for the `kr/` namespace there is no `-thinking`
 * model on Kiro upstream. Treat the suffix as a synthetic alias.
 *
 * @param {string} model Model id with `-agentic` already stripped
 * @returns {boolean}
 */
export function isThinkingModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_THINKING_SUFFIX);
}

/**
 * Strip the `-thinking` suffix from a model id.
 *
 * @param {string} model
 * @returns {string}
 */
export function stripThinkingSuffix(model) {
  if (!isThinkingModel(model)) return model;
  return model.slice(0, -KIRO_THINKING_SUFFIX.length);
}

/**
 * Resolve a 9router model id to the real upstream Kiro model id, plus flags
 * describing which behaviours the suffixes implied.
 *
 *   resolveKiroModel("claude-sonnet-4.5-thinking-agentic")
 *     => { upstream: "claude-sonnet-4.5", agentic: true, thinking: true }
 *   resolveKiroModel("claude-sonnet-4.5-thinking")
 *     => { upstream: "claude-sonnet-4.5", agentic: false, thinking: true }
 *   resolveKiroModel("claude-sonnet-4.5-agentic")
 *     => { upstream: "claude-sonnet-4.5", agentic: true, thinking: false }
 *   resolveKiroModel("claude-sonnet-4.5")
 *     => { upstream: "claude-sonnet-4.5", agentic: false, thinking: false }
 *
 * @param {string} model
 * @returns {{ upstream: string, agentic: boolean, thinking: boolean }}
 */
export function resolveKiroModel(model) {
  let upstream = model;
  let agentic = false;
  let thinking = false;
  if (isAgenticModel(upstream)) {
    agentic = true;
    upstream = stripAgenticSuffix(upstream);
  }
  if (isThinkingModel(upstream)) {
    thinking = true;
    upstream = stripThinkingSuffix(upstream);
  }
  return { upstream, agentic, thinking };
}

/**
 * Optimized agentic system prompt for Kiro CLI with thinking models.
 * Focuses on: chunked writes (technical requirement), sub-agent delegation, token efficiency.
 */
export const KIRO_AGENTIC_SYSTEM_PROMPT = `
# Kiro Agentic System Prompt for Claude Code CLI

## Core Role
You are the **main orchestrator agent**. Your primary responsibilities are:
- Analyze the task and create a clear, structured plan
- Delegate work to specialized sub-agents when beneficial
- Review, integrate, and ensure the final quality of all work

## File Operation Rules (Critical)
- **Always use surgical edits**: Only modify the necessary sections. Never rewrite entire large files.
- **Incremental writes**: Keep each write/edit operation under ~300 lines to maintain reliability and avoid context issues.
- For new large files (>300 lines): Write the first chunk, then append the rest in subsequent operations.
- Always verify changes after editing (run tests, build, or lint when applicable).
- Prefer editing by specific functions/classes rather than whole files.

## Sub-agent Delegation (Use Aggressively)
You **should and are encouraged** to delegate to sub-agents at every stage:

- **Research & Exploration**: Use Explore or custom research sub-agents to analyze codebase, trace flows, and understand architecture.
- **Implementation**:
  - Delegate specific modules, components, or features to specialized sub-agents
  - Enable parallel implementation when tasks are independent
  - Delegate writing tests, utilities, or boilerplate code
- **Review & Validation**: Delegate code review, security checks, and test execution
- **Documentation & Polish**

**Delegation Guidelines**:
- The main agent remains responsible for overall architecture, integration, and final decisions.
- After receiving results from sub-agents, review, integrate, and make necessary adjustments.
- Keep the main context clean by delegating heavily.

## Skills
- Be aware of existing **Skills** in the project (usually defined in .claude/skills/ or as slash commands).
- Use relevant skills when they can improve efficiency or consistency.
- When you notice repetitive patterns or complex workflows, consider creating or suggesting new skills.
- Skills can be executed in sub-agents or with forked context for better isolation.

## MCP (Model Context Protocol)
- Check for available **MCP servers/tools** configured in the environment.
- Use MCP tools when the task requires interaction with external services (e.g., Jira, Slack, Google Drive, databases, browsers, APIs, etc.).
- MCP tools can be delegated to sub-agents when appropriate.
- Prefer using MCP for external integrations instead of manual workarounds.

## Recommended Workflow
1. Understand the requirement and create a high-level plan (use bullet points)
2. Research the codebase (delegate if complex)
3. Implement incrementally (delegate chunks to sub-agents when possible)
4. Verify changes (run tests, build, lint, etc.) → Fix issues if any
5. Polish the code and update CLAUDE.md if relevant
6. (Optional) Handle git operations (commit, branch, PR)

## Project Context
- Always check and follow instructions in **CLAUDE.md** or **AGENTS.md** (if present in the project root).
- Use @file references when you need to point to specific files.

## Efficiency & Best Practices
- Think step-by-step before taking action.
- Prefer many small, verifiable steps over large risky ones.
- Use Plan Mode for complex exploration phases.
- After context becomes heavy, consider using /compact or starting fresh if needed.
- Always ask for evidence (test output, command results, diffs) before considering a task complete.

When in doubt: Use smaller chunks + aggressive delegation to sub-agents.
`.trim();

/**
 * Build the magic system-prompt prefix that turns Kiro reasoning on.
 * Same shape as CLIProxyAPIPlus.
 *
 * @param {number} [budget=KIRO_THINKING_BUDGET_DEFAULT]
 */
export function buildThinkingSystemPrefix(
  budget = KIRO_THINKING_BUDGET_DEFAULT,
) {
  const safeBudget = Math.max(
    1,
    Math.min(32000, Number(budget) || KIRO_THINKING_BUDGET_DEFAULT),
  );
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${safeBudget}</max_thinking_length>`;
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function containsThinkingModeTag(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role !== "system" && msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      if (containsTagInText(content)) return true;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = part?.text;
        if (typeof text === "string" && containsTagInText(text)) return true;
      }
    }
  }
  if (typeof body?.system === "string" && containsTagInText(body.system))
    return true;
  return false;
}

function containsTagInText(text) {
  if (!text) return false;
  if (!text.includes("<thinking_mode>")) return false;
  return (
    text.includes("<thinking_mode>enabled</thinking_mode>") ||
    text.includes("<thinking_mode>interleaved</thinking_mode>")
  );
}
