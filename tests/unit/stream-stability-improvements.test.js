import { describe, expect, it, vi } from "vitest";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

vi.mock("../../open-sse/utils/debugLog.js", () => ({
  dbg: vi.fn(),
  isDebugEnabled: false,
}));

describe("Stream Stability and Fault Tolerance Improvements", () => {
  it("uses dynamic semantic stall timeout of 180s for reasoning models", async () => {
    const timing = {};
    const providerResponse = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
          controller.close();
        },
      }),
    };

    const passthroughTransform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });

    const stream = pipeWithDisconnect(
      providerResponse,
      passthroughTransform,
      {
        signal: undefined,
        startTime: Date.now(),
        isConnected: () => true,
        handleComplete: vi.fn(),
        handleError: vi.fn(),
        handleDisconnect: vi.fn(),
        abort: vi.fn(),
      },
      null,
      null,
      timing,
      60000,
      "deepseek-reasoning", // reasoning model
      "deepseek",
    );

    const reader = stream.getReader();
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    await reader.read(); // EOF
  });

  it("buffers fragmented JSON strings in kiroToClaudeResponse", () => {
    const state = { parseBuffer: "" };

    // First chunk: incomplete JSON string
    const firstChunk =
      'data: {"id": "chatcmpl-123", "choices": [{"delta": {"con';
    const result1 = kiroToClaudeResponse(firstChunk, state);
    expect(result1).toBeNull();
    expect(state.parseBuffer).toBe(firstChunk);

    // Second chunk: completes the JSON string
    const secondChunk = 'tent": "hello"}}]}';
    const result2 = kiroToClaudeResponse(secondChunk, state);
    expect(result2).not.toBeNull();
    expect(result2).toHaveLength(3);
    expect(result2[0].type).toBe("message_start");
    expect(result2[1].type).toBe("content_block_start");
    expect(result2[2].type).toBe("content_block_delta");
    expect(result2[2].delta.text).toBe("hello");
    expect(state.parseBuffer).toBe(""); // Cleared on success
  });
});
