import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { sanitizeFunctionResponseData } from "../../open-sse/translator/helpers/geminiHelper.js";
import "../translator/registerAll.js";

describe("Antigravity & Gemini functionResponse $ref sanitization", () => {
  it("sanitizeFunctionResponseData recursively renames $ref to _ref", () => {
    const rawData = {
      tools: [
        {
          name: "UpdateCurrentStep",
          parameters: {
            properties: {
              completed_subtitle: {
                $ref: "#/properties/current_step",
                description: "summary",
              },
              nested: [
                { $ref: "#/properties/item" },
                "regular_string",
                123,
              ],
            },
          },
        },
      ],
    };

    const sanitized = sanitizeFunctionResponseData(rawData);

    expect(JSON.stringify(sanitized)).not.toContain('"$ref":');
    expect(sanitized.tools[0].parameters.properties.completed_subtitle._ref).toBe(
      "#/properties/current_step",
    );
    expect(sanitized.tools[0].parameters.properties.nested[0]._ref).toBe(
      "#/properties/item",
    );
  });

  it("translateRequest from OpenAI to Gemini sanitizes $ref in tool results", () => {
    const openAIReq = {
      messages: [
        { role: "user", content: "Read tools.json" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "Read", arguments: '{"path":"tools.json"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: JSON.stringify({
            tools: [
              {
                name: "UpdateCurrentStep",
                parameters: {
                  properties: {
                    completed_subtitle: {
                      $ref: "#/properties/current_step",
                    },
                  },
                },
              },
            ],
          }),
        },
      ],
    };

    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-3.7-flash",
      openAIReq,
      true,
      null,
      null,
    );

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('"$ref"');
    expect(serialized).toContain('"_ref"');
  });

  it("AntigravityExecutor.transformRequest cleans $ref from functionResponse parts in contents", () => {
    const executor = new AntigravityExecutor();
    const body = {
      request: {
        contents: [
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_957934",
                  name: "Read",
                  response: {
                    result: {
                      tools: [
                        {
                          properties: {
                            completed_subtitle: {
                              $ref: "#/properties/current_step",
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const transformed = executor.transformRequest(
      "gemini-3.7-flash-medium",
      body,
      { isStream: true, thinkingBudget: 0, requestedModel: "gemini-3.7-flash-medium" },
    );

    const serialized = JSON.stringify(transformed);
    expect(serialized).not.toContain('"$ref"');
    expect(serialized).toContain('"_ref"');
  });
});
