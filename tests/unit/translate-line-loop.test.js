import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Feed pre-encoded byte chunks (so we can split multi-byte UTF-8 across chunks)
// through the Responses->Responses transform and collect decoded output.
async function runChunks(byteChunks, target = FORMATS.OPENAI_RESPONSES, source = FORMATS.OPENAI_RESPONSES) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of byteChunks) controller.enqueue(c);
      controller.close();
    },
  });
  const out = stream.pipeThrough(
    createSSETransformStreamWithLogger(target, source, "codex", null, null, "gpt-5.5"),
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

const enc = new TextEncoder();

describe("Phase 5(a) indexOf line loop — framing + UTF-8 invariance", () => {
  it("preserves event: before its paired data: within one chunk", async () => {
    // A single chunk carrying event/data pairs in order. The indexOf loop must
    // process the event: line before the following data: line so framing holds.
    const input =
      [
        "event: response.created",
        `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", status: "in_progress" } })}`,
        "",
        "event: response.output_text.delta",
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}`,
        "",
        "event: response.completed",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed" } })}`,
        "",
      ].join("\n");

    const out = await runChunks([enc.encode(input)]);
    // Each data: line must be preceded by its event: line (framing intact).
    expect(out).toContain("event: response.created");
    expect(out).toContain("event: response.output_text.delta");
    expect(out).toContain("event: response.completed");
    const createdIdx = out.indexOf("response.created");
    const deltaIdx = out.indexOf("response.output_text.delta");
    const completedIdx = out.indexOf("response.completed");
    // Order preserved across the stream
    expect(createdIdx).toBeLessThan(deltaIdx);
    expect(deltaIdx).toBeLessThan(completedIdx);
    expect(out).toContain("data: [DONE]");
  });

  it("is identical whether a multi-byte char is split across a chunk boundary", async () => {
    // Content contains multi-byte chars (emoji + Vietnamese). Build the full SSE
    // once, then feed it (a) whole and (b) split at a byte offset that lands in
    // the middle of a multi-byte sequence. Output must match.
    const payload = [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "xin chào 🌊 thế giới" })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "r", status: "completed" } })}`,
      "",
    ].join("\n");
    const full = enc.encode(payload);

    const whole = await runChunks([full]);

    // Find a split point inside a multi-byte sequence (a continuation byte 0x80-0xBF).
    let splitAt = Math.floor(full.length / 2);
    while (splitAt < full.length && (full[splitAt] & 0xc0) !== 0x80) splitAt++;
    const a = full.subarray(0, splitAt);
    const b = full.subarray(splitAt);
    const split = await runChunks([a, b]);

    expect(split).toBe(whole);
    expect(whole).toContain("🌊");
    expect(whole).toContain("thế giới");
  });
});
