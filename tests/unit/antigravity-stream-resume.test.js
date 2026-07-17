import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { reconstructBodyForResume } from "../../open-sse/utils/streamResumer.js";

const encoder = new TextEncoder();

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function createAntigravitySSEStream(candidates, trailingNewline = true) {
  return new ReadableStream({
    start(controller) {
      for (const candidate of candidates) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ response: { candidates: [candidate] } })}${trailingNewline ? "\n\n" : ""}`,
          ),
        );
      }
      controller.close();
    },
  });
}

function createAntigravityTransform(tracker, sourceFormat = FORMATS.OPENAI) {
  return createSSETransformStreamWithLogger(
    FORMATS.ANTIGRAVITY,
    sourceFormat,
    "antigravity",
    null,
    null,
    "gemini-3-flash-agent",
    null,
    null,
    null,
    null,
    tracker,
  );
}

describe("Antigravity stream resume", () => {
  it("tracks confirmed Antigravity visible content after a thought", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    const output = await readStream(
      createAntigravitySSEStream([
        {
          content: {
            parts: [
              { thought: true, text: "private reasoning" },
              { text: "visible answer" },
            ],
          },
          finishReason: "STOP",
        },
      ]).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(output).toContain("visible answer");
    expect(tracker.accumulatedThinking).toBe("private reasoning");
    expect(tracker.accumulatedContent).toBe("visible answer");
  });

  it("tracks confirmed text from a terminal event without trailing newline", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    const output = await readStream(
      createAntigravitySSEStream(
        [
          {
            content: {
              parts: [
                { thought: true, text: "private reasoning" },
                { text: "visible answer" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        false,
      ).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(output).toContain("visible answer");
    expect(tracker.accumulatedContent).toBe("visible answer");
  });

  it("tracks confirmed Antigravity text for Responses clients", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    const output = await readStream(
      createAntigravitySSEStream([
        {
          content: {
            parts: [
              { thought: true, text: "private reasoning" },
              { text: "visible answer" },
            ],
          },
          finishReason: "STOP",
        },
      ]).pipeThrough(
        createAntigravityTransform(tracker, FORMATS.OPENAI_RESPONSES),
      ),
    );

    expect(output).toContain("response.output_text.delta");
    expect(output).toContain("visible answer");
    expect(tracker.accumulatedContent).toBe("visible answer");
  });

  it("tracks confirmed Antigravity text for Claude clients", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    const output = await readStream(
      createAntigravitySSEStream([
        {
          content: {
            parts: [
              { thought: true, text: "private reasoning" },
              { text: "visible answer" },
            ],
          },
          finishReason: "STOP",
        },
      ]).pipeThrough(createAntigravityTransform(tracker, FORMATS.CLAUDE)),
    );

    expect(output).toContain("visible answer");
    expect(tracker.accumulatedContent).toBe("visible answer");
  });

  it("keeps resume thought state after visible Antigravity content", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    await readStream(
      createAntigravitySSEStream([
        { content: { parts: [{ text: "visible introduction" }] } },
        { content: { parts: [{ thought: true, text: "private reasoning" }] } },
      ]).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(tracker.accumulatedContent).toBe("visible introduction");
    expect(tracker.accumulatedThinking).toBe("private reasoning");

    const resumedOutput = await readStream(
      createAntigravitySSEStream([
        {
          content: { parts: [{ text: "resumed private continuation" }] },
          finishReason: "MAX_TOKENS",
        },
      ]).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(resumedOutput).not.toContain("resumed private continuation");
    expect(resumedOutput).toContain('"finish_reason":"max_tokens"');
  });

  it("keeps an interrupted thought continuation out of resume prefill", async () => {
    const tracker = {
      accumulatedContent: "",
      accumulatedThinking: "",
      totalContentLength: 0,
    };
    const interruptedOutput = await readStream(
      createAntigravitySSEStream([
        { content: { parts: [{ thought: true, text: "private reasoning" }] } },
        { content: { parts: [{ text: "unmarked private continuation" }] } },
      ]).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(interruptedOutput).toContain("private reasoning");
    expect(interruptedOutput).not.toContain("unmarked private continuation");
    expect(tracker.accumulatedThinking).toBe("private reasoning");
    expect(tracker.accumulatedContent).toBe("");

    const resumedBody = reconstructBodyForResume(
      { messages: [{ role: "user", content: "continue" }] },
      tracker,
      "antigravity",
      "gemini-3-flash-agent",
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      null,
      null,
      "other",
    );
    expect(JSON.stringify(resumedBody)).not.toContain(
      "unmarked private continuation",
    );

    const resumedOutput = await readStream(
      createAntigravitySSEStream([
        {
          content: { parts: [{ text: "resumed private continuation" }] },
          finishReason: "MAX_TOKENS",
        },
      ]).pipeThrough(createAntigravityTransform(tracker)),
    );

    expect(resumedOutput).not.toContain("resumed private continuation");
    expect(resumedOutput).toContain('"finish_reason":"max_tokens"');
  });
});
