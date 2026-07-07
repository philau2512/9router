import { describe, expect, it } from "vitest";

import { estimateAnthropicInputTokens } from "../../src/app/api/v1/messages/count_tokens/route.js";

describe("estimateAnthropicInputTokens", () => {
  it("counts nested structured Anthropic blocks", () => {
    const inputTokens = estimateAnthropicInputTokens({
      system: [{ type: "text", text: "sys" }],
      tools: [
        {
          name: "search",
          description: "lookup",
          input_schema: {
            type: "object",
            properties: { q: { type: "string" } },
          },
        },
      ],
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "think" },
            {
              type: "tool_use",
              name: "search",
              input: { q: "abc", limit: 3, exact: true },
            },
            {
              type: "tool_result",
              content: [{ type: "text", text: "result" }],
            },
          ],
        },
      ],
    });

    expect(inputTokens).toBeGreaterThan(0);
  });
});
