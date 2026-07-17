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
  offset += payloadBytes.length;
  view.setUint32(offset, 0, false);

  return buffer;
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

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.enqueue(fStop);
        controller.close();
      },
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(
      mockResponse,
      "claude-test",
    );

    const output = await readAllSSE(transformedResponse.body);

    // <thinking> tags must be stripped
    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("</thinking>");

    const dataLines = output
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
    const chunks = dataLines.map((line) => JSON.parse(line.slice(6)));

    // Thinking text must appear as reasoning_content
    const reasoningText = chunks
      .filter((c) => c.choices[0].delta.reasoning_content)
      .map((c) => c.choices[0].delta.reasoning_content)
      .join("");
    expect(reasoningText).toContain("Let me think...");
    expect(reasoningText).toContain("still thinking...");

    // Regular content must NOT contain thinking text
    const regularText = chunks
      .filter((c) => c.choices[0].delta.content)
      .map((c) => c.choices[0].delta.content)
      .join("");
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

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f0);
        controller.enqueue(f1);
        controller.enqueue(fStop);
        controller.close();
      },
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(
      mockResponse,
      "claude-test",
    );

    const output = await readAllSSE(transformedResponse.body);

    const dataLines = output
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
    const objects = dataLines.map((line) => JSON.parse(line.slice(6)));

    // reasoning_content chunks must be present (from reasoningContentEvent + stripped thinking tag)
    const reasoningChunks = objects.filter(
      (obj) => obj.choices[0].delta.reasoning_content,
    );
    expect(reasoningChunks.length).toBeGreaterThan(0);

    // No empty content chunks
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

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(fStop);
        controller.close();
      },
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(
      mockResponse,
      "claude-sonnet-4-5",
    );

    const output = await readAllSSE(transformedResponse.body);
    const dataLines = output
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
    const chunks = dataLines.map((line) => JSON.parse(line.slice(6)));

    // Thinking text emitted as reasoning_content
    const reasoningText = chunks
      .filter((c) => c.choices[0].delta.reasoning_content)
      .map((c) => c.choices[0].delta.reasoning_content)
      .join("");
    expect(reasoningText).toContain("Reasoning here...");

    // Regular content preserved
    const regularText = chunks
      .filter((c) => c.choices[0].delta.content)
      .map((c) => c.choices[0].delta.content)
      .join("");
    expect(regularText).toBe("Answer here.");

    // Tags stripped
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

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.enqueue(f3);
        controller.enqueue(fStop);
        controller.close();
      },
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(
      mockResponse,
      "claude-opus-4-5-agentic",
    );

    const output = await readAllSSE(transformedResponse.body);
    const dataLines = output
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
    const chunks = dataLines.map((line) => JSON.parse(line.slice(6)));

    // All thinking parts routed to reasoning_content
    const reasoningText = chunks
      .filter((c) => c.choices[0].delta.reasoning_content)
      .map((c) => c.choices[0].delta.reasoning_content)
      .join("");
    expect(reasoningText).toContain("Part 1 of thinking...");
    expect(reasoningText).toContain("Part 2 of thinking...");
    expect(reasoningText).toContain("Part 3 of thinking.");

    // Only final answer in regular content
    const regularText = chunks
      .filter((c) => c.choices[0].delta.content)
      .map((c) => c.choices[0].delta.content)
      .join("");
    expect(regularText).toBe("Final answer.");

    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("</thinking>");
  });

  it("emits a terminal chunk at messageStop before the upstream stream closes", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("messageStopEvent", {});

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const reader = transformedResponse.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    for (let i = 0; i < 4 && !output.includes("\"finish_reason\":\"stop\""); i++) {
      const { value } = await readNextWithTimeout(reader);
      output += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    expect(output).toContain("\"finish_reason\":\"stop\"");
  });

  it("uses tool_calls finish reason for tool streams without messageStop", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("toolUseEvent", { toolUseId: "tool-1", name: "read_file", input: { path: "a.txt" } });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.at(-1);
    expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
  });
});
