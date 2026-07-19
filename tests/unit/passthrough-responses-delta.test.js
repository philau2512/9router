import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

/** Drive passthrough with raw SSE and collect output text. */
async function runPassthrough(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const out = stream.pipeThrough(
    createPassthroughStreamWithLogger("grok", null, "grok-4.5-build"),
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

describe("Passthrough OpenAI Responses API deltas", () => {
  it("forwards response.output_text.delta data lines (not only the word usage)", async () => {
    // Reproduces openai-responses same-format passthrough: event+data pairs.
    // Chat-completions empty-delta skip used to drop these because they have
    // neither "content": nor "reasoning_content": — only the accidental token
    // "usage" survived via the needsFullParse '"usage"' heuristic.
    const deltas = ["#", " Phân", " tích", " usage", " full"];
    const frames = [];
    for (let i = 0; i < deltas.length; i++) {
      frames.push(`event: response.output_text.delta`);
      frames.push(
        `data: ${JSON.stringify({
          sequence_number: 50 + i,
          type: "response.output_text.delta",
          content_index: 0,
          delta: deltas[i],
          item_id: "msg_test",
          output_index: 1,
          logprobs: [],
        })}`,
      );
      frames.push("");
    }

    const out = await runPassthrough(frames.join("\n"));

    for (const token of deltas) {
      expect(out, `missing token ${JSON.stringify(token)}`).toContain(
        JSON.stringify(token).slice(1, -1) === token
          ? `"delta":${JSON.stringify(token)}`
          : `"delta":${JSON.stringify(token)}`,
      );
    }
    // Reconstruct visible text from forwarded deltas
    const reconstructed = [...out.matchAll(/"delta":"((?:\\.|[^"\\])*)"/g)]
      .map((m) => JSON.parse(`"${m[1]}"`))
      .join("");
    expect(reconstructed).toBe(deltas.join(""));
    // event framing preserved
    expect(out.match(/event: response\.output_text\.delta/g)?.length).toBe(
      deltas.length,
    );
  });

  it("forwards response.reasoning_summary_text.delta without requiring usage substring", async () => {
    const input = [
      "event: response.reasoning_summary_text.delta",
      `data: ${JSON.stringify({
        sequence_number: 4,
        type: "response.reasoning_summary_text.delta",
        delta: "The",
        item_id: "rs_test",
        output_index: 0,
        summary_index: 0,
      })}`,
      "",
      "event: response.reasoning_summary_text.delta",
      `data: ${JSON.stringify({
        sequence_number: 5,
        type: "response.reasoning_summary_text.delta",
        delta: " user",
        item_id: "rs_test",
        output_index: 0,
        summary_index: 0,
      })}`,
      "",
    ].join("\n");

    const out = await runPassthrough(input);
    expect(out).toContain('"delta":"The"');
    expect(out).toContain('"delta":" user"');
  });
});