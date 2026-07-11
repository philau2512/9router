import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import {
  createSSETransformStreamWithLogger,
  createObjectTranslateStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Build a valid AWS EventStream frame (same layout parseEventFrame consumes).
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

async function drain(readable) {
  const reader = readable.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Byte path yields Uint8Array; object-translate output is also bytes.
    out +=
      typeof value === "string" ? value : dec.decode(value, { stream: true });
  }
  return out;
}

// Claude message ids are per-stream (msg_<ts>); normalize so two runs compare.
function normalizeClaude(sse) {
  return (
    sse
      .replace(/"id"\s*:\s*"msg_[^"]*"/g, '"id":"msg_X"')
      .replace(/"id"\s*:\s*"chatcmpl-[^"]*"/g, '"id":"chatcmpl_X"')
      // Claude message_start id is a bare Date.now() timestamp string; the two
      // sequential runs differ by a few ms. Mask any long numeric id.
      .replace(/"id"\s*:\s*"\d{10,}"/g, '"id":"ts_X"')
  );
}

const FRAMES = [
  createMockFrame("assistantResponseEvent", { content: "Hello " }),
  createMockFrame("assistantResponseEvent", { content: "world. " }),
  createMockFrame("assistantResponseEvent", {
    content: "<thinking>reasoning here</thinking> done.",
  }),
  createMockFrame("toolUseEvent", {
    toolUseId: "call_1",
    name: "get_x",
    input: "",
  }),
  createMockFrame("toolUseEvent", { toolUseId: "call_1", input: '{"a":1}' }),
  createMockFrame("contextUsageEvent", { contextUsagePercentage: 10 }),
  createMockFrame("metricsEvent", {
    metricsEvent: { inputTokens: 5, outputTokens: 9 },
  }),
  createMockFrame("meteringEvent", {}),
  createMockFrame("messageStopEvent", {}),
];
const BIN = concat(FRAMES);

function binStream() {
  const bytes = BIN;
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes.subarray());
      c.close();
    },
  });
}

// BYTE path: kiro decode -> SSE bytes -> byte-input translate.
async function runBytePath() {
  const ex = new KiroExecutor();
  const kResp = ex.transformEventStreamToSSE(
    { body: binStream() },
    "claude-sonnet-4",
  );
  const t = createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "kiro",
    null,
    null,
    "claude-sonnet-4",
    null,
    null,
    null,
    null,
    null,
  );
  return drain(kResp.body.pipeThrough(t));
}

// FUSED path: kiro decode -> objects -> object-input translate.
async function runFusedPath() {
  const ex = new KiroExecutor();
  const objStream = ex.transformEventStreamToSSE(
    { body: binStream() },
    "claude-sonnet-4",
    { emitObjects: true },
  );
  const t = createObjectTranslateStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "kiro",
    null,
    null,
    "claude-sonnet-4",
    null,
    null,
    null,
    null,
    null,
  );
  return drain(objStream.pipeThrough(t));
}

describe("Kiro fused object hand-off (Phase 3 option c)", () => {
  it("produces byte-identical Claude SSE vs the byte path", async () => {
    const [byteOut, fusedOut] = await Promise.all([
      runBytePath(),
      runFusedPath(),
    ]);
    expect(normalizeClaude(fusedOut)).toBe(normalizeClaude(byteOut));
  });

  it("fused output contains the translated Claude content and thinking", async () => {
    const out = await runFusedPath();
    expect(out).toContain("Hello ");
    expect(out).toContain("world. ");
    expect(out).toContain("reasoning here");
    // Thinking tags stripped (surfaced as Claude thinking block, not raw tags).
    expect(out).not.toContain("<thinking>");
    expect(out).not.toContain("</thinking>");
    // Claude stream framing present.
    expect(out).toContain("message_start");
    expect(out).toContain("message_stop");
  });

  it("emitObjects mode yields JS objects (not bytes) with a done sentinel", async () => {
    const ex = new KiroExecutor();
    const objStream = ex.transformEventStreamToSSE(
      { body: binStream() },
      "claude-sonnet-4",
      { emitObjects: true },
    );
    const reader = objStream.getReader();
    let sawObject = false;
    let sawDone = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        !(value instanceof Uint8Array)
      ) {
        sawObject = true;
        if (value.done === true) sawDone = true;
        else expect(value.object).toBe("chat.completion.chunk");
      }
    }
    expect(sawObject).toBe(true);
    expect(sawDone).toBe(true);
  });
});
