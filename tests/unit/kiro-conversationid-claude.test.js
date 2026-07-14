/**
 * Phase 1 (Group A) — Deterministic conversationId for the Claude → Kiro route.
 *
 * Before this patch `claude-to-kiro.js` used `uuidv4()` (random per request),
 * so every Claude Code CLI turn opened a fresh upstream Kiro/AWS conversation
 * context and never reused the Builder ID prompt cache — burning free-tier
 * quota. The OpenAI route already derives a deterministic `uuidv5` id.
 *
 * The critical adversarial case (red-team C1): a fresh single-turn request
 * (empty history, no `_preCompressionBody`) with a system prompt + thinking on
 * builds `finalContent` that is prefixed with `[Context: Current time is <ISO>]`
 * — a value that changes every request. The seed MUST come from the RAW user
 * content captured BEFORE that prefix, otherwise the id is non-deterministic
 * exactly in the most common Claude Code CLI scenario.
 */

import { describe, it, expect } from "vitest";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const idOf = (payload) => payload.conversationState.conversationId;

describe("claudeToKiroRequest — deterministic conversationId", () => {
  it("[C1] fresh single-turn with timestamp prefix → same id across two moments", async () => {
    const body = {
      messages: [{ role: "user", content: "Refactor the auth module" }],
      system: "You are a helpful coding assistant.",
      thinking: { type: "enabled", budget: 4000 }, // forces timestamp prefix + thinking prefix
    };

    const first = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});
    // Ensure the wall clock advances so any timestamp leak would change the id.
    await new Promise((r) => setTimeout(r, 5));
    const second = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});

    expect(idOf(first)).toBe(idOf(second));
  });

  it("same first-user-content (with history) → same id", () => {
    const body = {
      messages: [
        { role: "user", content: "Explain the routing engine" },
        { role: "assistant", content: "Sure, it pivots through OpenAI." },
        { role: "user", content: "Now add a provider" },
      ],
    };

    const a = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});
    const b = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});

    expect(idOf(a)).toBe(idOf(b));
  });

  it("different first-user-content → different id", () => {
    const bodyA = { messages: [{ role: "user", content: "Task alpha" }] };
    const bodyB = { messages: [{ role: "user", content: "Task beta" }] };

    const a = claudeToKiroRequest("claude-sonnet-4.5", bodyA, true, {});
    const b = claudeToKiroRequest("claude-sonnet-4.5", bodyB, true, {});

    expect(idOf(a)).not.toBe(idOf(b));
  });

  it("seed ignores timestamp: same user content at different times → same id", async () => {
    const body = {
      messages: [{ role: "user", content: "Deterministic please" }],
      system: "sys",
    };
    const a = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});
    await new Promise((r) => setTimeout(r, 10));
    const b = claudeToKiroRequest("claude-sonnet-4.5", body, true, {});
    expect(idOf(a)).toBe(idOf(b));
  });

  it("produces a valid uuid (not undefined/empty)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const id = idOf(claudeToKiroRequest("claude-sonnet-4.5", body, true, {}));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
