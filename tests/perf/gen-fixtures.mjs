// Synthetic AWS EventStream binary fixture generator for the Kiro stream bench.
//
// Builds minimal, VALID AWS EventStream binary frames from a hard-coded template
// - no credentials, no network. Enables CI and new-developer bootstrapping without
// a live-capture fixture (see Phase 1 plan: gen-fixtures fallback).
//
// Frame layout consumed by KiroExecutor.parseEventFrame (open-sse/executors/kiro.js):
//   [0..3]   totalLength   uint32 BE   (full frame length incl. this prelude + msg CRC)
//   [4..7]   headersLength uint32 BE
//   [8..11]  prelude CRC   uint32 BE   (NOT validated by parser -> written as 0)
//   [12..]   headers       (headersLength bytes)
//   [..]     payload       (JSON bytes)
//   [last 4] message CRC   uint32 BE   (NOT validated by parser -> written as 0)
//
// String header encoding (headerType 7):
//   nameLen uint8 | name | type(=7) uint8 | valueLen uint16 BE | value
//
// Usage:
//   node tests/perf/gen-fixtures.mjs                 -> writes default fixtures
//   import { buildKiroStream } from "./gen-fixtures.mjs"  -> programmatic

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const enc = new TextEncoder();

/** Encode a single AWS EventStream frame with one string header + JSON payload. */
export function buildFrame(eventType, payloadObj) {
  const headerName = enc.encode(":event-type");
  const headerValue = enc.encode(eventType);
  // header bytes: nameLen(1) + name + type(1) + valueLen(2) + value
  const headersLength = 1 + headerName.length + 1 + 2 + headerValue.length;

  const payloadBytes =
    payloadObj == null ? new Uint8Array(0) : enc.encode(JSON.stringify(payloadObj));

  const totalLength = 12 + headersLength + payloadBytes.length + 4;
  const buf = new Uint8Array(totalLength);
  const view = new DataView(buf.buffer);

  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  view.setUint32(8, 0, false); // prelude CRC (not validated)

  let off = 12;
  buf[off++] = headerName.length;
  buf.set(headerName, off);
  off += headerName.length;
  buf[off++] = 7; // string type
  view.setUint16(off, headerValue.length, false);
  off += 2;
  buf.set(headerValue, off);
  off += headerValue.length;

  buf.set(payloadBytes, off);
  off += payloadBytes.length;

  view.setUint32(off, 0, false); // message CRC (not validated)
  return buf;
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

/**
 * Build a full synthetic Kiro upstream stream.
 * @param {object} opts
 * @param {number} opts.contentChunks - number of assistantResponseEvent frames
 * @param {number} opts.chunkChars    - chars of content per chunk
 * @param {"plain"|"thinking"|"tools"} opts.variant
 */
export function buildKiroStream({
  contentChunks = 400,
  chunkChars = 24,
  variant = "plain",
} = {}) {
  const frames = [];
  const word = "lorem ipsum dolor ".repeat(4);

  if (variant === "thinking") {
    // Emit a <thinking> block that spans several chunks to exercise the strip path.
    frames.push(buildFrame("assistantResponseEvent", { content: "<thinking>" }));
    for (let i = 0; i < 20; i++) {
      frames.push(
        buildFrame("assistantResponseEvent", {
          content: word.slice(0, chunkChars),
        }),
      );
    }
    frames.push(buildFrame("assistantResponseEvent", { content: "</thinking>\n" }));
  }

  if (variant === "tools") {
    frames.push(
      buildFrame("toolUseEvent", {
        toolUseId: "call_synthetic_1",
        name: "get_weather",
        input: "",
      }),
    );
    for (let i = 0; i < contentChunks; i++) {
      frames.push(
        buildFrame("toolUseEvent", {
          toolUseId: "call_synthetic_1",
          input: `{"partial":${i}}`,
        }),
      );
    }
  }

  for (let i = 0; i < contentChunks; i++) {
    frames.push(
      buildFrame("assistantResponseEvent", {
        content: word.slice(0, chunkChars) + ` #${i} `,
      }),
    );
  }

  frames.push(buildFrame("contextUsageEvent", { contextUsagePercentage: 12.5 }));
  frames.push(
    buildFrame("metricsEvent", {
      metricsEvent: { inputTokens: 1200, outputTokens: contentChunks * 6 },
    }),
  );
  frames.push(buildFrame("meteringEvent", {}));
  frames.push(buildFrame("messageStopEvent", {}));

  return concat(frames);
}

// CLI: write default fixtures to tests/perf/fixtures/
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("gen-fixtures.mjs")
) {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "fixtures");
  mkdirSync(outDir, { recursive: true });

  // Larger plain fixture so small socket-read slices produce many transform() calls,
  // exposing the per-chunk O(n) buffer realloc that Phase 2 targets.
  const plain = buildKiroStream({ contentChunks: 4000, chunkChars: 40, variant: "plain" });
  const thinking = buildKiroStream({ contentChunks: 800, chunkChars: 32, variant: "thinking" });
  const tools = buildKiroStream({ contentChunks: 1200, chunkChars: 24, variant: "tools" });

  writeFileSync(join(outDir, "kiro-synthetic-plain.bin"), plain);
  writeFileSync(join(outDir, "kiro-synthetic-thinking.bin"), thinking);
  writeFileSync(join(outDir, "kiro-synthetic-tools.bin"), tools);

  console.log(
    `[gen-fixtures] wrote 3 synthetic fixtures to ${outDir}\n` +
      `  plain=${plain.length}B thinking=${thinking.length}B tools=${tools.length}B`,
  );
}
