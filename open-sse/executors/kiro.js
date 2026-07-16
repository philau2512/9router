import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { randomUUID } from "crypto";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import {
  resolveKiroRequestProfileArn,
  buildKiroClientUserAgent,
} from "../config/kiroConstants.js";
import { fetchKiroProfileArn } from "../../src/lib/oauth/kiro-provider-helpers.js";

// Phase 2 hot-path: module-scope decoder/encoder reused across every frame and
// chunk. Frames are decoded as COMPLETE length-prefixed slices, so a shared
// non-streaming decoder is correct. Do NOT switch this to { stream: true } or
// share it across partial frames.
const _kiroDecoder = new TextDecoder("utf-8");
const _kiroEncoder = new TextEncoder();

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    // Client fidelity (Group A Phase 2): emulate a realistic Kiro IDE client so
    // a free-tier account is less likely to be flagged. The machineId is derived
    // (stable sha256 of a durable credential id) so this streaming call and the
    // model-listing call from the SAME account carry the IDENTICAL machineId —
    // never random (a per-request suffix would itself look anomalous).
    const ua = buildKiroClientUserAgent({ credentials, surface: "streaming" });
    const headers = {
      ...this.config.headers,
      "User-Agent": ua.streaming,
      "X-Amz-User-Agent": ua.short,
      "x-amzn-kiro-agent-mode": "vibe",
      // Opt out of CodeWhisperer telemetry/training data collection.
      "x-amzn-codewhisperer-optout": "true",
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": randomUUID(),
    };

    // API-key auth: key is stored as accessToken and sent as bearer, plus
    // `tokentype: API_KEY` so CodeWhisperer treats it as a long-lived key
    // rather than an OIDC token. External IdP needs TokenType=EXTERNAL_IDP.
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isApiKey = authMethod === "api_key";
    const isExternalIdp = authMethod === "external_idp";
    const apiKey =
      credentials?.apiKey || (isApiKey ? credentials?.accessToken : null);

    if (isApiKey && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["tokentype"] = "API_KEY";
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      if (isExternalIdp) {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    // Inject profileArn header, ENDPOINT-AWARE. The correct value depends on
    // which host this attempt targets (buildUrl stashes it on
    // credentials.__kiroResolvedUrl just before this runs):
    //   - kiro.dev surface  -> free-tier Builder ID needs the shared AAAA ARN
    //   - amazonaws surface -> free-tier Builder ID must OMIT the ARN
    // Sending the wrong one for the endpoint yields 400 (omit on kiro.dev) or
    // 403 (AAAA on amazonaws). Account-specific ARNs (idc/api_key) always win.
    const endpoint = credentials?.__kiroResolvedUrl;
    const profileArn = resolveKiroRequestProfileArn(credentials, { endpoint });
    if (profileArn) {
      headers["x-amzn-codewhisperer-profile-arn"] = profileArn;
    }

    return headers;
  }

  // Endpoint-aware body profileArn. The translator sets an initial value before
  // the fallback loop, but the correct value is endpoint-specific, so we
  // reconcile it here (transformRequest runs per-endpoint inside the loop).
  transformRequest(model, body, stream, credentials) {
    const endpoint = credentials?.__kiroResolvedUrl;
    const profileArn = resolveKiroRequestProfileArn(credentials, { endpoint });
    if (body && typeof body === "object") {
      if (profileArn) {
        body.profileArn = profileArn;
      } else {
        delete body.profileArn;
      }
    }
    return body;
  }

  /**
   * Override buildUrl to route CodeWhisperer-surface auth methods (api_key /
   * external_idp / idc) to *.amazonaws.com endpoints only, and regionalize
   * them when credentials.region differs from the hardcoded us-east-1 default.
   *
   * IAM Identity Center (idc) tokens are AWS SSO access tokens — the kiro.dev
   * gateway rejects them with 403 "bearer token invalid". They must hit the
   * CodeWhisperer surface and in the region the token was minted in.
   */
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isCodeWhispererSurface =
      authMethod === "api_key" ||
      authMethod === "external_idp" ||
      authMethod === "idc";

    if (isCodeWhispererSurface) {
      const region = (
        credentials?.providerSpecificData?.region || "us-east-1"
      ).trim();
      const regionalize = (u) =>
        region && region !== "us-east-1" && u.includes("amazonaws.com")
          ? u.replace(
              /([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/,
              `$1.${region}.amazonaws.com`,
            )
          : u;

      const baseUrls = this.getBaseUrls();
      const amazon = baseUrls
        .filter((u) => u.includes("amazonaws.com"))
        .map(regionalize);
      const others = baseUrls.filter((u) => !u.includes("amazonaws.com"));
      const ordered = amazon.length > 0 ? [...amazon, ...others] : baseUrls;
      const resolved = ordered[urlIndex] || ordered[0];
      // Stash the resolved URL on the (per-request) credentials so buildHeaders
      // and transformRequest can pick the endpoint-correct profileArn.
      if (credentials) credentials.__kiroResolvedUrl = resolved;
      return resolved;
    }

    const resolved = super.buildUrl(model, stream, urlIndex, credentials);
    // Same endpoint stash for the default (kiro.dev-first) surface, so
    // free-tier Builder ID sends the shared ARN on kiro.dev and omits it on
    // the amazonaws fallback hosts.
    if (credentials) credentials.__kiroResolvedUrl = resolved;
    return resolved;
  }

  /**
   * Kiro execute — delegate to BaseExecutor for endpoint fallback + retry, then
   * transform the binary AWS EventStream into OpenAI-shaped SSE on success.
   *
   * BaseExecutor.execute() walks config.baseUrls (runtime.us-east-1.kiro.dev →
   * codewhisperer → q) advancing to the next host on 429 (shouldRetry) and on
   * network/5xx errors, while tryRetry handles in-place retries per `retry: {429: 0}`.
   * Note: the baseUrls are alternate surfaces of one regional service, so rotation
   * is edge-level failover — it does not grant fresh 429 quota. Per-account 429
   * spreading is handled upstream by account rotation in sse/handlers/chat.js.
   *
   * Errors are returned untransformed so the upstream handler can read the body,
   * classify the status, and trigger account fallback/cooldown.
   */
  async execute(args) {
    const { credentials } = args;
    const authMethod = credentials?.providerSpecificData?.authMethod;

    // Dynamic profile ARN discovery (ported from Kiro-Go's ResolveProfileArn).
    //
    // Only ACCOUNT-BOUND methods (idc / api_key / external_idp) can resolve
    // their own ARN via ListAvailableProfiles. Free-tier Builder ID CANNOT —
    // that call returns 403 "AWS Builder ID is not supported for this
    // operation" (verified empirically) — so builder-id relies on the
    // endpoint-aware shared ARN in resolveKiroRequestProfileArn instead of
    // discovery. Social gets its ARN from the token-refresh response.
    const canDiscover =
      authMethod === "idc" ||
      authMethod === "api_key" ||
      authMethod === "external_idp";
    const needsDiscovery =
      !credentials?.providerSpecificData?.profileArn && canDiscover;
    if (needsDiscovery) {
      const callerRegion =
        credentials?.providerSpecificData?.region || "us-east-1";
      try {
        const discovered = await fetchKiroProfileArn(
          credentials.accessToken,
          callerRegion,
          args.proxyOptions || null,
        );
        if (discovered?.arn) {
          // Spread to avoid mutating the original reference — safe for retry logic
          credentials.providerSpecificData = {
            ...credentials.providerSpecificData,
            profileArn: discovered.arn,
            region: discovered.region,
          };
          // Persist so subsequent requests skip discovery (best-effort).
          if (typeof args.onProfileArnDiscovered === "function") {
            try {
              await args.onProfileArnDiscovered({
                profileArn: discovered.arn,
                region: discovered.region,
              });
            } catch {
              /* non-fatal */
            }
          }
        }
      } catch (err) {
        // Non-fatal: proceed without profileArn, let upstream return the error
        console.warn(
          `[Kiro] Profile ARN discovery failed for ${authMethod}: ${err.message}`,
        );
      }
    }

    const result = await super.execute(args);
    if (result?.response?.ok) {
      if (args.emitObjects) {
        // Phase 3 (option c) fused path: hand parsed OpenAI chunk OBJECTS to the
        // downstream translate layer instead of re-serializing to SSE bytes.
        // We DON'T consume/replace result.response.body with a byte transform;
        // we decode straight to an object-mode stream and expose it separately.
        // result.response is kept as a headers-only SSE placeholder so the
        // handler's content-type guard still sees text/event-stream (the raw
        // upstream body has now been consumed by the object decoder).
        result.kiroObjectStream = this.transformEventStreamToSSE(
          result.response,
          args.model,
          { emitObjects: true },
        );
        result.response = new Response(null, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: { "Content-Type": "text/event-stream" },
        });
      } else {
        result.response = this.transformEventStreamToSSE(
          result.response,
          args.model,
        );
      }
    }
    return result;
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout
   */
  transformEventStreamToSSE(response, model, { emitObjects = false } = {}) {
    // Phase 3 (option c) object hand-off: when emitObjects=true, emit parsed
    // OpenAI `chat.completion.chunk` OBJECTS directly (object-mode ReadableStream)
    // instead of serialized `data: {...}\n\n` bytes, and a final `{ done: true }`
    // sentinel instead of `data: [DONE]`. This lets the downstream translate layer
    // consume objects and skip the serialize->reparse round-trip (measured ~34-38%
    // of the OpenAI->Claude translate transform CPU). The byte path (emitObjects
    // =false, the default) is UNCHANGED and byte-identical — _frame/_doneFrame
    // collapse to exactly the previous `_kiroEncoder.encode(...)` expressions.
    const _frame = emitObjects
      ? (o) => o
      : (o) => _kiroEncoder.encode(`data: ${JSON.stringify(o)}\n\n`);
    const _doneFrame = emitObjects
      ? { done: true }
      : _kiroEncoder.encode("data: [DONE]\n\n");

    // Phase 2 hot-path: growable accumulator instead of a per-chunk
    // `new Uint8Array(remaining + chunk.length)` full-copy. We keep a backing
    // buffer with writePos/readOffset and only realloc/compact when the tail
    // has no room, turning the previous quadratic total copy into linear.
    let backing = new Uint8Array(16384);
    let writePos = 0; // bytes written into backing
    let readOffset = 0; // bytes already consumed by the parser
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const state = {
      endDetected: false,
      finishEmitted: false,
      doneEmitted: false,
      hasToolCalls: false,
      hasReasoningContent: false,
      reasoningChunkCount: 0,
      toolCallIndex: 0,
      seenToolIds: new Map(),
      totalContentLength: 0,
      contextUsagePercentage: 0,
      inThinking: false,
      // Feature 3 (ported from Kiro-Go): cumulative text normalization.
      // Kiro upstream sometimes sends CUMULATIVE content chunks where
      // chunk N = full text up to that point (not just the delta).
      // We track the last emitted content and reasoning text to detect
      // overlap and emit only the new delta portion.
      lastAssistantContent: "",
      lastReasoningContent: "",
    };

    // Ported from Kiro-Go normalizeChunk(): detect cumulative text and extract delta.
    // If chunk == previous text, return "" (duplicate). If chunk starts with
    // previous, return only the new suffix. If previous starts with chunk, it's
    // a late re-delivery — skip. Otherwise check for overlap and return the new part.
    function normalizeChunk(chunk, previous) {
      if (!chunk) return { text: "", updated: previous };
      if (!previous) return { text: chunk, updated: chunk };
      if (chunk === previous) return { text: "", updated: previous };
      if (chunk.startsWith(previous)) {
        return { text: chunk.slice(previous.length), updated: chunk };
      }
      if (previous.startsWith(chunk)) return { text: "", updated: previous };
      // Check suffix/prefix overlap. Only consider overlaps of 8+ chars to
      // avoid false positives on trivial single-char matches (e.g. a trailing
      // space matching the leading space of the next delta). Kiro cumulative
      // mode always has substantial overlap (dozens to hundreds of chars).
      const maxOverlap = Math.min(previous.length, chunk.length);
      for (let i = maxOverlap; i >= 8; i--) {
        if (previous.endsWith(chunk.slice(0, i))) {
          return { text: chunk.slice(i), updated: previous + chunk.slice(i) };
        }
      }
      // No meaningful overlap: treat as fresh delta
      return { text: chunk, updated: previous + chunk };
    }

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        // Append the incoming chunk into spare tail capacity. Only realloc/compact
        // when the tail can't hold it — amortized O(1) append instead of the old
        // per-chunk full-buffer copy.
        if (writePos + chunk.length > backing.length) {
          const remaining = writePos - readOffset;
          const needed = remaining + chunk.length;
          if (needed > backing.length) {
            // Grow: at least double, but always large enough for this chunk
            // (handles a single chunk larger than the whole current buffer).
            const newCap = Math.max(backing.length * 2, needed);
            const grown = new Uint8Array(newCap);
            if (remaining > 0)
              grown.set(backing.subarray(readOffset, writePos));
            backing = grown;
          } else if (remaining > 0) {
            // Fits after reclaiming the consumed prefix: compact in place once.
            backing.copyWithin(0, readOffset, writePos);
          }
          writePos = remaining;
          readOffset = 0;
        }
        backing.set(chunk, writePos);
        writePos += chunk.length;

        // Parse events from the unread region [readOffset, writePos)
        let iterations = 0;
        const maxIterations = 1000;
        while (writePos - readOffset >= 16 && iterations < maxIterations) {
          iterations++;
          const view = new DataView(
            backing.buffer,
            backing.byteOffset + readOffset,
          );
          const totalLength = view.getUint32(0, false);

          if (totalLength < 16 || totalLength > writePos - readOffset) break;

          const eventData = backing.subarray(
            readOffset,
            readOffset + totalLength,
          );
          readOffset += totalLength;

          const event = parseEventFrame(eventData);
          if (!event) continue;

          const eventType = event.headers[":event-type"] || "";

          // Track total content length for token estimation
          if (!state.totalContentLength) state.totalContentLength = 0;
          if (!state.contextUsagePercentage) state.contextUsagePercentage = 0;

          // Handle assistantResponseEvent

          if (
            eventType === "assistantResponseEvent" &&
            event.payload?.content
          ) {
            let content = event.payload.content;

            // Helper: emit thinking text extracted from <thinking> tags as reasoning_content
            function emitReasoningChunk(text) {
              if (!text) return;
              state.hasReasoningContent = true;
              state.totalContentLength += text.length;
              const reasoningDelta =
                state.reasoningChunkCount === 0 && chunkIndex === 0
                  ? { role: "assistant", reasoning_content: text }
                  : { reasoning_content: text };
              const reasoningChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  { index: 0, delta: reasoningDelta, finish_reason: null },
                ],
              };
              chunkIndex++;
              state.reasoningChunkCount++;
              controller.enqueue(_frame(reasoningChunk));
            }
            // Kiro model "auto" leaks <thinking>...</thinking> blocks into the
            // assistantResponseEvent content stream. Strip the tags and re-emit
            // the thinking text as delta.reasoning_content so downstream
            // openai-to-claude translator surfaces it as a Claude thinking block.
            if (state.inThinking) {
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const parts = content.split("</thinking>");
                const thinkingText = parts[0];
                const after = parts.slice(1).join("</thinking>");
                if (thinkingText) emitReasoningChunk(thinkingText);
                content = after.startsWith("\n") ? after.substring(1) : after;
              } else {
                emitReasoningChunk(content);
                content = "";
              }
            } else if (content.includes("<thinking>")) {
              state.inThinking = true;
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const before = content.split("<thinking>")[0];
                const inner = content
                  .split("<thinking>")[1]
                  .split("</thinking>")[0];
                const after = content
                  .split("</thinking>")
                  .slice(1)
                  .join("</thinking>");
                if (inner) emitReasoningChunk(inner);
                content =
                  before +
                  (after.startsWith("\n") ? after.substring(1) : after);
              } else {
                const before = content.split("<thinking>")[0];
                const inner = content.split("<thinking>")[1];
                if (inner) emitReasoningChunk(inner);
                content = before;
              }
            }

            if (!content) {
              // Nothing left to emit as regular content after stripping thinking
              continue;
            }

            // Feature 3: normalize cumulative text (Kiro-Go port).
            // Kiro upstream may send chunk N as the FULL text up to that point.
            // normalizeChunk extracts only the new delta portion.
            const norm = normalizeChunk(content, state.lastAssistantContent);
            state.lastAssistantContent = norm.updated;
            content = norm.text;
            if (!content) continue;

            state.totalContentLength += content.length;

            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta:
                    chunkIndex === 0
                      ? { role: "assistant", content }
                      : { content },
                  finish_reason: null,
                },
              ],
            };
            chunkIndex++;
            controller.enqueue(_frame(chunk));
          }

          // Handle reasoningContentEvent (Kiro thinking / reasoning)
          // Kiro returns reasoning as a separate event when the request system
          // prompt contains <thinking_mode>enabled</thinking_mode>. Surface it
          // as OpenAI delta.reasoning_content so downstream translators can map
          // it back to Claude thinking blocks / Anthropic reasoning, etc.
          if (eventType === "reasoningContentEvent") {
            const reasoning =
              event.payload?.reasoningContentEvent || event.payload || {};
            const reasoningText =
              typeof reasoning === "string"
                ? reasoning
                : reasoning.text || reasoning.content || "";
            if (reasoningText) {
              state.hasReasoningContent = true;
              state.totalContentLength += reasoningText.length;

              const reasoningDelta =
                state.reasoningChunkCount === 0 && chunkIndex === 0
                  ? { role: "assistant", reasoning_content: reasoningText }
                  : { reasoning_content: reasoningText };

              const chunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: reasoningDelta,
                    finish_reason: null,
                  },
                ],
              };
              chunkIndex++;
              state.reasoningChunkCount++;
              controller.enqueue(_frame(chunk));
            }
          }

          // Handle codeEvent
          if (eventType === "codeEvent" && event.payload?.content) {
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: event.payload.content },
                  finish_reason: null,
                },
              ],
            };
            chunkIndex++;
            controller.enqueue(_frame(chunk));
          }

          // Handle toolUseEvent
          if (eventType === "toolUseEvent" && event.payload) {
            state.hasToolCalls = true;
            const toolUse = event.payload;
            const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

            for (const singleToolUse of toolUses) {
              const toolCallId =
                singleToolUse.toolUseId || `call_${Date.now()}`;
              const toolName = singleToolUse.name || "";
              const toolInput = singleToolUse.input;

              let toolIndex;
              const isNewTool = !state.seenToolIds.has(toolCallId);

              if (isNewTool) {
                toolIndex = state.toolCallIndex++;
                state.seenToolIds.set(toolCallId, toolIndex);

                const startChunk = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        ...(chunkIndex === 0 ? { role: "assistant" } : {}),
                        tool_calls: [
                          {
                            index: toolIndex,
                            id: toolCallId,
                            type: "function",
                            function: {
                              name: toolName,
                              arguments: "",
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                chunkIndex++;
                controller.enqueue(_frame(startChunk));
              } else {
                toolIndex = state.seenToolIds.get(toolCallId);
              }

              if (toolInput !== undefined) {
                let argumentsStr;

                if (typeof toolInput === "string") {
                  argumentsStr = toolInput;
                } else if (typeof toolInput === "object") {
                  argumentsStr = JSON.stringify(toolInput);
                } else {
                  continue;
                }

                const argsChunk = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: toolIndex,
                            function: {
                              arguments: argumentsStr,
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                chunkIndex++;
                controller.enqueue(_frame(argsChunk));
              }
            }
          }

          // Handle messageStopEvent
          if (eventType === "messageStopEvent" && !state.finishEmitted) {
            state.finishEmitted = true;

            if (!state.usage) {
              const estimatedOutputTokens =
                state.totalContentLength > 0
                  ? Math.max(1, Math.floor(state.totalContentLength / 4))
                  : 0;

              const estimatedInputTokens =
                state.contextUsagePercentage > 0
                  ? Math.floor((state.contextUsagePercentage * 200000) / 100)
                  : 0;

              state.usage = {
                prompt_tokens: estimatedInputTokens,
                completion_tokens: estimatedOutputTokens,
                total_tokens: estimatedInputTokens + estimatedOutputTokens,
              };
            }

            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
                },
              ],
            };

            if (state.usage) {
              chunk.usage = state.usage;
            }

            controller.enqueue(_frame(chunk));

            if (!state.doneEmitted) {
              controller.enqueue(_doneFrame);
              state.doneEmitted = true;
            }
          }

          // Handle contextUsageEvent to extract contextUsagePercentage
          if (
            eventType === "contextUsageEvent" &&
            event.payload?.contextUsagePercentage
          ) {
            state.contextUsagePercentage = event.payload.contextUsagePercentage;
            // Mark that we received context usage event
            state.hasContextUsage = true;
          }

          // Handle meteringEvent - mark that we received it
          if (eventType === "meteringEvent") {
            state.hasMeteringEvent = true;
          }

          // Handle metricsEvent for token usage
          if (eventType === "metricsEvent") {
            // Extract usage data from metricsEvent payload
            const metrics = event.payload?.metricsEvent || event.payload;
            if (metrics && typeof metrics === "object") {
              const inputTokens = metrics.inputTokens || 0;
              const outputTokens = metrics.outputTokens || 0;
              // ponytail: Amazon Q upstream does not expose cache fields today,
              // but pick up cache_read_input_tokens / cache_creation_input_tokens
              // if the event shape grows them so cost tracking stays accurate.
              const cachedTokens =
                metrics.cacheReadInputTokens ||
                metrics.cache_read_input_tokens ||
                0;
              const cacheCreationInputTokens =
                metrics.cacheCreationInputTokens ||
                metrics.cache_creation_input_tokens ||
                0;

              if (inputTokens > 0 || outputTokens > 0) {
                state.usage = {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                };
                // Kiro is Claude-backed: inputTokens EXCLUDES cache (Claude convention),
                // not inclusive like OpenAI's cached_tokens. Emit cache_read_input_tokens
                // (not cached_tokens) so canonicalizeUsage takes the Claude fold path.
                if (cachedTokens > 0)
                  state.usage.cache_read_input_tokens = cachedTokens;
                if (cacheCreationInputTokens > 0)
                  state.usage.cache_creation_input_tokens =
                    cacheCreationInputTokens;
              }
            }
          }

          // Emit final chunk only after receiving BOTH meteringEvent AND contextUsageEvent
          if (
            state.hasMeteringEvent &&
            state.hasContextUsage &&
            !state.finishEmitted
          ) {
            state.finishEmitted = true;

            // Estimate tokens if not available from events
            if (!state.usage) {
              // Estimate output tokens from content length
              const estimatedOutputTokens =
                state.totalContentLength > 0
                  ? Math.max(1, Math.floor(state.totalContentLength / 4))
                  : 0;

              // Estimate input tokens from contextUsagePercentage
              // Kiro models typically have 200k context window
              const estimatedInputTokens =
                state.contextUsagePercentage > 0
                  ? Math.floor((state.contextUsagePercentage * 200000) / 100)
                  : 0;

              state.usage = {
                prompt_tokens: estimatedInputTokens,
                completion_tokens: estimatedOutputTokens,
                total_tokens: estimatedInputTokens + estimatedOutputTokens,
              };
            }

            const finishChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
                },
              ],
            };

            // Include usage in final chunk if available
            if (state.usage) {
              finishChunk.usage = state.usage;
            }

            controller.enqueue(_frame(finishChunk));
          }
        }

        if (iterations >= maxIterations) {
          console.warn("[Kiro] Max iterations reached in event parsing");
        }
      },

      flush(controller) {
        // Tool-bearing Kiro streams may end after the tool event without a
        // messageStopEvent. They are complete tool turns, not resumable errors.
        if (!state.finishEmitted) {
          if (!state.hasToolCalls) {
            controller.error(
              new Error(
                "Upstream connection closed unexpectedly without messageStopEvent",
              ),
            );
            return;
          }
          state.finishEmitted = true;
          const finishChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "tool_calls",
              },
            ],
          };
          if (state.usage) finishChunk.usage = state.usage;
          controller.enqueue(_frame(finishChunk));
        }

        // Send final done message
        if (!state.doneEmitted) {
          controller.enqueue(_doneFrame);
          state.doneEmitted = true;
        }
      },
    });

    // Pipe response body through transform stream
    if (!response.body) {
      // Object mode: an empty object stream that emits only the done sentinel.
      if (emitObjects) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ done: true });
            controller.close();
          },
        });
      }
      return new Response("data: [DONE]\n\n", {
        status: response.status,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    const transformedStream = response.body.pipeThrough(transformStream);

    // Object mode: return the raw object-mode ReadableStream (not a Response —
    // objects can't ride in a Response body). The caller pipes it through the
    // object-input translate transform. See handleStreamingResponse.
    if (emitObjects) {
      return transformedStream;
    }

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions,
        true,
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data) {
  try {
    const view = new DataView(data.buffer, data.byteOffset);
    const headersLength = view.getUint32(4, false);

    // Parse headers
    const headers = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset];
      offset++;
      if (offset + nameLen > data.length) break;

      const name = _kiroDecoder.decode(data.subarray(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) {
        // String type
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        const value = _kiroDecoder.decode(
          data.subarray(offset, offset + valueLen),
        );
        offset += valueLen;
        headers[name] = value;
      } else {
        break;
      }
    }

    // Parse payload
    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4; // Exclude message CRC

    let payload = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = _kiroDecoder.decode(
        data.subarray(payloadStart, payloadEnd),
      );

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }

      try {
        payload = JSON.parse(payloadStr);
      } catch (parseError) {
        // Log parse error for debugging
        console.warn(
          `[Kiro] Failed to parse payload: ${parseError.message} | payload: ${payloadStr.substring(0, 100)}`,
        );
        payload = { raw: payloadStr };
      }
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

export default KiroExecutor;
