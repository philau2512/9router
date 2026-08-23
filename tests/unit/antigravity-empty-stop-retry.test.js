import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();

function antigravityEmptyStopStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            response: {
              candidates: [
                {
                  content: { role: "model", parts: [{ text: "" }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
}

function antigravityTextStopStream(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            response: {
              candidates: [
                {
                  content: { role: "model", parts: [{ text }] },
                  finishReason: "STOP",
                },
              ],
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
}

function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => {
      connected = false;
    },
    handleError: () => {
      connected = false;
    },
    handleDisconnect: () => {
      connected = false;
    },
    abort: () => {
      connected = false;
    },
  };
}

function makeTransform(tracker) {
  return createSSETransformStreamWithLogger(
    FORMATS.ANTIGRAVITY,
    FORMATS.OPENAI,
    "antigravity",
    null,
    null,
    "gemini-3.7-flash-medium",
    null,
    null,
    null,
    null,
    tracker,
  );
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

describe("Antigravity empty STOP retries", () => {
  it("retries two empty STOP attempts using the same retry callback before emitting successful output", async () => {
    const tracker = {};
    const controller = makeController();
    let retries = 0;
    const response = createDisconnectAwareStream(
      {
        readable: antigravityEmptyStopStream().pipeThrough(makeTransform(tracker)),
        writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
      },
      controller,
      null,
      tracker,
      {
        provider: "antigravity",
        sourceFormat: FORMATS.OPENAI,
        targetFormat: FORMATS.ANTIGRAVITY,
        model: "gemini-3.7-flash-medium",
        retryEmptyAntigravityStop: async () => {
          retries++;
          return {
            body: (retries === 1
              ? antigravityEmptyStopStream()
              : antigravityTextStopStream("recovered answer")),
          };
        },
      },
    );

    const output = await readAll(response);
    expect(retries).toBe(2);
    expect(output).toContain("recovered answer");
    expect(output).not.toContain("empty_provider_response");
  }, 10000);

  it("does not retry when an Antigravity attempt produced visible text", async () => {
    const tracker = {};
    const controller = makeController();
    let retries = 0;
    const response = createDisconnectAwareStream(
      {
        readable: antigravityTextStopStream("already visible").pipeThrough(
          makeTransform(tracker),
        ),
        writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
      },
      controller,
      null,
      tracker,
      {
        provider: "antigravity",
        sourceFormat: FORMATS.OPENAI,
        targetFormat: FORMATS.ANTIGRAVITY,
        model: "gemini-3.7-flash-medium",
        retryEmptyAntigravityStop: async () => {
          retries++;
          return { body: antigravityTextStopStream("must not be used") };
        },
      },
    );

    const output = await readAll(response);
    expect(retries).toBe(0);
    expect(output).toContain("already visible");
  });
});