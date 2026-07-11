import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

// Build a valid AWS EventStream frame (same layout the parser consumes).
function createMockFrame(eventType, payloadObj) {
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payloadObj));
  const headerNameBytes = enc.encode(":event-type");
  const headerValueBytes = enc.encode(eventType);
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

function concat(frames) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

// Feed `bytes` into the transform sliced into fixed-size pieces.
async function runSliced(bytes, sliceSize) {
  const executor = new KiroExecutor();
  const stream = new ReadableStream({
    start(controller) {
      for (let off = 0; off < bytes.length; off += sliceSize) {
        controller.enqueue(bytes.subarray(off, Math.min(off + sliceSize, bytes.length)));
      }
      controller.close();
    },
  });
  const transformed = executor.transformEventStreamToSSE({ body: stream }, "claude-test");
  const reader = transformed.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

// Normalize per-instance nondeterministic fields (id, created) so outputs from
// separate transform instances can be compared for structural byte-equality.
function normalize(sse) {
  return sse
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) return line;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.id) obj.id = "<id>";
        if (obj.created) obj.created = 0;
        return "data: " + JSON.stringify(obj);
      } catch {
        return line;
      }
    })
    .join("\n");
}

describe("KiroExecutor buffer boundary invariance (Phase 2)", () => {
  const frames = [
    createMockFrame("assistantResponseEvent", { content: "Hello " }),
    createMockFrame("assistantResponseEvent", { content: "world from Kiro. " }),
    createMockFrame("assistantResponseEvent", { content: "<thinking>reason A " }),
    createMockFrame("assistantResponseEvent", { content: "reason B</thinking> done." }),
    createMockFrame("toolUseEvent", { toolUseId: "call_1", name: "get_x", input: "" }),
    createMockFrame("toolUseEvent", { toolUseId: "call_1", input: '{"a":1}' }),
    createMockFrame("contextUsageEvent", { contextUsagePercentage: 10 }),
    createMockFrame("metricsEvent", { metricsEvent: { inputTokens: 5, outputTokens: 9 } }),
    createMockFrame("meteringEvent", {}),
    createMockFrame("messageStopEvent", {}),
  ];
  const bytes = concat(frames);

  it("produces identical SSE regardless of how the stream is chunked", async () => {
    // Whole buffer is the reference; every other slicing must match it byte-for-byte.
    const reference = normalize(await runSliced(bytes, bytes.length));
    const sliceSizes = [1, 2, 3, 7, 13, 32, 100, 512];
    for (const size of sliceSizes) {
      const got = normalize(await runSliced(bytes, size));
      expect(got, `slice size ${size} diverged`).toBe(reference);
    }
  });

  it("splits mid-frame (across header and payload) without corrupting events", async () => {
    // 1-byte slices force every frame to be reassembled across many transform() calls.
    const out = await runSliced(bytes, 1);
    expect(out).toContain('"content":"Hello "');
    expect(out).toContain("world from Kiro. ");
    expect(out).not.toContain("<thinking>");
    expect(out).not.toContain("</thinking>");
    expect(out).toContain("reason A");
    expect(out).toContain('"tool_calls"');
    expect(out.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("handles a chunk larger than the initial backing buffer (grow path)", async () => {
    // A single assistantResponseEvent whose payload exceeds the 16KB initial
    // backing buffer, delivered as one chunk, must still decode correctly.
    const big = "x".repeat(40000);
    const bigFrames = concat([
      createMockFrame("assistantResponseEvent", { content: big }),
      createMockFrame("messageStopEvent", {}),
    ]);
    const out = await runSliced(bigFrames, bigFrames.length);
    const dataLines = out
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
    const content = dataLines
      .map((l) => JSON.parse(l.slice(6)))
      .filter((c) => c.choices?.[0]?.delta?.content)
      .map((c) => c.choices[0].delta.content)
      .join("");
    expect(content).toBe(big);
  });
});
