import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,xx" },
            },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() =>
      stripUnsupportedParams(
        "cloudflare-ai",
        "@cf/meta/llama-3.1-8b-instruct",
        body,
      ),
    ).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("drops reasoning-related params for xAI provider", () => {
    const body = {
      model: "grok-build-0.1",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.7,
      reasoning: { effort: "medium" },
      reasoning_effort: "medium",
      thinking: { type: "enabled", budget_tokens: 1024 },
    };

    stripUnsupportedParams("xai", "grok-build-0.1", body);

    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.7); // should be preserved
  });
});
