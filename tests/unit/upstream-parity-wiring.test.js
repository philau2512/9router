import { describe, it, expect } from "vitest";
import {
  stripThinkingSuffix,
  parseSuffix,
  extractThinking,
  applyThinking,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

describe("thinkingUnified (upstream parity)", () => {
  it("stripThinkingSuffix removes trailing (level)", () => {
    expect(stripThinkingSuffix("claude-sonnet-4(high)")).toBe("claude-sonnet-4");
    expect(stripThinkingSuffix("plain")).toBe("plain");
  });

  it("parseSuffix reads level/budget/none/auto", () => {
    expect(parseSuffix("m(high)")).toEqual({
      cleanModel: "m",
      override: { mode: "level", level: "high" },
    });
    expect(parseSuffix("m(8192)").override).toEqual({
      mode: "budget",
      budget: 8192,
    });
    expect(parseSuffix("m(none)").override).toEqual({ mode: "none" });
  });

  it("extractThinking reads openai reasoning_effort", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({
      mode: "level",
      level: "high",
    });
  });

  it("applyThinking keeps openai effort on body", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    };
    const intent = extractThinking(body);
    applyThinking("openai", "gpt-5", body, null, intent);
    expect(body.reasoning_effort === "high" || body.reasoning?.effort === "high").toBe(
      true,
    );
  });
});

describe("resolveTransport (registry transports)", () => {
  it("deepseek exposes openai + claude transports", () => {
    expect(resolveTransport("deepseek", "claude")?.format).toBe("claude");
    expect(resolveTransport("deepseek", "openai")?.format).toBe("openai");
  });

  it("unknown provider returns null", () => {
    expect(resolveTransport("no-such-provider", "openai")).toBeNull();
  });
});