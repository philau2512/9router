import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("claudeToOpenAIRequest thinking mapping", () => {
  it("should map output_config.effort='high' to OpenAI reasoning_effort and thinking budget", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
      output_config: {
        effort: "high",
      },
    };

    const result = claudeToOpenAIRequest("claude-sonnet", body, true, {});

    expect(result.reasoning_effort).toBe("high");
    expect(result.thinking).toEqual({
      type: "enabled",
      budget_tokens: 24576, // LEVEL_TO_BUDGET.high
    });
  });

  it("should map thinking.type='enabled' and budget_tokens to OpenAI reasoning_effort and thinking budget", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
      thinking: {
        type: "enabled",
        budget_tokens: 8192,
      },
    };

    const result = claudeToOpenAIRequest("claude-sonnet", body, true, {});

    expect(result.thinking).toEqual({
      type: "enabled",
      budget_tokens: 8192,
    });
    expect(result.reasoning_effort).toBe("medium"); // budgetToLevel(8192)
  });

  it("should map output_config.effort='none' to disabled thinking", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
      output_config: {
        effort: "none",
      },
    };

    const result = claudeToOpenAIRequest("claude-sonnet", body, true, {});

    expect(result.reasoning_effort).toBe("none");
    expect(result.thinking).toEqual({
      type: "disabled",
    });
  });

  it("should keep reasoning_effort intact if already present in body", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
      reasoning_effort: "low",
    };

    const result = claudeToOpenAIRequest("claude-sonnet", body, true, {});

    expect(result.reasoning_effort).toBe("low");
  });
});
