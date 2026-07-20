/**
 * REAL live probe: Kiro thinking / reasoning stream visibility.
 *
 * Gated by RUN_REAL=1 (skipped in default runs). Named .live.test.js so the
 * *.real.test.js vitest exclude pattern does not hide this file.
 *
 *   RUN_REAL=1 `
 *   REAL_BASE_URL=http://localhost:20127/v1 `
 *   REAL_API_KEY=sk-... `
 *   npx vitest run --config tests/vitest.config.js tests/translator/real/kiro-thinking-stream.live.test.js
 *
 * After fix (split-tag → reasoning_content):
 *   - kr/claude-sonnet-4.5-thinking streams reasoning_content / response.reasoning_*
 *   - raw <thinking> tags must not leak into content
 *   - kr/auto may still omit thinking depending on upstream model choice
 */
import { describe, it, expect } from "vitest";

const RUN = process.env.RUN_REAL === "1";
const BASE = (process.env.REAL_BASE_URL || "http://localhost:20127/v1").replace(
  /\/$/,
  "",
);
const KEY = process.env.REAL_API_KEY || process.env.API_KEY || "";
const TIMEOUT_MS = Number(process.env.REAL_TIMEOUT_MS || 90_000);

const PROMPT =
  "Think step by step carefully before answering. " +
  "Count the number of letter r in the word 'strawberry' and show your intermediate reasoning. " +
  "Final answer must be a single integer on the last line.";

async function postSSE(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function parseChat(text) {
  const chunks = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6).trim())
    .filter((p) => p && p !== "[DONE]")
    .map((p) => {
      try {
        return JSON.parse(p);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  let content = "";
  let reasoning = "";
  let reasoningChunks = 0;
  for (const c of chunks) {
    const d = c?.choices?.[0]?.delta || {};
    if (typeof d.reasoning_content === "string") {
      reasoningChunks++;
      reasoning += d.reasoning_content;
    }
    if (typeof d.content === "string") content += d.content;
  }
  return {
    chunks: chunks.length,
    content,
    reasoning,
    reasoningChunks,
    hasThinkingTags:
      /<\/?thinking>/.test(content) || content.includes("<thinking"),
  };
}

function parseResponses(text) {
  const types = {};
  let reasoning = "";
  let output = "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }
    const t = obj.type || "unknown";
    types[t] = (types[t] || 0) + 1;
    if (t === "response.reasoning_summary_text.delta") reasoning += obj.delta || "";
    if (t === "response.output_text.delta") output += obj.delta || "";
  }
  return {
    types,
    reasoning,
    output,
    hasReasoningEvents: Object.keys(types).some((k) =>
      k.startsWith("response.reasoning"),
    ),
  };
}

function parseClaude(text) {
  let thinking = "";
  let textOut = "";
  let thinkingDeltas = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }
    if (obj.type === "content_block_delta" && obj.delta?.type === "thinking_delta") {
      thinkingDeltas++;
      thinking += obj.delta.thinking || "";
    }
    if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
      textOut += obj.delta.text || "";
    }
  }
  return { thinking, textOut, thinkingDeltas };
}

describe.skipIf(!RUN)("REAL kiro thinking stream (live HTTP)", () => {
  it("requires REAL_API_KEY / API_KEY", () => {
    expect(KEY, "set REAL_API_KEY or API_KEY").toBeTruthy();
  });

  it(
    "chat kr/auto + reasoning_effort=high → no raw thinking tag leak",
    async () => {
      const { status, text } = await postSSE("/chat/completions", {
        model: "kr/auto",
        stream: true,
        max_tokens: 400,
        reasoning_effort: "high",
        messages: [{ role: "user", content: PROMPT }],
      });
      expect(status).toBe(200);
      const s = parseChat(text);
      expect(s.chunks).toBeGreaterThan(0);
      expect(s.content.length + s.reasoning.length).toBeGreaterThan(0);
      expect(s.hasThinkingTags).toBe(false);
      expect(s.content).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );

  it(
    "chat kr/auto-thinking → no raw thinking tag leak",
    async () => {
      const { status, text } = await postSSE("/chat/completions", {
        model: "kr/auto-thinking",
        stream: true,
        max_tokens: 400,
        reasoning_effort: "high",
        messages: [{ role: "user", content: PROMPT }],
      });
      expect(status).toBe(200);
      const s = parseChat(text);
      expect(s.content.length + s.reasoning.length).toBeGreaterThan(0);
      expect(s.hasThinkingTags).toBe(false);
      expect(s.content).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );

  it(
    "responses kr/auto reasoning.effort=high → no raw tag leak in output_text",
    async () => {
      const { status, text } = await postSSE("/responses", {
        model: "kr/auto",
        stream: true,
        max_output_tokens: 400,
        reasoning: { effort: "high", summary: "auto" },
        input: PROMPT,
      });
      expect(status).toBe(200);
      const s = parseResponses(text);
      expect(s.output.length + s.reasoning.length).toBeGreaterThan(0);
      expect(s.output).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );

  it(
    "claude messages kr/auto thinking budget → no raw tag in text",
    async () => {
      const { status, text } = await postSSE("/messages", {
        model: "kr/auto",
        stream: true,
        max_tokens: 400,
        thinking: { type: "enabled", budget_tokens: 8000 },
        messages: [{ role: "user", content: PROMPT }],
      });
      expect(status).toBe(200);
      const s = parseClaude(text);
      expect(s.textOut.length + s.thinking.length).toBeGreaterThan(0);
      expect(s.textOut).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );

  it(
    "chat kr/claude-sonnet-4.5-thinking → reasoning_content, no raw tags in content",
    async () => {
      const { status, text } = await postSSE("/chat/completions", {
        model: "kr/claude-sonnet-4.5-thinking",
        stream: true,
        max_tokens: 400,
        reasoning_effort: "high",
        messages: [{ role: "user", content: PROMPT }],
      });
      expect(status).toBe(200);
      const s = parseChat(text);
      expect(s.reasoningChunks, "thinking must stream as reasoning_content").toBeGreaterThan(0);
      expect(s.reasoning.length).toBeGreaterThan(0);
      expect(s.hasThinkingTags, "raw tags must not leak into content").toBe(false);
      expect(s.content).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );

  it(
    "responses kr/claude-sonnet-4.5-thinking → response.reasoning_summary_* events",
    async () => {
      const { status, text } = await postSSE("/responses", {
        model: "kr/claude-sonnet-4.5-thinking",
        stream: true,
        max_output_tokens: 400,
        reasoning: { effort: "high", summary: "auto" },
        input: PROMPT,
      });
      expect(status).toBe(200);
      const s = parseResponses(text);
      expect(s.hasReasoningEvents).toBe(true);
      expect(s.reasoning.length).toBeGreaterThan(0);
      expect(s.output).not.toContain("<thinking");
    },
    TIMEOUT_MS,
  );
});