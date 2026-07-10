import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { randomUUID } from "crypto";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { resolveKiroRequestProfileArn } from "../config/kiroConstants.js";
import { fetchKiroProfileArn } from "../../src/lib/oauth/kiro-provider-helpers.js";

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": randomUUID(),
    };

    const authMethod = credentials?.providerSpecificData?.authMethod;

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      // Enterprise / Microsoft Entra (external_idp) tokens require TokenType header
      // so CodeWhisperer binds the request to the correct profile.
      if (authMethod === "external_idp") {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    // Inject profileArn header. Resolution is centralized in
    // resolveKiroRequestProfileArn: account-bound methods send their own ARN
    // (or nothing, letting the token use its default profile); free-tier
    // Builder ID / social send the shared default and NEVER an account-specific
    // ARN that leaked into storage — that mismatch is what triggers
    // 403 "User is not authorized to make this call."
    const profileArn = resolveKiroRequestProfileArn(credentials);
    if (profileArn) {
      headers["x-amzn-codewhisperer-profile-arn"] = profileArn;
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
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
      return ordered[urlIndex] || ordered[0];
    }

    return super.buildUrl(model, stream, urlIndex, credentials);
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

    // IDC tokens may not carry profileArn when provisioned cross-region.
    // Discover and inject the ARN before building headers for the request.
    // Port of upstream PR #2355.
    if (authMethod === "idc" && !credentials?.providerSpecificData?.profileArn) {
      const callerRegion =
        credentials?.providerSpecificData?.region || "us-east-1";
      try {
        const discovered = await fetchKiroProfileArn(
          credentials.accessToken,
          callerRegion,
        );
        if (discovered?.arn) {
          // Spread to avoid mutating the original reference — safe for retry logic
          credentials.providerSpecificData = {
            ...credentials.providerSpecificData,
            profileArn: discovered.arn,
            region: discovered.region,
          };
        }
      } catch (err) {
        // Non-fatal: proceed without profileArn, let upstream return the error
        console.warn(`[Kiro] IDC profile ARN discovery failed: ${err.message}`);
      }
    }

    const result = await super.execute(args);
    if (result?.response?.ok) {
      result.response = this.transformEventStreamToSSE(
        result.response,
        args.model,
      );
    }
    return result;
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout
   */
  transformEventStreamToSSE(response, model) {
    let buffer = new Uint8Array(0);
    let readOffset = 0;
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
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        // Tối ưu hóa: Dọn dẹp buffer đã đọc và ghép nối chunk mới
        const remainingLength = buffer.length - readOffset;
        const newBuffer = new Uint8Array(remainingLength + chunk.length);
        if (remainingLength > 0) {
          newBuffer.set(buffer.subarray(readOffset));
        }
        newBuffer.set(chunk, remainingLength);
        buffer = newBuffer;
        readOffset = 0;

        // Parse events from buffer
        let iterations = 0;
        const maxIterations = 1000;
        while (buffer.length - readOffset >= 16 && iterations < maxIterations) {
          iterations++;
          const view = new DataView(
            buffer.buffer,
            buffer.byteOffset + readOffset,
          );
          const totalLength = view.getUint32(0, false);

          if (totalLength < 16 || totalLength > buffer.length - readOffset)
            break;

          const eventData = buffer.subarray(
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
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify(reasoningChunk)}\n\n`,
                ),
              );
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
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
            );
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
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
              );
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
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
            );
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
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(startChunk)}\n\n`,
                  ),
                );
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
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(argsChunk)}\n\n`,
                  ),
                );
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

            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
            );

            if (!state.doneEmitted) {
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
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
              const cachedTokens = metrics.cacheReadInputTokens || metrics.cache_read_input_tokens || 0;
              const cacheCreationInputTokens = metrics.cacheCreationInputTokens || metrics.cache_creation_input_tokens || 0;

              if (inputTokens > 0 || outputTokens > 0) {
                state.usage = {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                };
                // Kiro is Claude-backed: inputTokens EXCLUDES cache (Claude convention),
                // not inclusive like OpenAI's cached_tokens. Emit cache_read_input_tokens
                // (not cached_tokens) so canonicalizeUsage takes the Claude fold path.
                if (cachedTokens > 0) state.usage.cache_read_input_tokens = cachedTokens;
                if (cacheCreationInputTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationInputTokens;
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

            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(finishChunk)}\n\n`,
              ),
            );
          }
        }

        if (iterations >= maxIterations) {
          console.warn("[Kiro] Max iterations reached in event parsing");
        }
      },

      flush(controller) {
        // If upstream disconnects before sending messageStopEvent, it's a premature close.
        // Throw an error so streamHandler's transparent mid-stream resume can kick in.
        if (!state.finishEmitted) {
          controller.error(
            new Error(
              "Upstream connection closed unexpectedly without messageStopEvent",
            ),
          );
          return;
        }

        // Send final done message
        if (!state.doneEmitted) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          state.doneEmitted = true;
        }
      },
    });

    // Pipe response body through transform stream
    if (!response.body) {
      return new Response("data: [DONE]\n\n", {
        status: response.status,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    const transformedStream = response.body.pipeThrough(transformStream);

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

      const name = new TextDecoder().decode(
        data.slice(offset, offset + nameLen),
      );
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) {
        // String type
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        const value = new TextDecoder().decode(
          data.slice(offset, offset + valueLen),
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
      const payloadStr = new TextDecoder().decode(
        data.slice(payloadStart, payloadEnd),
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
