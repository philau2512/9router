// Translate-path profiling harness (Phase 3 decision gate).
//
// Question: is the Kiro double-parse "object hand-off" optimization worth the
// architectural risk? The hand-off would let Kiro pass parsed JS event objects
// straight into the translate layer, eliminating the serialize -> re-parse hop:
//   kiro.js today:          build obj -> JSON.stringify -> encode -> enqueue
//   createSSEStream today:  decode -> buffer/split -> JSON.parse -> translate
// Everything AFTER the parse (translateResponse + Claude event formatting) is
// identical and NOT removable. So the honest measure of the win is:
//
//   removable_cost = per-chunk (JSON.stringify + JSON.parse) round-trip
//   total_cost     = full OpenAI-SSE -> Claude translate transform
//   share = removable / total   ->  if small, the hand-off is NOT worth it.
//
// Run:
//   node --import ./tests/perf/alias-loader.mjs tests/perf/translate-bench.mjs
//   node --import ./tests/perf/alias-loader.mjs tests/perf/translate-bench.mjs --chunks=4000

import { performance, PerformanceObserver } from "node:perf_hooks";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function parseArgs(argv) {
  const out = {
    chunks: 4000,
    chunkChars: 40,
    repeat: 5,
    warmup: 2,
    sliceKB: 4,
  };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "chunks") out.chunks = Number(v);
    else if (k === "chunk-chars") out.chunkChars = Number(v);
    else if (k === "repeat") out.repeat = Number(v);
    else if (k === "warmup") out.warmup = Number(v);
    else if (k === "slice-kb") out.sliceKB = Number(v);
  }
  return out;
}

// Build the exact OpenAI chat.completion.chunk objects Kiro's
// transformEventStreamToSSE emits (content deltas + a finish chunk).
function buildOpenAIChunkObjects({ chunks, chunkChars }) {
  const objs = [];
  const responseId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = "claude-sonnet-4";
  const word = "lorem ipsum dolor ".repeat(4);
  for (let i = 0; i < chunks; i++) {
    objs.push({
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta:
            i === 0
              ? {
                  role: "assistant",
                  content: word.slice(0, chunkChars) + ` #${i} `,
                }
              : { content: word.slice(0, chunkChars) + ` #${i} ` },
          finish_reason: null,
        },
      ],
    });
  }
  objs.push({
    id: responseId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: chunks * 6,
      total_tokens: 1200 + chunks * 6,
    },
  });
  return objs;
}

// Serialize objects to OpenAI SSE bytes (exactly what enters createSSEStream today).
function objectsToSSEBytes(objs) {
  const enc = new TextEncoder();
  let text = "";
  for (const o of objs) text += `data: ${JSON.stringify(o)}\n\n`;
  text += "data: [DONE]\n\n";
  return enc.encode(text);
}

function sliceIntoChunks(bytes, sliceBytes) {
  const chunks = [];
  for (let off = 0; off < bytes.length; off += sliceBytes) {
    chunks.push(bytes.subarray(off, Math.min(off + sliceBytes, bytes.length)));
  }
  return chunks;
}

// Run the REAL translate transform: OpenAI SSE -> Claude. Returns wall ms.
async function runTranslateOnce(sseChunks) {
  const upstream = new ReadableStream({
    start(controller) {
      for (const c of sseChunks) controller.enqueue(c);
      controller.close();
    },
  });
  // Handler semantics: createSSETransformStreamWithLogger(targetFormat, sourceFormat)
  // where targetFormat = PROVIDER/upstream format (Kiro emits OpenAI) and
  // sourceFormat = CLIENT output format (Claude). translateResponse translates the
  // incoming targetFormat data -> sourceFormat. So provider=OpenAI, client=Claude.
  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI, // targetFormat = upstream/provider (Kiro -> OpenAI SSE)
    FORMATS.CLAUDE, // sourceFormat = client output (Claude)
    "kiro",
    null, // reqLogger
    null, // toolNameMap
    "claude-sonnet-4",
    null, // connectionId
    null, // body
    null, // onStreamComplete
    null, // apiKey
    null, // streamStateTracker
  );
  const start = performance.now();
  const readable = upstream.pipeThrough(transform);
  const reader = readable.getReader();
  let outBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) outBytes += value.byteLength;
  }
  return { wallMs: performance.now() - start, outBytes };
}

// Micro-bench the REMOVABLE work: the per-chunk stringify (kiro side) + parse
// (createSSEStream side) round-trip that the object hand-off would delete.
function runRoundTripOnce(objs) {
  const start = performance.now();
  let sink = 0;
  for (const o of objs) {
    const s = JSON.stringify(o); // kiro.js does this per emitted chunk
    const p = JSON.parse(s); // parseSSELine does this per received chunk
    sink += p.choices.length; // touch result so JIT can't elide
  }
  const wallMs = performance.now() - start;
  return { wallMs, sink };
}

async function main() {
  const opts = parseArgs(process.argv);
  const objs = buildOpenAIChunkObjects(opts);
  const sseBytes = objectsToSSEBytes(objs);
  const sseChunks = sliceIntoChunks(sseBytes, opts.sliceKB * 1024);
  const inMB = sseBytes.length / (1024 * 1024);

  let gcCount = 0;
  let gcPauseMs = 0;
  const gcObs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcCount++;
      gcPauseMs += e.duration;
    }
  });
  try {
    gcObs.observe({ entryTypes: ["gc"] });
  } catch {}

  // Warmup both paths.
  for (let w = 0; w < opts.warmup; w++) {
    await runTranslateOnce(sseChunks);
    runRoundTripOnce(objs);
  }

  const totalRuns = [];
  const rtRuns = [];
  for (let r = 0; r < opts.repeat; r++) {
    totalRuns.push((await runTranslateOnce(sseChunks)).wallMs);
    rtRuns.push(runRoundTripOnce(objs).wallMs);
  }
  gcObs.disconnect();

  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const totalMs = median(totalRuns);
  const removableMs = median(rtRuns);
  const sharePct = (removableMs / totalMs) * 100;

  console.log(
    `[translate-bench] chunks=${opts.chunks} sseSize=${(sseBytes.length / 1024).toFixed(1)}KB ` +
      `slices=${sseChunks.length} repeat=${opts.repeat}`,
  );
  console.log(
    `[translate-bench] TOTAL translate (OpenAI->Claude) median wall=${totalMs.toFixed(2)}ms ` +
      `thrpt=${(inMB / (totalMs / 1000)).toFixed(1)}MB/s gc=${gcCount}/${gcPauseMs.toFixed(1)}ms`,
  );
  console.log(
    `[translate-bench] REMOVABLE (stringify+parse round-trip) median wall=${removableMs.toFixed(2)}ms`,
  );
  console.log(
    `[translate-bench] => object hand-off would remove ~${sharePct.toFixed(1)}% of translate transform CPU`,
  );
  const verdict =
    sharePct >= 15
      ? `WORTH IT (>=15% share) — build the hand-off`
      : `NOT WORTH IT (<15% share) — architectural risk not justified`;
  console.log(`[translate-bench] VERDICT: ${verdict}`);
}

main().catch((err) => {
  console.error("[translate-bench] FAILED:", err);
  process.exit(1);
});
