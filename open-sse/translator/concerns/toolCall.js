import {
  ensureToolCallIds,
  fixMissingToolResponses,
} from "../helpers/toolCallHelper.js";

export { ensureToolCallIds, fixMissingToolResponses };

/**
 * Strip orphaned tool results from a request body before upstream dispatch.
 *
 * When client-side history compaction removes an assistant turn containing
 * tool calls but keeps the corresponding tool results, strict APIs like
 * Anthropic and Gemini reject the request with HTTP 400.
 *
 * Handles two wire formats:
 *   - OpenAI Chat Completions: role:"tool" messages matched by tool_call_id
 *   - Anthropic Messages: content[type=tool_result] blocks matched by tool_use_id
 *
 * NOTE: Kiro path is handled separately by reconcileOrphanedToolResults()
 * in openai-to-kiro.js — do not call this for Kiro targets.
 *
 * Port of upstream PR #2298.
 *
 * @param {object} body - Request body (mutated in place for efficiency)
 * @returns {object} body (same reference)
 */
export function stripOrphanedToolResults(body) {
  if (!body?.messages || !Array.isArray(body.messages)) return body;

  // Phase 1: Collect all live tool-call IDs from assistant messages only.
  // Gate to role === "assistant" to avoid false positives from user messages
  // that happen to contain tool_use blocks (e.g. Anthropic vision payloads).
  const liveIds = new Set();
  for (const msg of body.messages) {
    if (msg?.role !== "assistant") continue;

    // OpenAI Chat format: assistant.tool_calls[].id
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id) liveIds.add(tc.id);
      }
    }

    // Anthropic format: assistant.content[type=tool_use].id
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_use" && block.id) liveIds.add(block.id);
      }
    }
  }

  // No tool calls in history at all — nothing to orphan
  if (liveIds.size === 0) return body;

  // Phase 2: Remove orphaned references
  const cleaned = [];
  let removed = 0;

  for (const msg of body.messages) {
    // OpenAI Chat: role:"tool" messages matched by tool_call_id
    if (msg.role === "tool") {
      if (liveIds.has(msg.tool_call_id)) {
        cleaned.push(msg);
      } else {
        removed++;
      }
      continue;
    }

    // Anthropic: user messages may contain tool_result content blocks
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const filteredContent = msg.content.filter((block) => {
        if (block?.type !== "tool_result") return true;
        if (liveIds.has(block.tool_use_id)) return true;
        removed++;
        return false;
      });

      if (filteredContent.length === 0 && msg.content.length > 0) {
        // Entire user message was only orphaned tool results — drop the message
        removed++;
        continue;
      }

      cleaned.push(
        filteredContent.length === msg.content.length
          ? msg
          : { ...msg, content: filteredContent },
      );
      continue;
    }

    cleaned.push(msg);
  }

  if (removed > 0) {
    body.messages = cleaned;
  }

  return body;
}
