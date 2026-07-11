// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done", // Upstream fix from open-sse commit a9785a5f7
  "response.failed",
  "error",
]);

export function getOpenAIResponsesEventName(eventName, chunk) {
  if (eventName) return eventName;
  if (chunk && typeof chunk.type === "string") return chunk.type;
  return null;
}

export function isOpenAIResponsesTerminalEvent(eventName, chunk) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_TERMINAL_EVENTS.has(type)) return true;
  const status = chunk?.response?.status;
  return status === "completed" || status === "failed";
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(
    `${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`,
  );
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure() {
  return formatSSE(
    {
      event: "response.failed",
      data: {
        type: "response.failed",
        response: {
          id: `resp_${Date.now()}`,
          status: "failed",
          error: {
            type: "stream_error",
            code: "stream_disconnected",
            message: "stream closed before response.completed",
          },
        },
      },
    },
    FORMATS.OPENAI_RESPONSES,
  );
}

// Codex output_item.done reconstruction (Phase 4)
// Codex streams may emit response.output_item.done events while leaving
// response.completed.response.output empty. Collect and patch on completion.

export function createOutputItemCollector() {
  return { byIndex: new Map(), fallback: [] };
}

export function collectOutputItemDone(collector, eventData) {
  const item = eventData?.item;
  if (!item) return;
  const idx = eventData?.output_index;
  if (typeof idx === "number") {
    collector.byIndex.set(idx, item);
  } else {
    collector.fallback.push(item);
  }
}

export function patchCompletedOutput(completedData, collector) {
  if (!collector) return completedData;
  const output = completedData?.response?.output;
  if (Array.isArray(output) && output.length > 0) return completedData;
  if (collector.byIndex.size === 0 && collector.fallback.length === 0)
    return completedData;
  const sorted = [...collector.byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, item]) => item);
  const items = [...sorted, ...collector.fallback];
  return {
    ...completedData,
    response: { ...completedData.response, output: items },
  };
}
