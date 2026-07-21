/**
 * DefaultExecutor must request usage on OpenAI-compatible chat streams so
 * cache_read / prompt_tokens_details are available (xAI Grok, etc.).
 *
 * Without stream_options.include_usage, providers omit usage on SSE finish
 * chunks → local estimateUsage → log shows (estimated) with no cache_read.
 */
import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

function chatBody(overrides = {}) {
  return {
    model: "grok-4.5",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 128,
    ...overrides,
  };
}

describe("DefaultExecutor stream_options.include_usage", () => {
  it("injects include_usage for xai streaming chat completions", () => {
    const executor = new DefaultExecutor("xai");
    const out = executor.transformRequest(
      "grok-4.5",
      chatBody(),
      true,
      null,
    );
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("injects include_usage for other OpenAI-compatible DefaultExecutor providers", () => {
    const executor = new DefaultExecutor("openrouter");
    const out = executor.transformRequest(
      "openai/gpt-4o",
      chatBody({ model: "openai/gpt-4o" }),
      true,
    );
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("does not overwrite an existing stream_options object", () => {
    const executor = new DefaultExecutor("xai");
    const out = executor.transformRequest(
      "grok-4.5",
      chatBody({ stream_options: { include_usage: false } }),
      true,
    );
    expect(out.stream_options).toEqual({ include_usage: false });
  });

  it("does not inject when stream=false", () => {
    const executor = new DefaultExecutor("xai");
    const out = executor.transformRequest(
      "grok-4.5",
      chatBody({ stream: false }),
      false,
    );
    expect(out.stream_options).toBeUndefined();
  });

  it("does not inject without messages (non chat-completions body)", () => {
    const executor = new DefaultExecutor("xai");
    const out = executor.transformRequest(
      "grok-4.5",
      { model: "grok-4.5", stream: true, input: [] },
      true,
    );
    expect(out.stream_options).toBeUndefined();
  });

  it("does not inject for Anthropic-style DefaultExecutor providers", () => {
    for (const provider of [
      "claude",
      "glm",
      "kimi",
      "minimax",
      "minimax-cn",
      "kimi-coding",
    ]) {
      const executor = new DefaultExecutor(provider);
      const out = executor.transformRequest(
        "model",
        chatBody({ model: "model" }),
        true,
      );
      expect(out.stream_options, provider).toBeUndefined();
    }
  });

  it("does not inject for anthropic-compatible custom providers", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const out = executor.transformRequest(
      "claude-sonnet-4",
      chatBody({ model: "claude-sonnet-4" }),
      true,
    );
    expect(out.stream_options).toBeUndefined();
  });

  it("does not inject for openai-compatible Responses endpoints", () => {
    const executor = new DefaultExecutor("openai-compatible-responses");
    const out = executor.transformRequest(
      "gpt-4o",
      chatBody({ model: "gpt-4o" }),
      true,
    );
    expect(out.stream_options).toBeUndefined();
  });

  it("still strips xai reasoning params while injecting usage", () => {
    const executor = new DefaultExecutor("xai");
    const out = executor.transformRequest(
      "grok-4.5",
      chatBody({
        reasoning: { effort: "high" },
        reasoning_effort: "high",
        thinking: { type: "enabled" },
      }),
      true,
    );
    expect(out.reasoning).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(out.stream_options).toEqual({ include_usage: true });
  });
});