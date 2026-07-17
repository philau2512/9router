import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();

async function transformOpenAIStream(chunks) {
  const input = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });
  const output = input.pipeThrough(createResponsesApiTransformStream());
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  return text
    .split("\n\n")
    .filter(Boolean)
    .map((event) => {
      const data = event
        .split("\n")
        .find((line) => line.startsWith("data: "));
      const payload = data?.slice(6);
      return payload && payload !== "[DONE]" ? JSON.parse(payload) : null;
    })
    .filter(Boolean);
}

describe("Responses output indexes", () => {
  it("keeps reasoning, message, and each tool call on unique stable indexes", async () => {
    const events = await transformOpenAIStream([
      {
        id: "chatcmpl-indexes",
        choices: [{ index: 0, delta: { reasoning_content: "think" }, finish_reason: null }],
      },
      {
        choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "read-call", function: { name: "Read", arguments: "{}" } },
                { index: 1, id: "glob-call", function: { name: "Glob", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
    const added = events
      .filter((event) => event.type === "response.output_item.added")
      .map((event) => ({ type: event.item.type, outputIndex: event.output_index }));

    expect(added).toEqual([
      { type: "reasoning", outputIndex: 0 },
      { type: "message", outputIndex: 1 },
      { type: "function_call", outputIndex: 2 },
      { type: "function_call", outputIndex: 3 },
    ]);
    expect(new Set(added.map((item) => item.outputIndex)).size).toBe(added.length);

    const toolDone = events.filter(
      (event) =>
        event.type === "response.output_item.done" &&
        event.item?.type === "function_call",
    );
    expect(toolDone.map((event) => event.output_index)).toEqual([2, 3]);
  });
});
