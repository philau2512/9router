// Kiro stream hot-path profiling harness (Phase 1).
//
// Replays a captured or synthetic Kiro binary EventStream through the REAL
// transform entry point (KiroExecutor.transformEventStreamToSSE) offline, with no
// network and no credentials, and reports per-run metrics so every later phase has
// a hard before/after number.
//
// Metrics: cpuMs (directional only on Win32, ~15ms granularity), wallMs (primary
// precision gate via performance.now()), ttftMs, throughputMBps, gcCount, gcPauseMs,
// and (concurrency mode) event-loop delay p50/p95 via monitorEventLoopDelay().
//
// Usage:
//   node tests/perf/stream-bench.mjs --fixture=plain
//   node tests/perf/stream-bench.mjs --fixture=plain --repeat=5
//   node tests/perf/stream-bench.mjs --fixture=plain --concurrency=8
//   node tests/perf/stream-bench.mjs --fixture=plain --concurrency=8 --io-sim-delay=1
//
// --io-sim-delay=<ms> inserts a setTimeout between chunk enqueues to simulate
// network read pacing. no-delay = worst-case CPU contention (stress); with-delay =
// realistic production interleave. Use BOTH for the Phase 6 go/no-go decision.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  performance,
  PerformanceObserver,
  monitorEventLoopDelay,
} from "node:perf_hooks";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { buildKiroStream } from "./gen-fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

function parseArgs(argv) {
  const out = {
    fixture: "plain",
    repeat: 1,
    concurrency: 1,
    ioSimDelay: 0,
    sliceKB: 4, // small slices => many transform() calls => exposes O(n) buffer copy
    warmup: 2, // discarded iterations to settle JIT before timing
  };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "fixture") out.fixture = v;
    else if (k === "repeat") out.repeat = Number(v);
    else if (k === "concurrency") out.concurrency = Number(v);
    else if (k === "io-sim-delay") out.ioSimDelay = Number(v);
    else if (k === "slice-kb") out.sliceKB = Number(v);
    else if (k === "warmup") out.warmup = Number(v);
  }
  return out;
}

// Load the requested fixture as raw bytes. Prefer a committed real/synthetic .bin;
// fall back to generating a synthetic stream in-memory so the harness always runs.
function loadFixtureBytes(name) {
  const candidates = [
    join(fixturesDir, `kiro-${name}.bin`),
    join(fixturesDir, `kiro-synthetic-${name}.bin`),
    join(fixturesDir, `kiro-eventstream.bin`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const buf = readFileSync(p);
      return { bytes: new Uint8Array(buf), source: p };
    }
  }
  // In-memory synthetic fallback (no file needed).
  const variant = ["plain", "thinking", "tools"].includes(name)
    ? name
    : "plain";
  return {
    bytes: buildKiroStream({ contentChunks: 600, chunkChars: 28, variant }),
    source: `<in-memory synthetic:${variant}>`,
  };
}

function sliceIntoChunks(bytes, sliceBytes) {
  const chunks = [];
  for (let off = 0; off < bytes.length; off += sliceBytes) {
    chunks.push(bytes.subarray(off, Math.min(off + sliceBytes, bytes.length)));
  }
  return chunks;
}

function makeUpstream(chunks, ioSimDelay) {
  // A ReadableStream that enqueues the fixture slices, optionally with a delay
  // between enqueues to simulate network read pacing.
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      if (ioSimDelay > 0) {
        await new Promise((r) => setTimeout(r, ioSimDelay));
      }
      controller.enqueue(chunks[i++]);
    },
  });
}

// Run a single stream through the real Kiro transform. Returns per-stream timing.
async function runOneStream(executor, chunks, model, ioSimDelay) {
  const upstream = makeUpstream(chunks, ioSimDelay);
  const mockResponse = {
    body: upstream,
    ok: true,
    status: 200,
    statusText: "OK",
  };

  const startWall = performance.now();
  let ttftMs = null;
  let outBytes = 0;

  const transformed = executor.transformEventStreamToSSE(mockResponse, model);
  const reader = transformed.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttftMs === null) ttftMs = performance.now() - startWall;
    outBytes += value.byteLength;
  }
  const wallMs = performance.now() - startWall;
  return { wallMs, ttftMs: ttftMs ?? wallMs, outBytes };
}

async function bench(opts) {
  const { bytes, source } = loadFixtureBytes(opts.fixture);
  const chunks = sliceIntoChunks(bytes, opts.sliceKB * 1024);
  const executor = new KiroExecutor();
  const model = "claude-sonnet-4";
  const inMB = bytes.length / (1024 * 1024);

  // GC observer (alloc pressure proxy).
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
  } catch {
    // gc entries unavailable without --expose-gc on some builds; non-fatal.
  }

  // Warmup: discarded iterations to settle JIT before timing (excludes cold-start
  // spike from the variance gate).
  for (let w = 0; w < (opts.warmup || 0); w++) {
    await runOneStream(executor, chunks, model, 0);
  }

  const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
  loopMonitor.enable();

  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  const results = [];
  for (let r = 0; r < opts.repeat; r++) {
    if (opts.concurrency > 1) {
      const batch = await Promise.all(
        Array.from({ length: opts.concurrency }, () =>
          runOneStream(executor, chunks, model, opts.ioSimDelay),
        ),
      );
      results.push(...batch);
    } else {
      results.push(
        await runOneStream(executor, chunks, model, opts.ioSimDelay),
      );
    }
  }

  const totalWallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  loopMonitor.disable();
  gcObs.disconnect();

  const streams = results.length;
  const avgWall = results.reduce((s, x) => s + x.wallMs, 0) / streams;
  const avgTtft = results.reduce((s, x) => s + x.ttftMs, 0) / streams;
  // throughput based on aggregate bytes processed over total wall time
  const aggMB = inMB * streams;
  const throughputMBps = aggMB / (totalWallMs / 1000);
  const p50 = opts.concurrency > 1 ? loopMonitor.percentile(50) / 1e6 : null;
  const p95 = opts.concurrency > 1 ? loopMonitor.percentile(95) / 1e6 : null;

  return {
    fixture: opts.fixture,
    source,
    fixtureKB: (bytes.length / 1024).toFixed(1),
    streams,
    concurrency: opts.concurrency,
    ioSimDelay: opts.ioSimDelay,
    cpuMs: cpuMs.toFixed(1),
    totalWallMs: totalWallMs.toFixed(1),
    avgWallMs: avgWall.toFixed(2),
    ttftMs: avgTtft.toFixed(2),
    throughputMBps: throughputMBps.toFixed(1),
    gcCount,
    gcPauseMs: gcPauseMs.toFixed(1),
    loopDelayP50ms: p50 != null ? p50.toFixed(2) : "n/a",
    loopDelayP95ms: p95 != null ? p95.toFixed(2) : "n/a",
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const runs = [];
  const repeatOuter =
    opts.repeat > 1 && opts.concurrency === 1 ? opts.repeat : 1;
  // When --repeat is used at concurrency 1, report each run so throughput variance
  // can be eyeballed across repeats (the plan's <5% throughput variance gate).
  if (repeatOuter > 1) {
    const single = { ...opts, repeat: 1 };
    for (let i = 0; i < repeatOuter; i++) runs.push(await bench(single));
  } else {
    runs.push(await bench(opts));
  }

  for (const s of runs) {
    console.log(
      `[bench] fixture=${s.fixture} src=${s.source} size=${s.fixtureKB}KB ` +
        `streams=${s.streams} conc=${s.concurrency} ioDelay=${s.ioSimDelay}ms | ` +
        `cpuMs=${s.cpuMs} wallMs=${s.totalWallMs} avgWallMs=${s.avgWallMs} ` +
        `ttftMs=${s.ttftMs} thrpt=${s.throughputMBps}MB/s ` +
        `gc=${s.gcCount}/${s.gcPauseMs}ms loopP50=${s.loopDelayP50ms} loopP95=${s.loopDelayP95ms}`,
    );
  }

  if (runs.length > 1) {
    const thr = runs.map((r) => Number(r.throughputMBps));
    const mean = thr.reduce((a, b) => a + b, 0) / thr.length;
    const variancePct = ((Math.max(...thr) - Math.min(...thr)) / mean) * 100;
    console.log(
      `[bench] throughput across ${runs.length} runs: mean=${mean.toFixed(1)}MB/s ` +
        `spread=${variancePct.toFixed(1)}% (gate: <5%)`,
    );
  }
}

main().catch((err) => {
  console.error("[bench] FAILED:", err);
  process.exit(1);
});
