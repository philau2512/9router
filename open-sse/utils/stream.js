import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import {
  extractUsage,
  mergeUsage,
  hasValidUsage,
  estimateUsage,
  logUsage,
  addBufferToUsage,
  filterUsageForFormat,
  COLORS,
} from "./usageTracking.js";
import {
  parseSSELine,
  hasValuableContent,
  fixInvalidId,
  formatSSE,
} from "./streamHelpers.js";
import {
  getOpenAIResponsesEventName,
  isOpenAIResponsesTerminalEvent,
  formatIncompleteOpenAIResponsesStreamFailure,
  createOutputItemCollector,
  collectOutputItemDone,
  patchCompletedOutput,
} from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import * as log from "../../src/sse/utils/logger.js";

export { COLORS, formatSSE };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate", // Full translation between formats
  PASSTHROUGH: "passthrough", // No translation, normalize output, extract usage
};

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
    streamStateTracker = null,
    targetModelAlias = null,
    // Phase 3 (option c) object hand-off: when true, transform() receives
    // already-parsed OpenAI chunk OBJECTS (from Kiro's object-mode decode) plus a
    // final { done: true } sentinel, instead of raw SSE bytes. It skips
    // decode/line-split/JSON.parse and feeds each object straight into the SAME
    // translate pipeline (translateOneEvent) the byte path uses — so every
    // translate-branch side effect (usage injection, [DONE] handling, message_stop
    // flush) is preserved identically. Only valid with mode=TRANSLATE.
    objectInput = false,
    // Phase 4 (Option A): the inline armStall/onUpstreamFirstByte/onClearStall
    // hooks were never wired by any caller (always null in production) — the
    // real stall reset lives in pipeWithDisconnect's upstreamStallTap. Dead
    // plumbing removed. Do NOT re-add here; stall detection belongs at the
    // upstream-byte layer, not the SSE-output transform.
  } = options;

  let buffer = "";
  let usage = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const resumedAfterAntigravityThought =
    targetFormat === FORMATS.ANTIGRAVITY &&
    Boolean(streamStateTracker?.accumulatedThinking) &&
    !streamStateTracker?.accumulatedContent;
  const state =
    mode === STREAM_MODE.TRANSLATE
      ? {
          ...initState(sourceFormat),
          provider,
          toolNameMap,
          model,
          geminiSawThought: resumedAfterAntigravityThought,
        }
      : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let firstRawChunkLogged = false;
  let firstParsedEventLogged = false;
  let firstEmittedChunkAt = null;
  let firstEmittedChunkBytes = 0;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};
  const streamStartAt = Date.now();
  const emitFirstChunkLog = (output, meta = {}) => {
    if (firstEmittedChunkAt) return;
    firstEmittedChunkAt = Date.now();
    firstEmittedChunkBytes = sharedEncoder.encode(output || "").byteLength;
    log.debug(
      "SSE-FIRST",
      `${provider || "unknown"}/${model || "unknown"} | mode=${mode} | firstEmitMs=${firstEmittedChunkAt - streamStartAt}ms | bytes=${firstEmittedChunkBytes}${meta.kind ? ` | kind=${meta.kind}` : ""}`,
    );
  };
  // rawChunkEncoder removed — use sharedEncoder (module-level)

  const updateTracker = () => {
    if (streamStateTracker) {
      streamStateTracker.accumulatedContent = accumulatedContent;
      streamStateTracker.accumulatedThinking = accumulatedThinking;
      streamStateTracker.totalContentLength = totalContentLength;
      streamStateTracker.inThinking =
        accumulatedThinking.length > 0 && accumulatedContent.length === 0;
    }
  };

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false; // track duplicate [DONE] across transform + flush
  const outputItemCollector = createOutputItemCollector(); // Phase 4: Codex output reconstruction

  // Translate a single already-parsed event object into client-format SSE bytes.
  // Shared by the byte line-loop (after parseSSELine) AND the Phase 3 object-input
  // fast path, so all translate-branch side effects run once, identically, in
  // both modes. `parsed` may be a provider chunk object or the { done: true }
  // sentinel. Returns nothing; enqueues to `controller`.
  const translateOneEvent = (parsed, controller) => {
    if (!firstParsedEventLogged) {
      firstParsedEventLogged = true;
      log.debug(
        "SSE-FIRST",
        `${provider || "unknown"}/${model || "unknown"} | mode=${mode} | firstEvent=${parsed.type || parsed.event || "unknown"}`,
      );
    }

    // Responses API same-format passthrough: preserve event framing + track terminal state
    const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
    const keepsOpenAIResponsesFormat =
      isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
    const openAIResponsesEventName = isOpenAIResponsesStream
      ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed)
      : null;

    if (
      isOpenAIResponsesStream &&
      isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)
    ) {
      openAIResponsesTerminalSeen = true;
    }

    // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
    // For other formats: done=true is the [DONE] sentinel, skip
    if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
      // Synthesize response.failed if the Responses stream never sent a terminal event
      if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
        const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
        reqLogger?.appendConvertedChunk?.(failedOutput);
        controller.enqueue(sharedEncoder.encode(failedOutput));
        openAIResponsesTerminalSeen = true;
        sseEmittedCount++;
      }

      // [DONE] not emitted in translate mode — some clients' SSE decoders
      // fail to parse the OpenAI sentinel on Claude-format translated streams.
      // message_stop already signals end-of-response; stream close handles it.
      streamDoneSent = true;
      return;
    }

    // Claude format - content
    if (parsed.delta?.text) {
      totalContentLength += parsed.delta.text.length;
      accumulatedContent += parsed.delta.text;
    }
    // Claude format - thinking
    if (parsed.delta?.thinking) {
      totalContentLength += parsed.delta.thinking.length;
      accumulatedThinking += parsed.delta.thinking;
    }

    // OpenAI format - content
    if (parsed.choices?.[0]?.delta?.content) {
      totalContentLength += parsed.choices[0].delta.content.length;
      accumulatedContent += parsed.choices[0].delta.content;
    }
    // OpenAI format - reasoning
    if (parsed.choices?.[0]?.delta?.reasoning_content) {
      totalContentLength += parsed.choices[0].delta.reasoning_content.length;
      accumulatedThinking += parsed.choices[0].delta.reasoning_content;
    }

    // Gemini format
    if (parsed.candidates?.[0]?.content?.parts) {
      for (const part of parsed.candidates[0].content.parts) {
        if (part.text && typeof part.text === "string") {
          totalContentLength += part.text.length;
          if (part.thought === true) {
            accumulatedThinking += part.text;
          } else {
            accumulatedContent += part.text;
          }
        }
      }
    }

    // Extract usage
    const extracted = extractUsage(parsed);
    if (extracted) state.usage = mergeUsage(state.usage, extracted); // Keep original usage for logging

    // Codex output_item.done reconstruction (Phase 4)
    if (
      keepsOpenAIResponsesFormat &&
      parsed.type === "response.output_item.done"
    ) {
      collectOutputItemDone(outputItemCollector, parsed);
    }
    if (keepsOpenAIResponsesFormat && parsed.type === "response.completed") {
      const patched = patchCompletedOutput(parsed, outputItemCollector);
      if (patched !== parsed) {
        const output = formatSSE(
          {
            event: openAIResponsesEventName || "response.completed",
            data: patched,
          },
          sourceFormat,
        );
        reqLogger?.appendConvertedChunk?.(output);
        controller.enqueue(sharedEncoder.encode(output));
        currentOpenAIResponsesEvent = null;
        sseEmittedCount++;
        return;
      }
    }

    // Responses same-format passthrough: re-emit with original event framing
    if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
      const output = formatSSE(
        { event: openAIResponsesEventName, data: parsed },
        sourceFormat,
      );
      reqLogger?.appendConvertedChunk?.(output);
      controller.enqueue(sharedEncoder.encode(output));
      currentOpenAIResponsesEvent = null;
      sseEmittedCount++;
      return;
    }

    currentOpenAIResponsesEvent = null;

    // Translate: targetFormat -> openai -> sourceFormat
    const translated = translateResponse(
      targetFormat,
      sourceFormat,
      parsed,
      state,
    );

    // Log OpenAI intermediate chunks (if available)
    if (translated?._openaiIntermediate) {
      for (const item of translated._openaiIntermediate) {
        const openaiOutput = formatSSE(item, FORMATS.OPENAI);
        reqLogger?.appendOpenAIChunk?.(openaiOutput);
      }
    }

    if (translated?.length > 0) {
      for (const item of translated) {
        if (item === null || item === undefined) continue;
        if (!hasValuableContent(item, sourceFormat)) continue;

        // Inject estimated usage if finish chunk has no valid usage
        const isFinishChunk =
          item.type === "message_delta" || item.choices?.[0]?.finish_reason;
        if (
          state.finishReason &&
          isFinishChunk &&
          !hasValidUsage(item.usage) &&
          totalContentLength > 0
        ) {
          const estimated = estimateUsage(
            body,
            totalContentLength,
            sourceFormat,
          );
          item.usage = filterUsageForFormat(estimated, sourceFormat);
          state.usage = estimated;
        } else if (state.finishReason && isFinishChunk && state.usage) {
          const buffered = addBufferToUsage(state.usage);
          item.usage = filterUsageForFormat(buffered, sourceFormat);
        }

        const output = formatSSE(item, sourceFormat);
        reqLogger?.appendConvertedChunk?.(output);
        emitFirstChunkLog(output, { kind: item.type || "translated" });
        controller.enqueue(sharedEncoder.encode(output));
        sseEmittedCount++;
      }
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();

      // Phase 3 (option c) object-input fast path: `chunk` is an already-parsed
      // OpenAI event object (or { done: true }) handed off directly by Kiro's
      // object-mode decode. Skip decode/line-split/JSON.parse and translate it
      // through the exact same pipeline as the byte path.
      if (objectInput) {
        if (isDebugEnabled) sseLineCount++;
        translateOneEvent(chunk, controller);
        updateTracker();
        return;
      }

      const text = decoder.decode(chunk, { stream: true });
      if (!firstRawChunkLogged) {
        firstRawChunkLogged = true;
        log.debug(
          "SSE-FIRST",
          `${provider || "unknown"}/${model || "unknown"} | mode=${mode} | firstRawMs=${Date.now() - streamStartAt}ms | bytes=${sharedEncoder.encode(text).byteLength}`,
        );
      }
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      // Phase 5(a): iterate complete lines via indexOf instead of allocating a
      // whole lines[] array from split("\n") each chunk. The partial-line carry
      // is preserved (the incomplete trailing segment stays in `buffer`) and
      // lines are processed strictly in order, so a Responses `event:` line is
      // still seen before its paired `data:` line within the same chunk.
      let lineStart = 0;
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n", lineStart)) !== -1) {
        const line = buffer.slice(lineStart, nlIdx);
        lineStart = nlIdx + 1;
        const trimmed = line.trim();
        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        // Capture Responses API event name to preserve framing in same-format passthrough
        if (
          mode === STREAM_MODE.TRANSLATE &&
          targetFormat === FORMATS.OPENAI_RESPONSES &&
          trimmed.startsWith("event:")
        ) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          // Upstream-emitted [DONE] (e.g. Kiro's own transform emits it): forward
          // once and mark it sent so flush() does not append a SECOND [DONE].
          // (Red Team S3 / Phase 3 double-DONE fix)
          if (
            trimmed.startsWith("data:") &&
            trimmed.slice(5).trim() === "[DONE]"
          ) {
            if (!streamDoneSent) {
              const doneOutput = "data: [DONE]\n\n";
              reqLogger?.appendConvertedChunk?.(doneOutput);
              controller.enqueue(sharedEncoder.encode(doneOutput));
              streamDoneSent = true;
            }
            continue;
          }

          let output;
          let injectedUsage = false;

          // Fast-path: forward raw SSE without JSON.parse for pure delta chunks
          // Conservative heuristics — false positive = falls through to full parse
          if (
            trimmed.startsWith("data:") &&
            trimmed.slice(5).trim() !== "[DONE]"
          ) {
            const dataStr = trimmed.slice(5).trim();
            // ORDERING MATTERS: Azure fields must be checked before hasContent (R2-F8)
            const needsFullParse =
              dataStr.includes('"finish_reason"') ||
              dataStr.includes('"prompt_filter_results"') ||
              dataStr.includes('"content_filter_results"') || // Azure — before hasContent (R2-F8)
              dataStr.includes('"usage"') ||
              dataStr.includes('"id":"'); // tighter than '"id":' to avoid content false positives (R2-F7)

            if (!needsFullParse) {
              const hasContent =
                dataStr.includes('"content":') ||
                dataStr.includes('"reasoning_content":');

              if (!hasContent) {
                updateTracker();
                continue; // empty delta — skip (F7)
              }

              // Track reasoning for semantic stall watchdog (F3)
              if (
                dataStr.includes('"reasoning_content":') &&
                streamStateTracker
              ) {
                streamStateTracker.inThinking = true;
              }

              // Rough token estimate only — no regex content extraction (F6)
              // accumulatedContent not populated from fast-path (R2-F6 trade-off)
              totalContentLength += Math.ceil(dataStr.length / 4);
              updateTracker(); // F10 + R2-F2

              const fastOutput =
                line.startsWith("data:") && !line.startsWith("data: ")
                  ? "data: " + line.slice(5) + "\n"
                  : line + "\n";

              emitFirstChunkLog(fastOutput, { kind: "passthrough-fast" }); // R2-F1
              reqLogger?.appendConvertedChunk?.(fastOutput);
              controller.enqueue(sharedEncoder.encode(fastOutput));
              sseEmittedCount++;
              continue;
            }
          }

          if (
            trimmed.startsWith("data:") &&
            trimmed.slice(5).trim() !== "[DONE]"
          ) {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) {
                  parsed.object = "chat.completion.chunk";
                  fieldsInjected = true;
                }
                if (!parsed.created) {
                  parsed.created = Math.floor(Date.now() / 1000);
                  fieldsInjected = true;
                }
              }

              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                }
              }

              // Rewrite model alias so client receives the alias they requested (Phase 2)
              if (
                targetModelAlias &&
                parsed.model &&
                parsed.model !== targetModelAlias
              ) {
                parsed.model = targetModelAlias;
                fieldsInjected = true;
              }
              if (
                targetModelAlias &&
                parsed.response?.model &&
                parsed.response.model !== targetModelAlias
              ) {
                parsed.response = {
                  ...parsed.response,
                  model: targetModelAlias,
                };
                fieldsInjected = true;
              }

              // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
              // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
              // every streaming delta. @ai-sdk/openai-compatible checks
              // `delta.tool_calls != null` — an empty array passes this check,
              // causing premature `reasoning-end` on every chunk.
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (
                    choice.delta?.tool_calls &&
                    Array.isArray(choice.delta.tool_calls) &&
                    choice.delta.tool_calls.length === 0
                  ) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }

              if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              const reasoning = delta?.reasoning_content;
              if (content && typeof content === "string") {
                totalContentLength += content.length;
                accumulatedContent += content;
              }
              if (reasoning && typeof reasoning === "string") {
                totalContentLength += reasoning.length;
                accumulatedThinking += reasoning;
              }

              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = mergeUsage(usage, extracted);
              }

              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                const estimated = estimateUsage(
                  body,
                  totalContentLength,
                  FORMATS.OPENAI,
                );
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                usage = estimated;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch {
              // Skip non-JSON data lines silently — don't forward garbage to clients.
              // Upstream providers sometimes return plain-text errors (HTML, rate-limit
              // messages) in the SSE stream that would break downstream JSON decoders.
              continue;
            }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          emitFirstChunkLog(output, { kind: "passthrough-full" }); // R2-F1
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          updateTracker(); // R2-F2
          continue;
        }

        // Translate mode
        if (!trimmed) continue;
        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;
        // Shared translate pipeline (also used by the Phase 3 object-input path).
        translateOneEvent(parsed, controller);
      }
      // Keep only the incomplete trailing segment (after the last newline) for
      buffer = lineStart > 0 ? buffer.slice(lineStart) : buffer;
      updateTracker();
    },

    flush(controller) {
      const evtSummary =
        Object.entries(eventTypeCounts)
          .map(([k, v]) => `${k}=${v}`)
          .join(",") || "none";
      dbg(
        "SSE",
        `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`,
      );
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }

          // IMPORTANT: Enqueue [DONE] sentinel FIRST — before any heavy logging.
          // Clients (e.g. OpenClaw) can hang without it.
          if (!streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }

          // Defer heavy operations (usage estimation, DB writes) to next tick
          // so the stream closes immediately for the client.
          const _usage = usage;
          const _body = body;
          const _totalContentLength = totalContentLength;
          const _accumulatedContent = accumulatedContent;
          const _accumulatedThinking = accumulatedThinking;
          const _ttftAt = ttftAt;
          setImmediate(() => {
            let finalUsage = _usage;
            if (!hasValidUsage(finalUsage) && _totalContentLength > 0) {
              finalUsage = estimateUsage(
                _body,
                _totalContentLength,
                FORMATS.OPENAI,
              );
            }
            if (hasValidUsage(finalUsage)) {
              logUsage(provider, finalUsage, model, connectionId, apiKey);
            } else {
              appendRequestLog({
                model,
                provider,
                connectionId,
                tokens: null,
                status: "200 OK",
              }).catch(() => {});
            }
            if (onStreamComplete) {
              onStreamComplete(
                {
                  content: _accumulatedContent,
                  thinking: _accumulatedThinking,
                },
                finalUsage,
                _ttftAt,
              );
            }
          });
          return;
        }

        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const translated = translateResponse(
              targetFormat,
              sourceFormat,
              parsed,
              state,
            );

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                if (item === null || item === undefined) continue;
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                emitFirstChunkLog(output, {
                  kind: item.type || "flush-translated",
                });
                controller.enqueue(sharedEncoder.encode(output));
              }
            }
          }
        }

        const flushed = translateResponse(
          targetFormat,
          sourceFormat,
          null,
          state,
        );

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            if (item === null || item === undefined) continue;
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            emitFirstChunkLog(output, { kind: item.type || "tail-translated" });
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        const keepsOpenAIResponsesFormat =
          targetFormat === FORMATS.OPENAI_RESPONSES &&
          sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        // [DONE] not emitted in plain translate mode — message_stop already signals end-of-stream.
        // OpenAI Responses format (Codex) clients still need [DONE] for protocol compatibility.
        if (keepsOpenAIResponsesFormat && !openAIResponsesDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
        }

        // Defer heavy operations (usage estimation, DB writes) to next tick
        const _state = state;
        const _body = body;
        const _totalContentLength = totalContentLength;
        const _accumulatedContent = accumulatedContent;
        const _accumulatedThinking = accumulatedThinking;
        const _ttftAt = ttftAt;
        setImmediate(() => {
          if (!hasValidUsage(_state?.usage) && _totalContentLength > 0) {
            _state.usage = estimateUsage(
              _body,
              _totalContentLength,
              sourceFormat,
            );
          }
          if (hasValidUsage(_state?.usage)) {
            logUsage(
              _state.provider || targetFormat,
              _state.usage,
              model,
              connectionId,
              apiKey,
            );
          } else {
            appendRequestLog({
              model,
              provider,
              connectionId,
              tokens: null,
              status: "200 OK",
            }).catch(() => {});
          }
          if (onStreamComplete) {
            onStreamComplete(
              { content: _accumulatedContent, thinking: _accumulatedThinking },
              _state?.usage,
              _ttftAt,
            );
          }
        });
      } catch (error) {
        console.log("Error in flush:", error);
      }
    },
  });
}

export function createSSETransformStreamWithLogger(
  targetFormat,
  sourceFormat,
  provider = null,
  reqLogger = null,
  toolNameMap = null,
  model = null,
  connectionId = null,
  body = null,
  onStreamComplete = null,
  apiKey = null,
  streamStateTracker = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    streamStateTracker,
  });
}

// Phase 3 (option c): object-input translate transform. Consumes Kiro's
// object-mode decode output (parsed OpenAI chunk objects + { done: true }) and
// emits client-format SSE bytes, skipping the serialize->reparse round-trip.
// Same signature/semantics as createSSETransformStreamWithLogger, just objectInput.
export function createObjectTranslateStreamWithLogger(
  targetFormat,
  sourceFormat,
  provider = null,
  reqLogger = null,
  toolNameMap = null,
  model = null,
  connectionId = null,
  body = null,
  onStreamComplete = null,
  apiKey = null,
  streamStateTracker = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    objectInput: true,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    streamStateTracker,
  });
}

export function createPassthroughStreamWithLogger(
  provider = null,
  reqLogger = null,
  model = null,
  connectionId = null,
  body = null,
  onStreamComplete = null,
  apiKey = null,
  streamStateTracker = null,
  targetModelAlias = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    streamStateTracker,
    targetModelAlias,
  });
}
