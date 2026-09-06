/**
 * Regression map for Antigravity empty STOP after tool continuation.
 *
 * Reproduced from:
 *   cli/app/logs/openai-responses_antigravity_gemini-3-flash-agent_20260720_105401_073
 *
 * Provider returned:
 *   parts:[{text:""}], finishReason:"STOP", completion_tokens:0
 * → client got response.completed with empty output (agent stops after Grep).
 *
 * Fix directions:
 *   1. Detect empty STOP candidate as non-success / retryable  ✅
 *   2. Preserve real thoughtSignature across OpenAI bridge (Responses path)  ✅
 *   3. Keep thought parts on Gemini-3 thinking tool continuations  ✅
 *   4. Do not merge functionResponse with follow-up user text  ✅
 *   5. requestLogger must not redact maxOutputTokens / max_output_tokens  ✅
 *   6. Responses client must not emit response.completed on empty STOP  ✅
 *
 * it.fails = still open; regular it = fixed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import "./registerAll.js";
import {
  translateRequest,
  translateResponse,
  initState,
} from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import {
  getAntigravitySessionKey,
  setCachedThinking,
  getCachedThinking,
  injectThinkingReplay,
} from "../../open-sse/utils/antigravityReasoningReplay.js";
import {
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} from "../../open-sse/config/defaultThinkingSignature.js";

const REAL_SIG = "provider-real-thought-sig-from-google-xyz";
const credentials = {
  accessToken: "ag-token",
  projectId: "ag-project",
  connectionId: "ag-empty-stop-test",
  email: "ag-empty@test.local",
};

const T = (src, tgt, body, provider = "antigravity") =>
  translateRequest(src, tgt, "gemini-3-flash-agent", body, true, credentials, provider);

function emptyStopProviderChunk() {
  return {
    response: {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 86257,
        totalTokenCount: 86257,
        cachedContentTokenCount: 82350,
      },
      modelVersion: "gemini-3-flash-c",
      responseId: "empty-stop-fixture",
    },
  };
}

function collectFcParts(antigravityBody) {
  const contents = antigravityBody?.request?.contents || antigravityBody?.contents || [];
  return contents.flatMap((c) => c.parts || []).filter((p) => p.functionCall);
}

function hasMixedFrAndText(antigravityBody) {
  const contents = antigravityBody?.request?.contents || [];
  return contents.some((c) => {
    const parts = c.parts || [];
    return (
      parts.some((p) => p.functionResponse) &&
      parts.some((p) => typeof p.text === "string" && p.text.length > 0)
    );
  });
}

// ─── 1. Empty STOP detection ───────────────────────────────────────────────

describe("fix1: empty STOP candidate must not look like a successful answer", () => {
  // gemini-to-openai / stream path: empty parts + STOP + 0 completion tokens
  it(
    "empty provider STOP is not translated as a normal successful stop",
    () => {
      const state = { responseTargetFormat: FORMATS.ANTIGRAVITY };
      const chunks = translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
        emptyStopProviderChunk(),
        state,
      );
      const deltas = (chunks || []).map((c) => c.choices?.[0]?.delta || {});
      const hasVisible =
        deltas.some((d) => d.content) ||
        deltas.some((d) => d.reasoning_content) ||
        deltas.some((d) => d.tool_calls?.length);
      const finish = (chunks || []).map((c) => c.choices?.[0]?.finish_reason).filter(Boolean);

      // Desired: either no successful "stop", or an explicit empty-response marker.
      const looksLikeSuccessStop = finish.includes("stop") && !hasVisible;
      expect(
        looksLikeSuccessStop,
        "empty STOP must not be a silent successful completion",
      ).toBe(false);
      expect(
        state.emptyProviderResponse === true ||
          state.providerEmptyStop === true ||
          finish.includes("error"),
        "pipeline should flag empty provider candidate",
      ).toBe(true);
    },
  );

  it(
    "empty STOP with zero completion tokens is classified as empty response",
    () => {
      const state = { responseTargetFormat: FORMATS.ANTIGRAVITY };
      translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
        emptyStopProviderChunk(),
        state,
      );

      const usage = emptyStopProviderChunk().response.usageMetadata;
      const completionTokens =
        usage.candidatesTokenCount ?? usage.totalTokenCount - usage.promptTokenCount;
      expect(completionTokens).toBe(0);
      expect(
        state.emptyProviderResponse,
        "expected state.emptyProviderResponse after empty STOP",
      ).toBe(true);
    },
  );

  it(
    "OpenAI finish_reason=error becomes response.failed for Responses clients",
    () => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      const events = translateResponse(
        FORMATS.OPENAI,
        FORMATS.OPENAI_RESPONSES,
        {
          id: "chatcmpl-empty-stop",
          object: "chat.completion.chunk",
          created: 1,
          model: "gemini-default",
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            },
          ],
        },
        state,
      );
      const terminal = translateResponse(
        FORMATS.OPENAI,
        FORMATS.OPENAI_RESPONSES,
        {
          id: "chatcmpl-empty-stop",
          object: "chat.completion.chunk",
          created: 1,
          model: "gemini-default",
          choices: [{ index: 0, delta: {}, finish_reason: "error" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 0,
            total_tokens: 10,
          },
        },
        state,
      );

      const all = [...(events || []), ...(terminal || [])];
      const hasFailed = all.some((e) => e.event === "response.failed");
      const hasCompleted = all.some((e) => e.event === "response.completed");

      expect(hasFailed, "expected response.failed for empty STOP").toBe(true);
      expect(hasCompleted, "empty STOP must not complete successfully").toBe(false);
    },
  );

  it(
    "Antigravity malformed function calls become response.failed with provider details",
    () => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      const events = translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI_RESPONSES,
        {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "Thinking before selecting a tool",
                    },
                  ],
                },
                finishReason: "MALFORMED_FUNCTION_CALL",
                finishMessage:
                  "Malformed function call: Function call is empty - no input to parse.",
              },
            ],
            usageMetadata: {
              promptTokenCount: 27088,
              totalTokenCount: 27131,
              thoughtsTokenCount: 43,
            },
            modelVersion: "gemini-3.6-flash-tiered",
            responseId: "malformed-function-call-fixture",
          },
        },
        state,
      );

      const failed = (events || []).find(
        (event) => event.event === "response.failed",
      );
      const completed = (events || []).find(
        (event) => event.event === "response.completed",
      );

      expect(failed?.data.response.status).toBe("failed");
      expect(failed?.data.response.error).toEqual({
        code: "malformed_function_call",
        message:
          "Malformed function call: Function call is empty - no input to parse.",
      });
      expect(completed).toBeUndefined();
    },
  );

  it(
    "non-streaming Antigravity malformed function calls preserve provider errors",
    () => {
      const result = translateNonStreamingResponse(
        {
          response: {
            candidates: [
              {
                content: {
                  parts: [{ thought: true, text: "Thinking before failure" }],
                },
                finishReason: "MALFORMED_FUNCTION_CALL",
                finishMessage: "Function call is empty - no input to parse.",
              },
            ],
          },
        },
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
      );

      expect(result.choices[0].finish_reason).toBe("error");
      expect(result.error).toEqual({
        code: "malformed_function_call",
        message: "Function call is empty - no input to parse.",
      });
    },
  );

});

// ─── 2. Preserve thoughtSignature ──────────────────────────────────────────

describe("fix2: real thoughtSignature must survive OpenAI bridge for tool continuity", () => {
  it(
    "AG response functionCall thoughtSignature is exposed on OpenAI tool_calls",
    () => {
      const state = { responseTargetFormat: FORMATS.ANTIGRAVITY };
      const chunks = translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.OPENAI,
        {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      thoughtSignature: REAL_SIG,
                      functionCall: {
                        id: "ks6hht0n",
                        name: "Grep",
                        args: { pattern: "run_command" },
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

      const toolCall = (chunks || [])
        .flatMap((c) => c.choices?.[0]?.delta?.tool_calls || [])
        .find((tc) => tc.function?.name === "Grep" || tc.id === "ks6hht0n");

      const sig =
        toolCall?.thought_signature ||
        toolCall?.thoughtSignature ||
        toolCall?.function?.thought_signature;

      expect(sig, "thoughtSignature dropped in AG→OpenAI tool_calls").toBe(REAL_SIG);
    },
  );

  it(
    "OpenAI→Antigravity reuses tool_call thought_signature instead of DEFAULT_CLI",
    () => {
      const out = T(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, {
        model: "gemini-3-flash-agent",
        messages: [
          { role: "user", content: "find run_command" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "ks6hht0n",
                type: "function",
                thought_signature: REAL_SIG,
                function: {
                  name: "Grep",
                  arguments: JSON.stringify({ pattern: "run_command" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "ks6hht0n",
            content: JSON.stringify({ matches: ["run_command"] }),
          },
        ],
        max_tokens: 65535,
        reasoning_effort: "high",
      });

      const fcs = collectFcParts(out);
      expect(fcs.length).toBeGreaterThan(0);
      expect(fcs[0].thoughtSignature).toBe(REAL_SIG);
      expect(fcs[0].thoughtSignature).not.toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
    },
  );

  it(
    "Responses→OpenAI→Antigravity keeps function_call thought_signature",
    () => {
      // Mirrors Cursor /v1/responses history: function_call item may carry continuity sig.
      const out = T(FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, {
        model: "agy",
        stream: true,
        reasoning: { effort: "high" },
        max_output_tokens: 65535,
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "find run_command" }],
          },
          {
            type: "function_call",
            call_id: "ks6hht0n",
            name: "Grep",
            arguments: JSON.stringify({ pattern: "run_command" }),
            thought_signature: REAL_SIG,
          },
          {
            type: "function_call_output",
            call_id: "ks6hht0n",
            output: JSON.stringify({ matches: ["run_command"] }),
          },
        ],
      });

      const fcs = collectFcParts(out);
      expect(fcs.length).toBeGreaterThan(0);
      expect(
        fcs[0].thoughtSignature,
        "Responses path replaced real sig with default",
      ).toBe(REAL_SIG);
    },
  );
});

// ─── 3. Thought parts on thinking tool continuations ───────────────────────

describe("fix3: thought parts must survive executor when thinking is active", () => {
  it(
    "transformRequest keeps thought parts when thinkingLevel is high",
    () => {
      const executor = new AntigravityExecutor();
      const result = executor.transformRequest(
        "gemini-3-flash-agent",
        {
          request: {
            contents: [
              {
                role: "model",
                parts: [
                  { thought: true, text: "brief private reasoning before Grep" },
                  {
                    thoughtSignature: REAL_SIG,
                    functionCall: {
                      id: "ks6hht0n",
                      name: "Grep",
                      args: { pattern: "run_command" },
                    },
                  },
                ],
              },
              {
                role: "user",
                parts: [
                  {
                    functionResponse: {
                      id: "ks6hht0n",
                      name: "Grep",
                      response: { result: { matches: ["run_command"] } },
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 65535,
              thinkingConfig: {
                thinkingLevel: "high",
                includeThoughts: true,
              },
            },
          },
        },
        true,
        credentials,
      );

      const modelTurn = result.request.contents.find(
        (c) => c.role === "model" && c.parts?.some((p) => p.functionCall),
      );
      expect(
        modelTurn?.parts?.some((p) => p.thought === true && p.text),
        "thought part stripped despite thinkingLevel=high",
      ).toBe(true);
      expect(
        modelTurn?.parts?.find((p) => p.functionCall)?.thoughtSignature,
      ).toBe(REAL_SIG);
    },
  );

  it(
    "injectThinkingReplay survives transformRequest for tool continuation",
    () => {
      const sessionBody = {
        request: {
          sessionId: "empty-stop-session-1",
          contents: [
            {
              role: "model",
              parts: [
                {
                  thoughtSignature: REAL_SIG,
                  functionCall: {
                    id: "ks6hht0n",
                    name: "Grep",
                    args: { pattern: "run_command" },
                  },
                },
              ],
            },
            {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    id: "ks6hht0n",
                    name: "Grep",
                    response: { result: "ok" },
                  },
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 65535,
            thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
          },
        },
      };

      const key = getAntigravitySessionKey("gemini-3-flash-agent", sessionBody);
      setCachedThinking(key, "cached thought from prior Grep turn");
      expect(getCachedThinking(key)).toContain("cached thought");

      const withReplay = injectThinkingReplay(
        sessionBody,
        getCachedThinking(key),
      );
      expect(
        withReplay.request.contents[0].parts.some((p) => p.thought === true),
      ).toBe(true);

      const executor = new AntigravityExecutor();
      const sent = executor.transformRequest(
        "gemini-3-flash-agent",
        withReplay,
        true,
        credentials,
      );

      expect(
        sent.request.contents[0].parts.some(
          (p) => p.thought === true && /cached thought/.test(p.text || ""),
        ),
        "replayed thought must not be stripped before upstream send",
      ).toBe(true);
    },
  );
});

// ─── 4. FR must not merge with follow-up user text ─────────────────────────

describe("fix4: functionResponse must not share content with follow-up user text", () => {
  it(
    "OpenAI tool result + later user message stay in separate contents",
    () => {
      const out = T(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, {
        model: "gemini-3-flash-agent",
        messages: [
          { role: "user", content: "explain edit" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "ks6hht0n",
                type: "function",
                function: {
                  name: "Grep",
                  arguments: JSON.stringify({ pattern: "run_command" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "ks6hht0n",
            content: JSON.stringify({ matches: ["run_command"] }),
          },
          // User nags after empty stop (from the captured log)
          { role: "user", content: "tiếp đi" },
          { role: "user", content: "Tiếp tục đi bạn" },
        ],
      });

      expect(
        hasMixedFrAndText(out),
        "FR + user follow-up merged into one user content (normalizeGeminiContents)",
      ).toBe(false);

      const contents = out.request.contents;
      const frIdx = contents.findIndex((c) =>
        c.parts?.some((p) => p.functionResponse),
      );
      const textAfterFr = contents
        .slice(frIdx + 1)
        .some((c) => c.parts?.some((p) => p.text && !p.functionResponse));
      expect(frIdx).toBeGreaterThanOrEqual(0);
      expect(textAfterFr, "user follow-up should be after FR content").toBe(true);
    },
  );

  it(
    "Responses path: function_call_output + user_query not co-located with FR",
    () => {
      const out = T(FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, {
        model: "agy",
        stream: true,
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "explain" }],
          },
          {
            type: "function_call",
            call_id: "ks6hht0n",
            name: "Grep",
            arguments: JSON.stringify({ pattern: "run_command" }),
          },
          {
            type: "function_call_output",
            call_id: "ks6hht0n",
            output: JSON.stringify({ matches: ["x"] }),
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "tiếp đi" }],
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Tiếp tục đi bạn" }],
          },
        ],
      });

      expect(hasMixedFrAndText(out)).toBe(false);
    },
  );
});

// ─── 5. Logger must not redact max*Tokens ──────────────────────────────────

describe("fix5: requestLogger keeps maxOutputTokens readable", () => {
  const originalEnableRequestLogs = process.env.ENABLE_REQUEST_LOGS;
  const originalCwd = process.cwd;
  const tempRoot = path.join(process.cwd(), "tmp-request-logger-empty-stop");

  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    process.cwd = () => tempRoot;
  });

  afterEach(() => {
    process.env.ENABLE_REQUEST_LOGS = originalEnableRequestLogs;
    process.cwd = originalCwd;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it(
    "max_output_tokens and maxOutputTokens are not replaced with [REDACTED]",
    async () => {
      process.env.ENABLE_REQUEST_LOGS = "true";
      const { createRequestLogger } = await import(
        "../../open-sse/utils/requestLogger.js"
      );
      const logger = await createRequestLogger(
        "openai-responses",
        "antigravity",
        "gemini-3-flash-agent",
      );

      logger.logClientRawRequest(
        "/v1/responses",
        {
          model: "agy",
          max_output_tokens: 65535,
          reasoning: { effort: "high" },
          input: [],
        },
        { "content-type": "application/json" },
      );

      logger.logTargetRequest(
        "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
        { "content-type": "application/json" },
        {
          model: "gemini-3-flash-agent",
          request: {
            generationConfig: {
              maxOutputTokens: 65535,
              thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
            },
          },
        },
      );

      await logger.flush();

      const clientLog = JSON.parse(
        fs.readFileSync(path.join(logger.sessionPath, "1_req_client.json"), "utf8"),
      );
      expect(clientLog.body.max_output_tokens).toBe(65535);
      expect(clientLog.body.max_output_tokens).not.toBe("[REDACTED]");

      const targetLog = JSON.parse(
        fs.readFileSync(path.join(logger.sessionPath, "4_req_target.json"), "utf8"),
      );
      expect(targetLog.body.request.generationConfig.maxOutputTokens).toBe(65535);
      expect(targetLog.body.request.generationConfig.maxOutputTokens).not.toBe(
        "[REDACTED]",
      );
    },
  );
});