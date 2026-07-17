// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import {
  translateRequest,
  translateResponse,
} from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const AG2O = (req) =>
  translateRequest(
    FORMATS.ANTIGRAVITY,
    FORMATS.OPENAI,
    "m",
    { request: req },
    true,
    null,
    null,
  );

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js — content with BOTH functionResponse and functionCall/text
  // Fixed: emit assistant message for co-located tool calls alongside tool result messages.
  it("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [
        {
          role: "model",
          parts: [
            {
              functionResponse: {
                id: "c1",
                name: "prev",
                response: { result: "done" },
              },
            },
            { functionCall: { id: "c2", name: "next", args: {} } },
          ],
        },
      ],
    });
    const json = JSON.stringify(out);
    expect(
      json,
      "functionCall lost when sharing content with functionResponse",
    ).toContain('"next"');
  });

  it("functionCall without id keeps a stable matchable id", () => {
    const req = {
      contents: [
        {
          role: "model",
          parts: [{ functionCall: { name: "search", args: { q: "x" } } }],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "search", response: { result: "r" } } },
          ],
        },
      ],
    };
    const out = AG2O(req);
    const repeated = AG2O(req);
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");

    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(
      asst?.tool_calls?.[0]?.id,
    );
    expect(repeated.messages.find((m) => m.tool_calls)?.tool_calls?.[0]?.id).toBe(
      asst?.tool_calls?.[0]?.id,
    );
  });

  it("matches repeated missing IDs by same-name encounter order", () => {
    const out = AG2O({
      contents: [
        {
          role: "model",
          parts: [
            { functionCall: { name: "search", args: { q: "first" } } },
            { functionCall: { name: "search", args: { q: "second" } } },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "search", response: { result: "one" } } },
            { functionResponse: { name: "search", response: { result: "two" } } },
          ],
        },
      ],
    });
    const calls = out.messages.find((m) => m.tool_calls)?.tool_calls || [];
    const results = out.messages.filter((m) => m.role === "tool");

    expect(calls).toHaveLength(2);
    expect(calls[0].id).not.toBe(calls[1].id);
    expect(results.map((result) => result.tool_call_id)).toEqual(
      calls.map((call) => call.id),
    );
  });

  it("preserves native tool IDs in both request directions", () => {
    const requestOut = AG2O({
      contents: [
        {
          role: "model",
          parts: [{ functionCall: { id: "native-call", name: "search", args: {} } }],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "native-call",
                name: "search",
                response: { result: "done" },
              },
            },
          ],
        },
      ],
    });
    const responseState = {};
    const nativeResponse = {
      response: {
        responseId: "native-response-stream",
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: "native-response", name: "search", args: {} } },
              ],
            },
          },
        ],
      },
    };
    const responseOut = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      nativeResponse,
      responseState,
    );

    expect(requestOut.messages.find((m) => m.tool_calls)?.tool_calls?.[0]?.id).toBe(
      "native-call",
    );
    expect(responseOut.at(-1)?.choices?.[0]?.delta?.tool_calls?.[0]?.id).toBe(
      "native-response",
    );
    expect(
      translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, nativeResponse, {}),
    ).toEqual(responseOut);

    const missingIdResponse = {
      response: {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "search", args: {} } }],
            },
          },
        ],
      },
    };
    const missingIdOut = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      missingIdResponse,
      {},
    );
    expect(
      translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
        missingIdResponse,
        {},
      ),
    ).toEqual(missingIdOut);
    expect(missingIdOut.at(-1)?.choices?.[0]?.delta?.tool_calls?.[0]?.id).toBe(
      "gemini_call_0_search",
    );
    expect(requestOut.messages.find((m) => m.role === "tool")?.tool_call_id).toBe(
      "native-call",
    );
  });

  it("emits accumulated OpenAI tool-call IDs in Antigravity response", () => {
    const state = {};
    translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        id: "chatcmpl-1",
        model: "m",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call-from-openai", function: { name: "search" } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );
    const out = translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      state,
    );

    expect(out[0].response.candidates[0].content.parts[0].functionCall.id).toBe(
      "call-from-openai",
    );
  });

  it("pairs mixed native and generated same-name calls without corrupting FIFO", () => {
    const input = {
      contents: [
        {
          role: "model",
          parts: [
            { functionCall: { id: "native-search", name: "search", args: {} } },
            { functionCall: { name: "search", args: {} } },
            { functionCall: { name: "lookup", args: {} } },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { id: "native-search", name: "search", response: {} } },
            { functionResponse: { name: "lookup", response: {} } },
            { functionResponse: { name: "search", response: {} } },
          ],
        },
      ],
    };
    const out = AG2O(input);
    const calls = out.messages.find((message) => message.tool_calls).tool_calls;
    const results = out.messages.filter((message) => message.role === "tool");

    expect(results.map((message) => message.tool_call_id)).toEqual([
      "native-search",
      calls[2].id,
      calls[1].id,
    ]);
    expect(input.contents[0].parts[1].functionCall.id).toBeUndefined();
  });

  it("keeps unmatched and response-before-call tool results on the documented name fallback", () => {
    const out = AG2O({
      contents: [
        {
          role: "user",
          parts: [{ functionResponse: { name: "before-call", response: {} } }],
        },
        {
          role: "model",
          parts: [{ functionCall: { name: "before-call", args: {} } }],
        },
      ],
    });

    expect(out.messages[0].tool_call_id).toBe("before-call");
    expect(out.messages[1].tool_calls[0].id).toBe(
      "ag_call_1_0_before-call",
    );
  });

  it("uses unique deterministic response IDs across normal and thought-signature calls", () => {
    const state = {};
    const first = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "normal/tool", args: {} } },
                  {
                    thoughtSignature: "sig",
                    functionCall: { name: "thought tool", args: {} },
                  },
                ],
              },
            },
          ],
        },
      },
      state,
    );
    const second = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      { response: { candidates: [{ content: { parts: [{ functionCall: { name: "later", args: {} } }] } }] } },
      state,
    );
    const ids = [...first, ...second]
      .flatMap((chunk) => chunk.choices[0].delta.tool_calls || [])
      .map((call) => call.id);

    expect(ids).toEqual([
      "gemini_call_0_normal_tool",
      "gemini_call_1_thought_tool",
      "gemini_call_2_later",
    ]);
  });

  it("flushes multiple fragmented OpenAI calls with late IDs and does not replay them", () => {
    const state = {};
    translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        id: "chatcmpl-multi",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { name: "look" } },
                { index: 0, function: { name: "sea" } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );
    const finished = translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "late-search", function: { name: "rch", arguments: "{}" } },
                { index: 1, id: "late-lookup", function: { name: "up", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      state,
    );
    const parts = finished[0].response.candidates[0].content.parts;

    expect(parts.map((part) => part.functionCall)).toEqual([
      { id: "late-search", name: "search", args: {} },
      { id: "late-lookup", name: "lookup", args: {} },
    ]);
  });

  it("does not re-emit flushed OpenAI tool calls in a later completion", () => {
    const state = {};
    translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        id: "first",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "first-call", function: { name: "first", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      state,
    );
    const second = translateResponse(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      {
        id: "second",
        choices: [{ delta: { content: "done" }, finish_reason: "stop" }],
      },
      state,
    );

    expect(second[0].response.candidates[0].content.parts).toEqual([
      { text: "done" },
    ]);
  });

  it("separates unsigned and signed thought text from visible signed text", () => {
    const state = {};
    const translate = (parts, finishReason) =>
      translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
        {
          response: {
            candidates: [{ content: { parts }, ...(finishReason && { finishReason }) }],
          },
        },
        state,
      );
    const deltas = [
      ...translate([{ thought: true, text: "unsigned thought" }]),
      ...translate([
        { thought: true, thoughtSignature: "sig", text: "signed thought" },
      ]),
      ...translate([{ thoughtSignature: "sig", text: "visible answer" }], "STOP"),
    ].map((chunk) => chunk.choices[0].delta);

    expect(deltas.map((delta) => delta.reasoning_content).filter(Boolean)).toEqual([
      "unsigned thought",
      "signed thought",
    ]);
    expect(deltas.map((delta) => delta.content).filter(Boolean)).toEqual([
      "visible answer",
    ]);
  });

  it("suppresses traced unmarked self-talk before a signed Antigravity tool call", () => {
    const state = {};
    const selfTalk = [
      "Chúng ta đang ở Agent Mode. ",
      "Hãy xem lại các quy tắc trước khi chỉnh sửa.",
    ];
    const first = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [{ content: { parts: selfTalk.map((text) => ({ text })) } }],
        },
      },
      state,
    );
    const toolTurn = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    thoughtSignature: "provider-signed-agent-turn",
                    functionCall: {
                      id: "read-call",
                      name: "Read",
                      args: { path: "src/diffTracker.ts", offset: 250 },
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      state,
    );
    const deltas = [...first, ...toolTurn].map((chunk) =>
      chunk.choices[0].delta,
    );

    expect(deltas.map((delta) => delta.content).filter(Boolean)).toEqual([]);
    expect(deltas.flatMap((delta) => delta.tool_calls || [])).toMatchObject([
      { id: "read-call", function: { name: "Read" } },
    ]);
    expect(toolTurn.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps signed visible text before a signed Antigravity tool call", () => {
    const state = {};
    const visible = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [{ thoughtSignature: "visible-sig", text: "visible preamble" }],
              },
            },
          ],
        },
      },
      state,
    );
    const tool = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    thoughtSignature: "tool-sig",
                    functionCall: { id: "read-call", name: "Read", args: {} },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      state,
    );

    expect(visible.map((chunk) => chunk.choices[0].delta.content).filter(Boolean)).toEqual([
      "visible preamble",
    ]);
    expect(tool.flatMap((chunk) => chunk.choices[0].delta.tool_calls || [])).toMatchObject([
      { id: "read-call", function: { name: "Read" } },
    ]);
  });

  it("keeps signed visible text in a non-streaming Antigravity tool response", () => {
    const out = translateNonStreamingResponse(
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thoughtSignature: "visible-sig", text: "visible preamble" },
                  {
                    thoughtSignature: "tool-sig",
                    functionCall: { name: "Read", args: { path: "src/file.ts" } },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
    );

    expect(out.choices[0].message.content).toBe("visible preamble");
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("suppresses signed-tool self-talk in a non-streaming Antigravity response", () => {
    const out = translateNonStreamingResponse(
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "private agent narration" },
                  {
                    thoughtSignature: "provider-signed-agent-turn",
                    functionCall: { name: "Read", args: { path: "src/file.ts" } },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
    );

    expect(out.choices[0].message.content).toBeUndefined();
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps unmarked Antigravity text visible when no signed tool call follows", () => {
    const out = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "visible final answer" }] },
              finishReason: "STOP",
            },
          ],
        },
      },
      {},
    );

    expect(out.map((chunk) => chunk.choices[0].delta.content).filter(Boolean)).toEqual([
      "visible final answer",
    ]);
  });

  it("drops an unmarked thought continuation when Gemini truncates", () => {
    const state = {};
    const first = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            { content: { parts: [{ thought: true, text: "private reasoning" }] } },
          ],
        },
      },
      state,
    );
    const truncated = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "truncated reasoning continuation" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
        },
      },
      state,
    );
    const deltas = [...first, ...truncated].map((chunk) => chunk.choices[0].delta);

    expect(deltas.map((delta) => delta.reasoning_content).filter(Boolean)).toEqual([
      "private reasoning",
    ]);
    expect(deltas.map((delta) => delta.content).filter(Boolean)).toEqual([]);
    expect(truncated.at(-1).choices[0].finish_reason).toBe("max_tokens");
  });

  it("holds resumed Antigravity continuation until the terminal reason", () => {
    const resumedState = { geminiSawThought: true };
    const out = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "private continuation" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
        },
      },
      resumedState,
    );

    expect(out.map((chunk) => chunk.choices[0].delta.content).filter(Boolean)).toEqual([]);
    expect(out.at(-1).choices[0].finish_reason).toBe("max_tokens");
  });

  it("preserves thought, text, thought, and tool order", () => {
    const out = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "thought one" },
                  { text: "visible answer one" },
                  { thought: true, text: "thought two" },
                  { functionCall: { name: "search", args: { q: "x" } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      {},
    );
    const events = out.map((chunk) => {
      const delta = chunk.choices[0].delta;
      if (delta.role) return "role";
      if (delta.reasoning_content) return delta.reasoning_content;
      if (delta.content) return delta.content;
      if (delta.tool_calls) return "tool";
      return "finish";
    });

    expect(events).toEqual([
      "role",
      "thought one",
      "visible answer one",
      "thought two",
      "tool",
      "finish",
    ]);
  });

  it("keeps wrapped Gemini CLI content after thought when truncated", () => {
    const out = translateResponse(
      FORMATS.GEMINI_CLI,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "private reasoning" },
                  { text: "valid Gemini CLI answer" },
                ],
              },
              finishReason: "MAX_TOKENS",
            },
          ],
        },
      },
      {},
    );
    const deltas = out.map((chunk) => chunk.choices[0].delta);

    expect(deltas.map((delta) => delta.reasoning_content).filter(Boolean)).toEqual([
      "private reasoning",
    ]);
    expect(deltas.map((delta) => delta.content).filter(Boolean)).toEqual([
      "valid Gemini CLI answer",
    ]);
  });

  it("keeps text before tool calls after Antigravity thought", () => {
    const out = translateResponse(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "private reasoning" },
                  { text: "visible introduction" },
                  { functionCall: { name: "search", args: { q: "x" } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      },
      {},
    );
    const events = out.map((chunk) => {
      const delta = chunk.choices[0].delta;
      if (delta.role) return "role";
      if (delta.reasoning_content) return "reasoning";
      if (delta.content) return "content";
      if (delta.tool_calls) return "tool";
      return "finish";
    });

    expect(events).toEqual(["role", "reasoning", "content", "tool", "finish"]);
    expect(out.find((chunk) => chunk.choices[0].delta.content)?.choices[0].delta.content).toBe(
      "visible introduction",
    );
  });

  it("drops truncated non-streaming Antigravity thought continuation", () => {
    const out = translateNonStreamingResponse(
      {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "private reasoning" },
                  { text: "truncated reasoning continuation" },
                ],
              },
              finishReason: "MAX_TOKENS",
            },
          ],
        },
      },
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
    );

    expect(out.choices[0].message.content).toBe("");
    expect(out.choices[0].message.reasoning_content).toBe("private reasoning");
    expect(out.choices[0].finish_reason).toBe("max_tokens");
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ thoughtSignature: "sig", text: "" }] },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});
