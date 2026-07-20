/**
 * Live probe: does Kiro (kr/auto*) actually stream thinking to the client?
 *
 * Usage:
 *   node tests/manual/kiro-thinking-live-probe.mjs
 *
 * Env overrides:
 *   BASE_URL=http://localhost:20127/v1
 *   API_KEY=sk-...
 *   MODEL=kr/auto
 */
import fs from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL || "http://localhost:20127/v1").replace(
  /\/$/,
  "",
);
const API_KEY =
  process.env.API_KEY || "sk-71884596f5bad03a-k80ll7-942a536d";
const OUT_DIR =
  process.env.OUT_DIR ||
  path.join(
    process.cwd(),
    "tests",
    "manual",
    `_kiro-thinking-probe_${stamp()}`,
  );

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const THINK_PROMPT =
  "Think step by step carefully before answering. " +
  "Count the number of letter r in the word 'strawberry' and show your intermediate reasoning. " +
  "Final answer must be a single integer on the last line.";

async function postSSE(urlPath, body, label) {
  const url = `${BASE_URL}${urlPath}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const rawHeaders = Object.fromEntries(res.headers.entries());
  const text = await res.text();
  const ms = Date.now() - started;
  return { label, url, status: res.status, ms, headers: rawHeaders, body, text };
}

function analyzeChatCompletions(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data: "));
  const chunks = [];
  for (const line of lines) {
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      /* ignore non-json */
    }
  }

  let content = "";
  let reasoning = "";
  let emptyContent = 0;
  let nonemptyContent = 0;
  let reasoningChunks = 0;
  let toolChunks = 0;
  const finishReasons = [];
  const sampleDeltas = [];

  for (const c of chunks) {
    const delta = c?.choices?.[0]?.delta || {};
    const fr = c?.choices?.[0]?.finish_reason;
    if (fr) finishReasons.push(fr);

    if (typeof delta.reasoning_content === "string") {
      reasoningChunks++;
      reasoning += delta.reasoning_content;
    }
    if (typeof delta.content === "string") {
      if (delta.content.length === 0) emptyContent++;
      else {
        nonemptyContent++;
        content += delta.content;
      }
    }
    if (delta.tool_calls) toolChunks++;

    if (sampleDeltas.length < 8) {
      sampleDeltas.push({
        keys: Object.keys(delta),
        contentLen: typeof delta.content === "string" ? delta.content.length : null,
        reasoningLen:
          typeof delta.reasoning_content === "string"
            ? delta.reasoning_content.length
            : null,
        preview:
          typeof delta.reasoning_content === "string"
            ? delta.reasoning_content.slice(0, 40)
            : typeof delta.content === "string"
              ? delta.content.slice(0, 40)
              : null,
      });
    }
  }

  return {
    format: "chat.completions",
    chunkCount: chunks.length,
    emptyContent,
    nonemptyContent,
    reasoningChunks,
    toolChunks,
    finishReasons,
    contentLen: content.length,
    reasoningLen: reasoning.length,
    contentPreview: content.slice(0, 200),
    reasoningPreview: reasoning.slice(0, 400),
    hasThinkingTags: content.includes("<thinking>") || reasoning.includes("<thinking>"),
    sampleDeltas,
  };
}

function analyzeResponses(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  let curEvent = null;
  for (const line of lines) {
    if (line.startsWith("event: ")) curEvent = line.slice(7).trim();
    else if (line.startsWith("data: ")) {
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        events.push({ event: curEvent, data: JSON.parse(payload) });
      } catch {
        events.push({ event: curEvent, data: payload });
      }
      curEvent = null;
    }
  }

  const typeCounts = {};
  let reasoningText = "";
  let outputText = "";
  let reasoningDeltas = 0;
  let outputDeltas = 0;

  for (const e of events) {
    const t = e.data?.type || e.event || "unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;

    if (t === "response.reasoning_summary_text.delta" && typeof e.data.delta === "string") {
      reasoningDeltas++;
      reasoningText += e.data.delta;
    }
    if (t === "response.output_text.delta" && typeof e.data.delta === "string") {
      outputDeltas++;
      outputText += e.data.delta;
    }
  }

  return {
    format: "responses",
    eventCount: events.length,
    typeCounts,
    reasoningDeltas,
    outputDeltas,
    reasoningLen: reasoningText.length,
    outputLen: outputText.length,
    reasoningPreview: reasoningText.slice(0, 400),
    outputPreview: outputText.slice(0, 200),
    hasReasoningItem: Object.keys(typeCounts).some((k) =>
      k.startsWith("response.reasoning"),
    ),
  };
}

function analyzeClaude(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data: "));
  let thinking = "";
  let textOut = "";
  let thinkingDeltas = 0;
  let textDeltas = 0;
  const eventTypes = {};

  for (const line of lines) {
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }
    const t = obj.type || "unknown";
    eventTypes[t] = (eventTypes[t] || 0) + 1;
    if (t === "content_block_delta" && obj.delta?.type === "thinking_delta") {
      thinkingDeltas++;
      thinking += obj.delta.thinking || "";
    }
    if (t === "content_block_delta" && obj.delta?.type === "text_delta") {
      textDeltas++;
      textOut += obj.delta.text || "";
    }
    if (t === "content_block_start" && obj.content_block?.type === "thinking") {
      eventTypes["thinking_block_start"] =
        (eventTypes["thinking_block_start"] || 0) + 1;
    }
  }

  return {
    format: "claude",
    eventTypes,
    thinkingDeltas,
    textDeltas,
    thinkingLen: thinking.length,
    textLen: textOut.length,
    thinkingPreview: thinking.slice(0, 400),
    textPreview: textOut.slice(0, 200),
  };
}

function verdict(stats) {
  if (stats.format === "chat.completions") {
    if (stats.reasoningLen > 0) return "PASS_HAS_REASONING";
    if (stats.emptyContent > 20 && stats.nonemptyContent > 0)
      return "FAIL_LIKELY_STRIPPED_THINKING_EMPTY_FLOOD";
    if (stats.contentLen > 0) return "FAIL_NO_REASONING_HAS_CONTENT";
    return "FAIL_EMPTY";
  }
  if (stats.format === "responses") {
    if (stats.reasoningLen > 0) return "PASS_HAS_REASONING";
    if (stats.outputLen > 0) return "FAIL_NO_REASONING_HAS_OUTPUT";
    return "FAIL_EMPTY";
  }
  if (stats.format === "claude") {
    if (stats.thinkingLen > 0) return "PASS_HAS_THINKING";
    if (stats.textLen > 0) return "FAIL_NO_THINKING_HAS_TEXT";
    return "FAIL_EMPTY";
  }
  return "UNKNOWN";
}

async function runCase(def) {
  console.log(`\n=== ${def.id} ===`);
  console.log(`POST ${def.path} model=${def.body.model || def.body?.model}`);
  let result;
  try {
    result = await postSSE(def.path, def.body, def.id);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return {
      id: def.id,
      error: String(err.message || err),
      verdict: "ERROR",
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = path.join(OUT_DIR, `${def.id}.raw.sse.txt`);
  const metaPath = path.join(OUT_DIR, `${def.id}.meta.json`);
  fs.writeFileSync(rawPath, result.text, "utf8");

  let stats;
  if (def.analyzer === "responses") stats = analyzeResponses(result.text);
  else if (def.analyzer === "claude") stats = analyzeClaude(result.text);
  else stats = analyzeChatCompletions(result.text);

  const out = {
    id: def.id,
    status: result.status,
    ms: result.ms,
    url: result.url,
    request: def.body,
    stats,
    verdict: result.status >= 200 && result.status < 300 ? verdict(stats) : `HTTP_${result.status}`,
    rawFile: rawPath,
    contentType: result.headers["content-type"] || null,
  };
  fs.writeFileSync(metaPath, JSON.stringify(out, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        status: out.status,
        ms: out.ms,
        verdict: out.verdict,
        stats: summarize(stats),
      },
      null,
      2,
    ),
  );
  return out;
}

function summarize(stats) {
  if (stats.format === "chat.completions") {
    return {
      chunks: stats.chunkCount,
      emptyContent: stats.emptyContent,
      nonemptyContent: stats.nonemptyContent,
      reasoningChunks: stats.reasoningChunks,
      reasoningLen: stats.reasoningLen,
      contentLen: stats.contentLen,
      contentPreview: stats.contentPreview,
      reasoningPreview: stats.reasoningPreview,
      finishReasons: stats.finishReasons,
    };
  }
  if (stats.format === "responses") {
    return {
      events: stats.eventCount,
      typeCounts: stats.typeCounts,
      reasoningDeltas: stats.reasoningDeltas,
      reasoningLen: stats.reasoningLen,
      outputDeltas: stats.outputDeltas,
      outputLen: stats.outputLen,
      reasoningPreview: stats.reasoningPreview,
      outputPreview: stats.outputPreview,
    };
  }
  return {
    eventTypes: stats.eventTypes,
    thinkingDeltas: stats.thinkingDeltas,
    thinkingLen: stats.thinkingLen,
    textLen: stats.textLen,
    thinkingPreview: stats.thinkingPreview,
    textPreview: stats.textPreview,
  };
}

const CASES = [
  {
    id: "01_chat_kr_auto_no_effort",
    path: "/chat/completions",
    analyzer: "chat",
    body: {
      model: "kr/auto",
      stream: true,
      max_tokens: 400,
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "02_chat_kr_auto_effort_high",
    path: "/chat/completions",
    analyzer: "chat",
    body: {
      model: "kr/auto",
      stream: true,
      max_tokens: 400,
      reasoning_effort: "high",
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "03_chat_kr_auto_thinking_suffix",
    path: "/chat/completions",
    analyzer: "chat",
    body: {
      model: "kr/auto-thinking",
      stream: true,
      max_tokens: 400,
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "04_chat_kr_auto_thinking_effort_high",
    path: "/chat/completions",
    analyzer: "chat",
    body: {
      model: "kr/auto-thinking",
      stream: true,
      max_tokens: 400,
      reasoning_effort: "high",
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "05_responses_kr_auto_effort_high",
    path: "/responses",
    analyzer: "responses",
    body: {
      model: "kr/auto",
      stream: true,
      max_output_tokens: 400,
      reasoning: { effort: "high", summary: "auto" },
      input: THINK_PROMPT,
    },
  },
  {
    id: "06_responses_kr_auto_thinking_effort_high",
    path: "/responses",
    analyzer: "responses",
    body: {
      model: "kr/auto-thinking",
      stream: true,
      max_output_tokens: 400,
      reasoning: { effort: "high", summary: "auto" },
      input: THINK_PROMPT,
    },
  },
  {
    id: "07_claude_kr_auto_thinking_budget",
    path: "/messages",
    analyzer: "claude",
    body: {
      model: "kr/auto",
      stream: true,
      max_tokens: 400,
      thinking: { type: "enabled", budget_tokens: 8000 },
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "08_claude_kr_auto_thinking_suffix",
    path: "/messages",
    analyzer: "claude",
    body: {
      model: "kr/auto-thinking",
      stream: true,
      max_tokens: 400,
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "09_chat_kr_sonnet_thinking_effort_high",
    path: "/chat/completions",
    analyzer: "chat",
    body: {
      model: "kr/claude-sonnet-4.5-thinking",
      stream: true,
      max_tokens: 400,
      reasoning_effort: "high",
      messages: [{ role: "user", content: THINK_PROMPT }],
    },
  },
  {
    id: "10_responses_kr_sonnet_thinking",
    path: "/responses",
    analyzer: "responses",
    body: {
      model: "kr/claude-sonnet-4.5-thinking",
      stream: true,
      max_output_tokens: 400,
      reasoning: { effort: "high", summary: "auto" },
      input: THINK_PROMPT,
    },
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`OUT_DIR=${OUT_DIR}`);
  console.log(`cases=${CASES.length}`);

  // health
  try {
    const m = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    console.log(`GET /models => ${m.status}`);
  } catch (e) {
    console.error("Server unreachable:", e.message);
    process.exit(2);
  }

  const results = [];
  for (const c of CASES) {
    results.push(await runCase(c));
    // small pause to avoid hammering quota
    await new Promise((r) => setTimeout(r, 800));
  }

  const summary = {
    baseUrl: BASE_URL,
    outDir: OUT_DIR,
    at: new Date().toISOString(),
    results: results.map((r) => ({
      id: r.id,
      status: r.status,
      ms: r.ms,
      verdict: r.verdict,
      reasoningLen: r.stats?.reasoningLen ?? r.stats?.thinkingLen ?? null,
      contentLen: r.stats?.contentLen ?? r.stats?.outputLen ?? r.stats?.textLen ?? null,
      emptyContent: r.stats?.emptyContent ?? null,
      reasoningChunks:
        r.stats?.reasoningChunks ?? r.stats?.reasoningDeltas ?? r.stats?.thinkingDeltas ?? null,
    })),
  };
  const summaryPath = path.join(OUT_DIR, "SUMMARY.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("\n========== SUMMARY ==========");
  for (const r of summary.results) {
    console.log(
      `${r.verdict.padEnd(40)} ${r.id}  status=${r.status}  reasoning=${r.reasoningLen}  content=${r.contentLen}  empty=${r.emptyContent}  ms=${r.ms}`,
    );
  }
  console.log(`\nWrote ${summaryPath}`);

  const anyPass = summary.results.some((r) => String(r.verdict).startsWith("PASS"));
  process.exit(anyPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});