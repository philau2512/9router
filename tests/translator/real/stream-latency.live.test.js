// Live SSE latency probe for a running 9Router instance.
// It is opt-in: no network traffic unless RUN_STREAM_BENCH=1.
//
// Example (from repository root):
// RUN_STREAM_BENCH=1 STREAM_BENCH_MODEL="<configured-model>" \
// STREAM_BENCH_API_KEY="sk-..." \
// npx vitest run --config tests/vitest.config.js tests/translator/real/stream-latency.live.test.js
//
// Optional: STREAM_BENCH_BASE_URL=http://localhost:20127/v1
import { describe, expect, it } from "vitest";

const RUN_STREAM_BENCH = process.env.RUN_STREAM_BENCH === "1";
const BASE_URL = (process.env.STREAM_BENCH_BASE_URL || "http://localhost:20127/v1").replace(
  /\/$/,
  "",
);
const MODEL = process.env.STREAM_BENCH_MODEL || "";
const API_KEY = process.env.STREAM_BENCH_API_KEY || "";
const SAMPLE_COUNT = Math.max(1, Number.parseInt(process.env.STREAM_BENCH_SAMPLES || "3", 10) || 3);
const REQUEST_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.STREAM_BENCH_TIMEOUT_MS || "90000", 10) || 90_000,
);
const CONTEXT_CHARS = Math.max(
  0,
  Number.parseInt(process.env.STREAM_BENCH_CONTEXT_CHARS || "0", 10) || 0,
);
const TOOL_COUNT = Math.max(
  0,
  Number.parseInt(process.env.STREAM_BENCH_TOOL_COUNT || "0", 10) || 0,
);

function buildBenchmarkBody() {
  const context = CONTEXT_CHARS
    ? `Reference context:\n${"x".repeat(CONTEXT_CHARS)}`
    : "";
  const tools = Array.from({ length: TOOL_COUNT }, (_, index) => ({
    type: "function",
    function: {
      name: `lookup_context_${index + 1}`,
      description: "Retrieve one item from the provided reference context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  }));

  return {
    model: MODEL,
    stream: true,
    max_tokens: 32,
    temperature: 0,
    messages: [{
      role: "user",
      content: `${context}\n\nReply exactly: ok`,
    }],
    ...(tools.length ? { tools } : {}),
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

async function runSample(index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        // Explicitly disable every optional token saver for this measurement.
        "x-9router-token-saver": "off",
      },
      body: JSON.stringify(buildBenchmarkBody()),
      signal: controller.signal,
    });
    const headersAt = performance.now();

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`sample ${index}: ${response.status} ${errorBody}`);
    }
    expect(response.headers.get("content-type") || "").toContain("text/event-stream");
    expect(response.body, `sample ${index}: missing SSE body`).toBeTruthy();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let firstChunkAt = null;
    let firstVisibleTextAt = null;
    let previousChunkAt = null;
    let maxChunkGapMs = 0;
    let chunkCount = 0;
    let raw = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const receivedAt = performance.now();
      if (firstChunkAt === null) firstChunkAt = receivedAt;
      if (previousChunkAt !== null) {
        maxChunkGapMs = Math.max(maxChunkGapMs, receivedAt - previousChunkAt);
      }
      previousChunkAt = receivedAt;
      chunkCount++;

      const text = decoder.decode(value, { stream: true });
      raw += text;
      if (firstVisibleTextAt === null && /"content"\s*:\s*"[^"\\]/.test(raw)) {
        firstVisibleTextAt = receivedAt;
      }
    }

    const completedAt = performance.now();
    expect(chunkCount, `sample ${index}: received no SSE chunks`).toBeGreaterThan(0);

    return {
      headersMs: headersAt - startedAt,
      firstChunkMs: (firstChunkAt ?? completedAt) - startedAt,
      firstVisibleTextMs: (firstVisibleTextAt ?? completedAt) - startedAt,
      totalMs: completedAt - startedAt,
      maxChunkGapMs,
      chunkCount,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printReport(samples) {
  const metric = (name) => samples.map((sample) => sample[name]);
  const summary = {
    samples: samples.length,
    headers: `${formatMs(percentile(metric("headersMs"), 0.5))} p50 / ${formatMs(percentile(metric("headersMs"), 0.95))} p95`,
    firstChunk: `${formatMs(percentile(metric("firstChunkMs"), 0.5))} p50 / ${formatMs(percentile(metric("firstChunkMs"), 0.95))} p95`,
    firstVisibleText: `${formatMs(percentile(metric("firstVisibleTextMs"), 0.5))} p50 / ${formatMs(percentile(metric("firstVisibleTextMs"), 0.95))} p95`,
    total: `${formatMs(percentile(metric("totalMs"), 0.5))} p50 / ${formatMs(percentile(metric("totalMs"), 0.95))} p95`,
    maxChunkGap: formatMs(Math.max(...metric("maxChunkGapMs"))),
  };

  console.table(samples.map((sample, index) => ({
    sample: index + 1,
    headers: formatMs(sample.headersMs),
    firstChunk: formatMs(sample.firstChunkMs),
    firstVisibleText: formatMs(sample.firstVisibleTextMs),
    total: formatMs(sample.totalMs),
    maxGap: formatMs(sample.maxChunkGapMs),
    chunks: sample.chunkCount,
  })));
  console.log("[stream-bench] input", {
    contextChars: CONTEXT_CHARS,
    toolCount: TOOL_COUNT,
  });
  console.log("[stream-bench] summary", summary);
}

describe.skipIf(!RUN_STREAM_BENCH)("9Router basic streaming latency", () => {
  it(
    "measures headers, first chunk, visible text, and chunk gaps",
    async () => {
      expect(MODEL, "Set STREAM_BENCH_MODEL to a configured 9Router model").toBeTruthy();
      expect(API_KEY, "Set STREAM_BENCH_API_KEY to a valid 9Router API key").toBeTruthy();

      const samples = [];
      for (let index = 1; index <= SAMPLE_COUNT; index++) {
        samples.push(await runSample(index));
      }
      printReport(samples);
    },
    SAMPLE_COUNT * REQUEST_TIMEOUT_MS + 10_000,
  );
});