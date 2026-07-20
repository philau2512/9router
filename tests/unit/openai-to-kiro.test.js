/**
 * Request contracts for OpenAI → Kiro translation.
 * The cases cover the boundaries that would otherwise cause Kiro validation
 * errors or lose multi-turn state.
 */
import { describe, expect, it } from "vitest";
import { buildKiroPayload } from "../../open-sse/translator/request/openai-to-kiro.js";

const currentInput = (payload) =>
  payload.conversationState.currentMessage.userInputMessage;
const contentOf = (payload) => currentInput(payload).content;
const systemPromptOf = (payload) => payload.systemPrompt || "";

describe("OpenAI to Kiro request translation", () => {
  it("converts text and base64 images into a current Kiro message", () => {
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const payload = buildKiroPayload(
      "claude-sonnet-4.6",
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${image}` },
              },
            ],
          },
        ],
      },
      true,
      {},
    );

    expect(contentOf(payload)).toContain("Describe this image");
    expect(currentInput(payload).modelId).toBe("claude-sonnet-4.6");
    expect(currentInput(payload).images).toEqual([
      { format: "png", source: { bytes: image } },
    ]);
  });

  it("renders unsupported remote images as text instead of sending invalid image data", () => {
    const payload = buildKiroPayload(
      "claude-sonnet-4.6",
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/photo.jpg" },
              },
            ],
          },
        ],
      },
      true,
      {},
    );

    expect(currentInput(payload).images).toBeUndefined();
    expect(contentOf(payload)).toContain("[Image: https://example.com/photo.jpg]");
  });

  describe("tool history", () => {
    it("flattens tool calls and results when the client supplied no tools", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "user", content: "Read the file" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"a.txt"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_1", content: "file contents" },
            { role: "user", content: "Summarize it" },
          ],
        },
        true,
        {},
      );
      const serialized = JSON.stringify(payload.conversationState);

      expect(serialized).not.toContain("toolUses");
      expect(serialized).not.toContain("toolResults");
      expect(serialized).toContain("[Tool call: read_file(");
      expect(serialized).toContain("[Tool result: file contents]");
    });

    it("preserves structured tool history when the client supplied tools", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "user", content: "Read the file" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"a.txt"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_1", content: "file contents" },
            { role: "user", content: "Summarize it" },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "read_file",
                description: "Read a file",
                parameters: { type: "object", properties: {}, required: [] },
              },
            },
          ],
        },
        true,
        {},
      );
      const serialized = JSON.stringify(payload.conversationState);

      expect(
        currentInput(payload).userInputMessageContext?.tools?.[0]
          ?.toolSpecification?.name,
      ).toBe("read_file");
      expect(serialized).toContain("toolUses");
      expect(serialized).not.toContain("[Tool call:");
    });

    it("salvages orphaned tool result content instead of emitting a dangling reference", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "user", content: "Start" },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "orphan_call",
                  content: "important orphaned output",
                },
              ],
            },
            { role: "user", content: "Continue" },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "some_tool",
                description: "x",
                parameters: { type: "object", properties: {}, required: [] },
              },
            },
          ],
        },
        true,
        {},
      );
      const serialized = JSON.stringify(payload.conversationState);

      expect(serialized).not.toContain("orphan_call");
      expect(serialized).toContain("[Tool result: important orphaned output]");
    });
  });

  describe("thinking", () => {
    it("uses Claude native fields for legacy OpenAI reasoning effort", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        {
          reasoning_effort: "low",
          messages: [{ role: "user", content: "Think lightly" }],
        },
        true,
        {},
      );

      expect(contentOf(payload)).toContain(
        "<max_thinking_length>1024</max_thinking_length>",
      );
      expect(payload.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "low" },
      });
    });

    it.each([
      ["high", "gpt-5.6-sol", "high"],
      ["xhigh", "gpt-5.6-terra", "xhigh"],
      ["max", "gpt-5.6-sol", "xhigh"],
    ])("maps GPT effort %s to native wire effort %s", (effort, model, wireEffort) => {
      const payload = buildKiroPayload(
        model,
        {
          reasoning: { effort },
          messages: [{ role: "user", content: "Think" }],
        },
        true,
        {},
      );

      expect(payload.additionalModelRequestFields).toEqual({
        reasoning: { effort: wireEffort },
      });
      expect(systemPromptOf(payload)).not.toContain("<thinking_mode>");
      expect(systemPromptOf(payload)).not.toContain("<max_thinking_length>");
    });

    it("does not enable thinking when effort is explicitly none", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        {
          reasoning_effort: "none",
          messages: [{ role: "user", content: "Do not think" }],
        },
        true,
        {},
      );

      expect(systemPromptOf(payload)).not.toContain(
        "<thinking_mode>enabled</thinking_mode>",
      );
      expect(systemPromptOf(payload)).not.toContain("<max_thinking_length>");
      expect(payload.additionalModelRequestFields).toBeUndefined();
    });
  });

  describe("profile ARN", () => {
    it("omits the ARN when the executor must discover it", () => {
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        { providerSpecificData: { profileArn: null, authMethod: "builder-id" } },
      );

      expect(payload.profileArn || "").toBe("");
    });

    it.each([
      ["builder-id", "111122223333", "OWNBUILDERID"],
      ["imported", "222233334444", "OWNIMPORTED"],
      ["api_key", "444455556666", "OWNACCOUNT"],
    ])("uses the stored ARN for %s", (authMethod, account, profile) => {
      const profileArn = `arn:aws:codewhisperer:us-east-1:${account}:profile/${profile}`;
      const payload = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        { providerSpecificData: { profileArn, authMethod } },
      );

      expect(payload.profileArn).toBe(profileArn);
    });
  });

  it("keeps deterministic conversation IDs independent from request timestamps", () => {
    const first = buildKiroPayload(
      "claude-sonnet-4.6",
      { messages: [{ role: "user", content: "first turn" }] },
      true,
      {},
    );
    const second = buildKiroPayload(
      "claude-sonnet-4.6",
      { messages: [{ role: "user", content: "first turn" }] },
      true,
      {},
    );

    expect(second.conversationState.conversationId).toBe(
      first.conversationState.conversationId,
    );
  });
});