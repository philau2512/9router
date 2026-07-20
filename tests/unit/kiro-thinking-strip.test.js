import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import "../translator/registerAll.js";

function createMockFrame(eventType, payloadObj) {
  const payloadStr = JSON.stringify(payloadObj);
  const payloadBytes = new TextEncoder().encode(payloadStr);

  const headerName = ":event-type";
  const headerNameBytes = new TextEncoder().encode(headerName);
  const headerValueBytes = new TextEncoder().encode(eventType);

  const headerLength =
    1 + headerNameBytes.length + 1 + 2 + headerValueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, 0, false);

  let offset = 12;
  buffer[offset++] = headerNameBytes.length;
  buffer.set(headerNameBytes, offset);
  offset += headerNameBytes.length;
  buffer[offset++] = 7;
  view.setUint16(offset, headerValueBytes.length, false);
  offset += 2;
  buffer.set(headerValueBytes, offset);
  offset += headerValueBytes.length;

  buffer.set(payloadBytes, offset);

  view.setUint32(8, crc32(buffer.subarray(0, 8)), false);
  view.setUint32(totalLength - 4, crc32(buffer.subarray(0, totalLength - 4)), false);
  return buffer;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readAllSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

async function readNextWithTimeout(reader) {
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE chunk")), 100)),
  ]);
}

function parseChunks(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
}

function joinDelta(chunks, key) {
  return chunks
    .filter((c) => c.choices[0].delta[key])
    .map((c) => c.choices[0].delta[key])
    .join("");
}

describe("KiroExecutor thinking tag stripping", () => {
  it("strips <thinking> tags and re-emits as reasoning_content", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", {
      content: "Here is my answer. <thinking>Let me think...",
    });
    const f2 = createMockFrame("assistantResponseEvent", {
      content: "still thinking...</thinking> Yes, 42.",
    });
    const fStop = createMockFrame("messageStopEvent", {});

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f1);
            controller.enqueue(f2);
            controller.enqueue(fStop);
            controller.close();
          },
        }),
      },
      "claude-test",
    );

    const output = await readAllSSE(transformedResponse.body);
    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("</thinking>");

    const chunks = parseChunks(output);
    expect(joinDelta(chunks, "reasoning_content")).toBe(
      "Let me think...still thinking...",
    );
    const regularText = joinDelta(chunks, "content");
    expect(regularText).not.toContain("Let me think...");
    expect(regularText).not.toContain("still thinking...");
    expect(regularText).toBe("Here is my answer.  Yes, 42.");
  });

  it("handles empty content after stripping when hasReasoningContent is true", async () => {
    const executor = new KiroExecutor();

    const f0 = createMockFrame("reasoningContentEvent", {
      text: "I am reasoning",
    });
    const f1 = createMockFrame("assistantResponseEvent", {
      content: "<thinking>purely thinking...</thinking>",
    });
    const fStop = createMockFrame("messageStopEvent", {});

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f0);
            controller.enqueue(f1);
            controller.enqueue(fStop);
            controller.close();
          },
        }),
      },
      "claude-test",
    );

    const objects = parseChunks(await readAllSSE(transformedResponse.body));
    const reasoningText = joinDelta(objects, "reasoning_content");
    expect(reasoningText).toContain("I am reasoning");
    expect(reasoningText).toContain("purely thinking...");

    const emptyContentChunks = objects.filter(
      (obj) =>
        obj.choices[0].delta.content !== undefined &&
        obj.choices[0].delta.content === "",
    );
    expect(emptyContentChunks.length).toBe(0);
  });

  it("strips thinking from claude-sonnet model", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", {
      content: "<thinking>Reasoning here...</thinking>Answer here.",
    });
    const fStop = createMockFrame("messageStopEvent", {});

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f1);
            controller.enqueue(fStop);
            controller.close();
          },
        }),
      },
      "claude-sonnet-4-5",
    );

    const output = await readAllSSE(transformedResponse.body);
    const chunks = parseChunks(output);
    expect(joinDelta(chunks, "reasoning_content")).toBe("Reasoning here...");
    expect(joinDelta(chunks, "content")).toBe("Answer here.");
    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("</thinking>");
  });

  it("handles multi-chunk thinking block spanning several frames", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", {
      content: "<thinking>Part 1 of thinking...",
    });
    const f2 = createMockFrame("assistantResponseEvent", {
      content: "Part 2 of thinking...",
    });
    const f3 = createMockFrame("assistantResponseEvent", {
      content: "Part 3 of thinking.</thinking>Final answer.",
    });
    const fStop = createMockFrame("messageStopEvent", {});

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f1);
            controller.enqueue(f2);
            controller.enqueue(f3);
            controller.enqueue(fStop);
            controller.close();
          },
        }),
      },
      "claude-opus-4-5-agentic",
    );

    const output = await readAllSSE(transformedResponse.body);
    const chunks = parseChunks(output);
    expect(joinDelta(chunks, "reasoning_content")).toBe(
      "Part 1 of thinking...Part 2 of thinking...Part 3 of thinking.",
    );
    expect(joinDelta(chunks, "content")).toBe("Final answer.");
    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("</thinking>");
  });

  // LIVE EVIDENCE 2026-07-20: open tag split as "<thinking" then ">…".
  it("maps split <thinking> open-tag across frames to reasoning_content (live Kiro shape)", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", {
      content: "<thinking",
    });
    const f2 = createMockFrame("assistantResponseEvent", {
      content: ">\nsecret thought body",
    });
    const f3 = createMockFrame("assistantResponseEvent", {
      content: " more.</thinking>\nFinal answer 3",
    });
    const fStop = createMockFrame("messageStopEvent", {});

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f1);
            controller.enqueue(f2);
            controller.enqueue(f3);
            controller.enqueue(fStop);
            controller.close();
          },
        }),
      },
      "claude-sonnet-4.5-thinking",
    );

    const output = await readAllSSE(transformedResponse.body);
    const chunks = parseChunks(output);
    const reasoningText = joinDelta(chunks, "reasoning_content");
    const regularText = joinDelta(chunks, "content");

    expect(reasoningText).toContain("secret thought body");
    expect(regularText).toBe("Final answer 3");
    expect(regularText).not.toContain("<thinking");
    expect(regularText).not.toContain("</thinking>");
    expect(output).not.toContain("<thinking");
  });

  it("waits for clean EOF before emitting stop after messageStop", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("messageStopEvent", {});

    let upstreamController;
    const readableStream = new ReadableStream({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(f1);
        controller.enqueue(f2);
      },
    });

    const transformedResponse = executor.transformEventStreamToSSE(
      { body: readableStream },
      "claude-test",
    );
    const reader = transformedResponse.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const { value } = await readNextWithTimeout(reader);
    output += decoder.decode(value, { stream: true });
    expect(output).not.toContain('"finish_reason":"stop"');

    upstreamController.close();
    while (!output.includes('"finish_reason":"stop"')) {
      const { value: nextValue, done } = await readNextWithTimeout(reader);
      if (done) break;
      output += decoder.decode(nextValue, { stream: true });
    }

    expect(output).toContain('"finish_reason":"stop"');
  });

  it("uses tool_calls finish reason for tool streams without messageStop", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("toolUseEvent", {
      toolUseId: "tool-1",
      name: "read_file",
      input: { path: "a.txt" },
    });

    const transformedResponse = executor.transformEventStreamToSSE(
      {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(f1);
            controller.close();
          },
        }),
      },
      "claude-test",
    );
    const objects = parseChunks(await readAllSSE(transformedResponse.body));
    const finalChunk = objects.at(-1);
    expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
  });
});