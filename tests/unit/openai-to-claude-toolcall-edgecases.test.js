import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

// Characterization tests for the "Claude Code CLI stops before running a tool"
// bug when the upstream is an OpenAI-compatible provider (e.g. KiroGo).
//
// Each test asserts the CORRECT Anthropic output. A failing test proves the
// translator drops the tool call for that upstream shape (bug is real and
// deterministic); a passing test proves that shape is already handled and no
// fix is warranted.
function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function toolUseStart(events) {
  return events?.find(
    (e) => e.type === "content_block_start" && e.content_block?.type === "tool_use",
  );
}

function inputJsonDelta(events) {
  return events?.find(
    (e) =>
      e.type === "content_block_delta" && e.delta?.type === "input_json_delta",
  )?.delta.partial_json;
}

function stopReason(events) {
  return events?.find((e) => e.type === "message_delta")?.delta?.stop_reason;
}

describe("openaiToClaudeResponse tool_call edge cases (KiroGo-style upstream)", () => {
  // SUSPECT #1: provider streams the tool id only on the FIRST fragment and
  // subsequent argument fragments carry index only. This is the common OpenAI
  // streaming shape. It should still produce a complete tool_use block.
  it("id on first fragment, arguments on later id-less fragments", () => {
    const state = createState();

    const e1 = openaiToClaudeResponse(
      {
        id: "c1",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "toolu_a", function: { name: "Edit", arguments: "" } },
              ],
            },
          },
        ],
      },
      state,
    );

    const e2 = openaiToClaudeResponse(
      {
        id: "c1",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"path":"a.js"}' } },
              ],
            },
          },
        ],
      },
      state,
    );

    const e3 = openaiToClaudeResponse(
      {
        id: "c1",
        model: "m",
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      },
      state,
    );

    const all = [...(e1 || []), ...(e2 || []), ...(e3 || [])];
    expect(toolUseStart(all)?.content_block?.id).toBe("toolu_a");
    expect(inputJsonDelta(all)).toBe('{"path":"a.js"}');
    expect(stopReason(all)).toBe("tool_use");
  });

  // SUSPECT #1b: provider omits id entirely and identifies the tool call only
  // by index (some compat layers do this). A tool_use block should still open.
  it("no id at all, tool identified by index only", () => {
    const state = createState();

    const e1 = openaiToClaudeResponse(
      {
        id: "c2",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { name: "Edit", arguments: '{"path":"b.js"}' } },
              ],
            },
          },
        ],
      },
      state,
    );

    const e2 = openaiToClaudeResponse(
      {
        id: "c2",
        model: "m",
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      },
      state,
    );

    const all = [...(e1 || []), ...(e2 || [])];
    expect(toolUseStart(all)).toBeTruthy();
    expect(inputJsonDelta(all)).toBe('{"path":"b.js"}');
    expect(stopReason(all)).toBe("tool_use");
  });

  // SUSPECT #2: Kiro-flavored upstream sends finish_reason "tool_use" (not the
  // OpenAI-standard "tool_calls"). It must still map to Anthropic "tool_use".
  it('finish_reason "tool_use" maps to stop_reason tool_use', () => {
    const state = createState();

    const e1 = openaiToClaudeResponse(
      {
        id: "c3",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "toolu_c", function: { name: "Edit", arguments: '{"x":1}' } },
              ],
            },
          },
        ],
      },
      state,
    );

    const e2 = openaiToClaudeResponse(
      {
        id: "c3",
        model: "m",
        choices: [{ delta: {}, finish_reason: "tool_use" }],
      },
      state,
    );

    const all = [...(e1 || []), ...(e2 || [])];
    expect(stopReason(all)).toBe("tool_use");
  });

  // SUSPECT #2b: provider streamed a tool_use block but reports finish_reason
  // "stop". The client must still be told tool_use so it runs the tool.
  it('tool block streamed but finish_reason "stop" still yields tool_use', () => {
    const state = createState();

    const e1 = openaiToClaudeResponse(
      {
        id: "c4",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "toolu_d", function: { name: "Edit", arguments: '{"y":2}' } },
              ],
            },
          },
        ],
      },
      state,
    );

    const e2 = openaiToClaudeResponse(
      {
        id: "c4",
        model: "m",
        choices: [{ delta: {}, finish_reason: "stop" }],
      },
      state,
    );

    const all = [...(e1 || []), ...(e2 || [])];
    expect(stopReason(all)).toBe("tool_use");
  });
});
