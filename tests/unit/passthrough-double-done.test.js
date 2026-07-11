import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// Drive the passthrough transform with a raw SSE string and collect output.
async function runPassthrough(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const out = stream.pipeThrough(
    createPassthroughStreamWithLogger("kiro", null, "claude-sonnet-4"),
  );
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function countDone(sse) {
  return sse.split("\n").filter((l) => l.trim() === "data: [DONE]").length;
}

describe("Passthrough [DONE] handling (Phase 3 double-DONE fix)", () => {
  it("emits exactly one [DONE] when upstream already sent [DONE]", async () => {
    // Mimics Kiro's own transform output: content deltas then its own [DONE].
    const input = [
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " there" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const out = await runPassthrough(input);
    expect(countDone(out), out).toBe(1);
    // content still forwarded
    expect(out).toContain("Hi");
    expect(out).toContain(" there");
  });

  it("still emits one [DONE] when upstream never sent one (flush supplies it)", async () => {
    const input = [
      `data: ${JSON.stringify({ id: "chatcmpl-2", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "solo" }, finish_reason: null }] })}`,
      "",
    ].join("\n");

    const out = await runPassthrough(input);
    expect(countDone(out), out).toBe(1);
    expect(out).toContain("solo");
  });
});
