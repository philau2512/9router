import { detectFormat, getTargetFormat } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import {
  getModelTargetFormat,
  getModelStrip,
  getModelUpstreamId,
  getModelType,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";
import {
  createErrorResult,
  parseUpstreamError,
  formatProviderError,
} from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import {
  trackPendingRequest,
  appendRequestLog,
  saveRequestDetail,
} from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import {
  buildRequestDetail,
  extractRequestConfig,
} from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import {
  handleStreamingResponse,
  buildOnStreamComplete,
} from "./chatCore/streamingHandler.js";
import {
  detectClientTool,
  isNativePassthrough,
} from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import {
  compressWithHeadroom,
  formatHeadroomLog,
  formatHeadroomSizeLog,
  isHeadroomPhantomSavings,
} from "../rtk/headroom.js";
import { extractThinking } from "../translator/concerns/thinkingUnified.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import {
  getAntigravitySessionKey,
  getCachedThinking,
  setCachedThinking,
  injectThinkingReplay,
} from "../utils/antigravityReasoningReplay.js";
import { stripOrphanedToolResults } from "../translator/concerns/toolCall.js";
import { compressWithPxpipe, formatPxpipeLog } from "../rtk/pxpipe.js";
import { decideSoftRetry } from "../services/accountFallback.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";

function maskLoggedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onProfileArnDiscovered,
  onRequestSuccess,
  onDisconnect,
  clientRawRequest,
  connectionId,
  userAgent,
  apiKey,
  ccFilterNaming,
  rtkEnabled,
  headroomEnabled,
  headroomUrl,
  headroomCompressUserMessages,
  cavemanEnabled,
  cavemanLevel,
  midStreamResumeEnabled,
  sourceFormatOverride,
  providerThinking,
  // PxPipe multimodal compression params (P10d, upstream dcf1927f2)
  pxpipeEnabled = false,
  pxpipeMinChars,
  pxpipeTimeoutMs,
  pxpipeTransform,
  onPxpipeEvent,
  timing = null,
  clientSignal = null,
}) {
  const { provider, model } = modelInfo;
  const requestStartTime = timing?.requestStartTime || Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Resolve session tag for unified request lifecycle logging (a625ea9fd).
  // Additive — does not replace existing log calls.
  const sessionSeed = (() => {
    try {
      return resolveSessionId({
        headers: clientRawRequest?.headers,
        body,
        connectionId,
        scope: provider,
      });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession
    ? log.tagForSession(sessionSeed)
    : log?.nextTag
      ? log.nextTag()
      : "";

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(
    body,
    model,
    userAgent,
    ccFilterNaming,
  );
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);
  const stripList = getModelStrip(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  // Antigravity reasoning replay: inject cached thinking into last assistant turn (Phase 5)
  if (provider === "antigravity" && body?.request?.contents) {
    const _replayKey = getAntigravitySessionKey(model, body);
    const _cachedThinking = _replayKey ? getCachedThinking(_replayKey) : null;
    if (_cachedThinking) body = injectThinkingReplay(body, _cachedThinking);
  }

  const clientRequestedStreaming =
    body.stream === true ||
    sourceFormat === FORMATS.ANTIGRAVITY ||
    sourceFormat === FORMATS.GEMINI ||
    sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming =
    provider === "openai" || provider === "codex" || provider === "commandcode";
  let stream = providerRequiresStreaming ? true : body.stream !== false;

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel =
    modelType === "image" || /image|imagen|image-generation/i.test(model);
  if (
    isImageGenModel &&
    (provider === "antigravity" || provider === "gemini-cli")
  ) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (
    clientPrefersJson &&
    !clientPrefersSSE &&
    body.stream !== true &&
    !providerRequiresStreaming
  ) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(
    sourceFormat,
    targetFormat,
    model,
  );
  if (clientRawRequest)
    reqLogger.logClientRawRequest(
      clientRawRequest.endpoint,
      clientRawRequest.body,
      clientRawRequest.headers,
    );
  reqLogger.logRawRequest(body);
  log?.debug?.(
    "FORMAT",
    `${sourceFormat} → ${targetFormat} | stream=${stream}`,
  );

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Strip orphaned tool results before translation for non-Kiro paths.
  // Kiro has its own reconcileOrphanedToolResults inside openai-to-kiro.js.
  // Dangling tool results from client-side history compaction cause HTTP 400
  // on strict upstreams (Anthropic, Gemini). Port of upstream PR #2298.
  if (targetFormat !== FORMATS.KIRO) {
    stripOrphanedToolResults(body);
  }

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  // Upstream decolua: strip + optional remote image prefetch for non-passthrough paths.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.(
        "MODALITY",
        `stripped unsupported media for ${provider}/${model}`,
      );
    }
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, {
        signal: undefined,
      });
      if (n > 0) {
        log?.debug?.(
          "MODALITY",
          `prefetched ${n} remote image(s) for ${targetFormat}`,
        );
      }
    } catch (e) {
      log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`);
    }
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.(
      "PASSTHROUGH",
      `${clientTool} → ${provider} | native lossless`,
    );
    translatedBody = { ...body, model };
  } else {
    translatedBody = translateRequest(
      sourceFormat,
      targetFormat,
      model,
      body,
      stream,
      credentials,
      provider,
      reqLogger,
      stripList,
      connectionId,
      clientTool,
    );
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(
        HTTP_STATUS.BAD_REQUEST,
        `Failed to translate request for ${sourceFormat} → ${targetFormat}`,
      );
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = model;
  }

  // Unified ▶ request summary line — correlates all lifecycle logs by session tag.
  // Additive: COLORS/formatRtkLog imports are kept below. See upstream a625ea9fd.
  if (log?.line) {
    try {
      const clientModel =
        clientRawRequest?.body?.model || `${provider}/${model}`;
      const msgN =
        translatedBody.messages?.length || body.messages?.length || 0;
      const toolN = translatedBody.tools?.length || body.tools?.length || 0;
      const fmtStr = passthrough
        ? `FMT:${sourceFormat}(pass)`
        : `FMT:${sourceFormat}→${targetFormat}`;
      const think = log.fmtThink?.(extractThinking(translatedBody));
      const acc = credentials?.connectionName || "-";
      const parts = [
        `POST ${clientModel} → ${provider}/${model}`,
        fmtStr,
        stream ? "STREAM" : "JSON",
        `${msgN}MSG`,
      ];
      if (toolN) parts.push(`${toolN}TOOL`);
      if (think) parts.push(`THINK:${think}`);
      parts.push(`ACC:${acc}`);
      log.line(reqTag, "▶", parts.join(" · "));
    } catch {
      /* never crash on logging */
    }
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.(
        "TOOLDEDUP",
        `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`,
      );
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Headroom: compress messages via external proxy when configured (fail-open)
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, {
    enabled: headroomEnabled,
    url: headroomUrl,
    model,
    format: finalFormat,
    compressUserMessages: headroomCompressUserMessages,
    diagnostics: headroomDiagnostics,
  });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.(
      "HEADROOM",
      `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`,
    );
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.(
        "HEADROOM",
        `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${headroomSizeLine}`,
      );
    }
  } else if (headroomEnabled) {
    log?.warn?.(
      "HEADROOM",
      `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`,
    );
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(
      (msg) => msg.role !== "tool",
    );
    delete translatedBody.tools;
  }

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // PxPipe: multimodal prompt compression (upstream dcf1927f2).
  // Runs after RTK, before dispatch. Additive — placeholder until P10 is fully wired.
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    try {
      const pxpipeResult = await compressWithPxpipe(translatedBody, {
        enabled: true,
        format: finalFormat,
        model,
        minChars: pxpipeMinChars,
        timeoutMs: pxpipeTimeoutMs,
        transform: pxpipeTransform,
      });
      pxpipeSummary = pxpipeResult.summary;
      if (pxpipeResult.body) translatedBody = pxpipeResult.body;
      const pxpipeLine = formatPxpipeLog(pxpipeSummary);
      if (pxpipeLine) log?.info?.("PXPIPE", pxpipeLine);
      try {
        onPxpipeEvent?.({ provider, model, ...pxpipeSummary });
      } catch {
        /* stats must not break requests */
      }
    } catch (e) {
      log?.debug?.("PXPIPE", `error: ${e?.message}`);
    }
  }
  // PxPipe summary wired into sharedCtx so requestDetail builders can include compression stats.

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(
    () => {},
  );

  const msgCount =
    translatedBody.messages?.length ||
    translatedBody.input?.length ||
    translatedBody.contents?.length ||
    translatedBody.request?.contents?.length ||
    0;
  log?.debug?.(
    "REQUEST",
    `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`,
  );

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log,
    provider,
    model,
    clientSignal,
  });

  const proxyOptions = {
    connectionProxyEnabled:
      credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl:
      credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy:
      credentials?.providerSpecificData?.connectionNoProxy || "",
    connectionProxyHeadersTimeoutMs:
      credentials?.providerSpecificData?.connectionProxyHeadersTimeoutMs,
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName =
      credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId =
      credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.debug?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${maskLoggedUrl(proxyOptions.vercelRelayUrl)}`,
    );
  } else if (
    proxyOptions.connectionProxyEnabled &&
    proxyOptions.connectionProxyUrl
  ) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId =
      credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName =
      credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`,
    );
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName =
      credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`,
    );
  }

  // Phase 3 (option c) fused path: for a STREAMING Kiro request that needs
  // translation (dominant traffic: Claude/other client through Kiro→OpenAI),
  // ask the executor to hand off parsed OpenAI objects instead of re-serialized
  // SSE bytes, skipping the downstream serialize→reparse hop. sourceFormat is
  // the client format, targetFormat the provider format; needsTranslation is
  // simply sourceFormat !== targetFormat. Non-streaming / same-format / non-Kiro
  // requests are unaffected (emitObjects stays false → byte path).
  const wantKiroObjects =
    provider === "kiro" && stream && sourceFormat !== targetFormat;

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  let providerObjectStream = null;
  // Reusable executor invocation (same credential) — used for the initial call,
  // the 401/403 refresh-retry, and the Phase 2 soft-rate-limit instant-retry.
  const runExecutor = () =>
    executor.execute({
      model,
      body: translatedBody,
      stream,
      credentials,
      signal: streamController.signal,
      log,
      proxyOptions,
      emitObjects: wantKiroObjects,
      onProfileArnDiscovered,
    });
  try {
    if (timing && !timing.upstreamFetchStartedAt) {
      timing.upstreamFetchStartedAt = Date.now();
    }
    const result = await runExecutor();
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerObjectStream = result.kiroObjectStream || null;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);

    const isTimeout = error.name === "TimeoutError" || error.status === 504;
    const status = isTimeout
      ? 504
      : error.name === "AbortError"
        ? 499
        : HTTP_STATUS.BAD_GATEWAY;

    appendRequestLog({
      model,
      provider,
      connectionId,
      status: `FAILED ${status}`,
    }).catch(() => {});
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: translatedBody || null,
        response: {
          error: error.message || String(error),
          status,
          thinking: null,
        },
        status: "error",
      }),
    ).catch(() => {});

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, status);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(status, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (
    !executor.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    try {
      const newCredentials = await refreshWithRetry(
        () => executor.refreshCredentials(credentials, log, proxyOptions),
        3,
        log,
      );
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try {
            await onCredentialsRefreshed(newCredentials);
          } catch (e) {
            log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`);
          }
        }
        try {
          const retryResult = await executor.execute({
            model,
            body: translatedBody,
            stream,
            credentials,
            signal: streamController.signal,
            log,
            proxyOptions,
            emitObjects: wantKiroObjects,
            onProfileArnDiscovered,
          });
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
            providerObjectStream = retryResult.kiroObjectStream || null;
          }
        } catch {
          log?.warn?.(
            "TOKEN",
            `${provider.toUpperCase()} | retry after refresh failed`,
          );
        }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.(
        "TOKEN",
        `${provider.toUpperCase()} | refresh threw: ${e.message}`,
      );
    }
  }

  // Phase 2: soft-rate-limit instant-retry-same-auth. A 429 whose reset window
  // is within SOFT_RATE_LIMIT_THRESHOLD_MS (~5s) is a brief throttle: retry the
  // SAME credential after a short capped wait instead of cooling it down and
  // rotating accounts. Hard/long 429s (quota exhausted, multi-hour resets) skip
  // this and fall through to the normal error path so the caller rotates auth.
  {
    let softRetryCount = 0;
    while (!providerResponse.ok && providerResponse.status === 429) {
      // Peek the error on a clone so the original body stays readable for the
      // final error path if we decide not to retry.
      let peeked;
      try {
        peeked = await parseUpstreamError(providerResponse.clone(), executor);
      } catch {
        break;
      }
      const decision = decideSoftRetry(
        peeked.statusCode,
        {
          message: peeked.message,
          resetsAtMs: peeked.resetsAtMs,
          headers: providerResponse.headers,
        },
        softRetryCount,
      );
      if (decision.action !== "retry-same-auth") break;
      softRetryCount++;
      log?.warn?.(
        "RATELIMIT",
        `${provider.toUpperCase()} | soft 429, instant retry #${softRetryCount} in ${decision.waitMs}ms (same auth)`,
      );
      if (decision.waitMs > 0) {
        await new Promise((r) => setTimeout(r, decision.waitMs));
      }
      try {
        const r = await runExecutor();
        providerResponse = r.response;
        providerUrl = r.url;
        providerHeaders = r.headers;
        finalBody = r.transformedBody;
        providerObjectStream = r.kiroObjectStream || null;
      } catch (e) {
        log?.warn?.(
          "RATELIMIT",
          `${provider.toUpperCase()} | soft-retry threw: ${e.message}`,
        );
        break;
      }
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(
      providerResponse,
      executor,
    );
    appendRequestLog({
      model,
      provider,
      connectionId,
      status: `FAILED ${statusCode}`,
    }).catch(() => {});
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        response: { error: message, status: statusCode, thinking: null },
        status: "error",
      }),
    ).catch(() => {});

    const errMsg = formatProviderError(
      new Error(message),
      provider,
      model,
      statusCode,
    );
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = {
    provider,
    model,
    body,
    stream,
    translatedBody,
    finalBody,
    requestStartTime,
    connectionId,
    apiKey,
    clientRawRequest,
    onRequestSuccess,
    midStreamResumeEnabled,
    // PxPipe compression stats — included so requestDetail builders can persist them.
    pxpipe: pxpipeSummary || undefined,
  };
  const appendLog = (extra) =>
    appendRequestLog({ model, provider, connectionId, ...extra }).catch(
      () => {},
    );
  const trackDone = () =>
    trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      trackDone,
      appendLog,
    });
    if (result) {
      streamController.handleComplete();
      return result;
    }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat,
      reqLogger,
      toolNameMap,
      trackDone,
      appendLog,
    });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete: _baseOnStreamComplete, streamDetailId } =
    buildOnStreamComplete({
      ...sharedCtx,
      timing,
    });
  const _agReplayKey =
    provider === "antigravity" ? getAntigravitySessionKey(model, body) : null;
  const onStreamComplete = _agReplayKey
    ? (contentObj, usage, ttftAt, streamDetailId) => {
        if (contentObj?.thinking)
          setCachedThinking(_agReplayKey, contentObj.thinking);
        return _baseOnStreamComplete?.(
          contentObj,
          usage,
          ttftAt,
          streamDetailId,
        );
      }
    : _baseOnStreamComplete;
  return handleStreamingResponse({
    ...sharedCtx,
    providerResponse,
    sourceFormat,
    targetFormat,
    userAgent,
    reqLogger,
    toolNameMap,
    streamController,
    onStreamComplete,
    credentials,
    timing,
    streamDetailId,
    // Phase 3 (option c): non-null only for streaming Kiro+translate (fused path).
    kiroObjectStream: providerObjectStream,
  });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
