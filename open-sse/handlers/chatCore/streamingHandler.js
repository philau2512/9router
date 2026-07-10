import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import {
  createSSETransformStreamWithLogger,
  createPassthroughStreamWithLogger,
} from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import {
  buildRequestDetail,
  extractRequestConfig,
  saveUsageStats,
} from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import * as log from "../../../src/sse/utils/logger.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({
  provider,
  sourceFormat,
  targetFormat,
  userAgent,
  reqLogger,
  toolNameMap,
  model,
  connectionId,
  body,
  onStreamComplete,
  apiKey,
  streamStateTracker,
  targetModelAlias = null,
  armStall = null,
  onUpstreamFirstByte = null,
  onClearStall = null,
}) {
  const isDroidCLI =
    userAgent?.toLowerCase().includes("droid") ||
    userAgent?.toLowerCase().includes("codex-cli");
  const needsCodexTranslation =
    provider === "codex" &&
    targetFormat === FORMATS.OPENAI_RESPONSES &&
    !isDroidCLI;

  if (needsCodexTranslation) {
    let codexTarget;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES)
      codexTarget = FORMATS.OPENAI_RESPONSES;
    else if (sourceFormat === FORMATS.CLAUDE) codexTarget = FORMATS.CLAUDE;
    else if (
      sourceFormat === FORMATS.ANTIGRAVITY ||
      sourceFormat === FORMATS.GEMINI ||
      sourceFormat === FORMATS.GEMINI_CLI
    )
      codexTarget = FORMATS.ANTIGRAVITY;
    else codexTarget = FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      codexTarget,
      provider,
      reqLogger,
      toolNameMap,
      model,
      connectionId,
      body,
      onStreamComplete,
      apiKey,
      streamStateTracker,
    );
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(
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
    );
  }

  return createPassthroughStreamWithLogger(
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    streamStateTracker,
    targetModelAlias,
    armStall,
    onUpstreamFirstByte,
    onClearStall,
  );
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({
  providerResponse,
  provider,
  model,
  sourceFormat,
  targetFormat,
  userAgent,
  body,
  stream,
  translatedBody,
  finalBody,
  requestStartTime,
  connectionId,
  apiKey,
  clientRawRequest,
  onRequestSuccess,
  reqLogger,
  toolNameMap,
  streamController,
  onStreamComplete,
  credentials,
  midStreamResumeEnabled,
  timing,
  streamDetailId,
}) {
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch((err) => {
        console.error(
          "[ChatCore] onRequestSuccess failed:",
          err?.message || err,
        );
      });
  }

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim.
  const upstreamContentType = (providerResponse.headers?.get("content-type") || "").toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes("text/event-stream") && !upstreamContentType.includes("application/json")) {
    const bodyText = await providerResponse.text().catch(() => "");
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || "").replace(/<[^>]*>/g, "").replace(/[\r\n]+/g, " ").trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, "").trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.status || 502;
    console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    };
  }

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough =
    sourceFormat === FORMATS.OPENAI_RESPONSES &&
    targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough
    ? buildAbortedResponsesTerminalBytes
    : null;
  // Per-provider stall timeout override (e.g. Qoder reasoning models need 120s)
  const stallTimeoutMs =
    PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;

  // Track accumulated content for semantic stall detection and mid-stream resume
  const streamStateTracker = {
    accumulatedContent: "",
    accumulatedThinking: "",
    totalContentLength: 0,
  };

  // streamDetailId is generated by buildOnStreamComplete so both the
  // placeholder write (0 tokens) and final write (real usage) share the
  // same id and the ON CONFLICT(id) upsert merges them into one row.
  const wrappedOnStreamComplete = (contentObj, usage, ttftAt) =>
    onStreamComplete?.(contentObj, usage, ttftAt, streamDetailId);

  const targetModelAlias =
    typeof body?.model === "string" && body.model !== model ? body.model : null;
  const transformStream = buildTransformStream({
    provider,
    sourceFormat,
    targetFormat,
    userAgent,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete: wrappedOnStreamComplete,
    apiKey,
    streamStateTracker,
    targetModelAlias,
  });

  const resumeCtx = midStreamResumeEnabled
    ? {
        body,
        provider,
        model,
        credentials,
        sourceFormat,
        targetFormat,
        userAgent,
        apiKey,
        connectionId,
        toolNameMap,
        reqLogger,
        clientRawRequest,
      }
    : null;

  const transformedBody = pipeWithDisconnect(
    providerResponse,
    transformStream,
    streamController,
    onAbortTerminal,
    streamStateTracker,
    timing,
    stallTimeoutMs,
    model,
    provider,
    resumeCtx,
  );

  setImmediate(() => {
    saveRequestDetail(
      buildRequestDetail(
        {
          provider,
          model,
          connectionId,
          latency: { ttft: 0, total: Date.now() - requestStartTime },
          tokens: { prompt_tokens: 0, completion_tokens: 0 },
          request: extractRequestConfig(body, stream),
          providerRequest: finalBody || translatedBody || null,
          providerResponse: "[Streaming - raw response not captured]",
          response: {
            content: "[Streaming in progress...]",
            thinking: null,
            type: "streaming",
          },
          status: "success",
        },
        { id: streamDetailId },
      ),
    ).catch((err) => {
      console.error(
        "[RequestDetail] Failed to save streaming request:",
        err.message,
      );
    });
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS }),
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({
  provider,
  model,
  connectionId,
  apiKey,
  requestStartTime,
  body,
  stream,
  finalBody,
  translatedBody,
  clientRawRequest,
  timing,
}) {
  // Generate a shared id so the placeholder row (0 tokens) and the final row
  // (real usage) target the same DB record via ON CONFLICT(id) upsert.
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const onStreamComplete = (contentObj, usage, ttftAt, sharedStreamDetailId) => {
    const resolvedId = sharedStreamDetailId ?? streamDetailId;
    const total = Date.now() - requestStartTime;
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : total,
      total,
    };
    // R2-F6: distinguish fast-path PASSTHROUGH (no accumulatedContent) from truly empty
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    if (timing) {
      log.ttft(`${provider.toUpperCase()} | ${model}`, {
        total,
        ttft: latency.ttft,
        parse: timing.requestParsedAt
          ? timing.requestParsedAt - requestStartTime
          : undefined,
        authModel: timing.requestReadyAt
          ? timing.requestReadyAt - requestStartTime
          : undefined,
        upstreamStart: timing.upstreamFetchStartedAt
          ? timing.upstreamFetchStartedAt - requestStartTime
          : undefined,
        upstreamFirstByte: timing.upstreamFirstByteAt
          ? timing.upstreamFirstByteAt - requestStartTime
          : undefined,
        clientFirstChunk: timing.clientFirstChunkAt
          ? timing.clientFirstChunkAt - requestStartTime
          : undefined,
      });
    }

    saveRequestDetail(
      buildRequestDetail(
        {
          provider,
          model,
          connectionId,
          latency,
          tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
          request: extractRequestConfig(body, stream),
          providerRequest: finalBody || translatedBody || null,
          providerResponse: safeContent,
          response: {
            content: safeContent,
            thinking: safeThinking,
            type: "streaming",
          },
          status: "success",
        },
        resolvedId ? { id: resolvedId } : {},
      ),
    ).catch((err) => {
      console.error(
        "[RequestDetail] Failed to update streaming content:",
        err.message,
      );
    });

    saveUsageStats({
      provider,
      model,
      tokens: usage,
      connectionId,
      apiKey,
      endpoint: clientRawRequest?.endpoint,
      label: "STREAM USAGE",
    });
  };

  return { onStreamComplete, streamDetailId };
}
