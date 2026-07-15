/**
 * History compaction — token-aware (byok-style).
 * Summarizes head of history when estimated tokens exceed 70% of contextWindow.
 */
const { loadContext, saveContext } = require("./store");
const { chatOnce } = require("../stream/openaiChat");
const { log, err } = require("../../logger");

/**
 * Estimate tokens: 1 token ≈ 4 chars (conservative GPT heuristic).
 * Also counts tool_call JSON payloads.
 */
function estimateTokens(messages) {
  let n = 0;
  for (const m of messages || []) {
    n += Math.ceil(String(m.content || "").length / 4);
    if (m.tool_calls) n += Math.ceil(JSON.stringify(m.tool_calls).length / 4);
    if (m.role === "tool") n += Math.ceil(String(m.content || "").length / 4);
  }
  return n;
}

/**
 * Keep a safe tail that doesn't break tool_call/tool_result pairs.
 * Returns messages starting from first non-tool boundary in tail.
 */
function safeTail(messages, targetCount) {
  if (!messages || messages.length <= targetCount) return messages || [];
  let start = messages.length - targetCount;
  while (start < messages.length) {
    const m = messages[start];
    if (m.role !== "tool") break;
    start++;
  }
  return messages.slice(start);
}

async function maybeCompact(conversationId, opts = {}) {
  const ctx = loadContext(conversationId);
  const messages = ctx.messages || [];
  if (messages.length < 16) return false;

  // Token-based threshold (byok uses contextWindowTokens * 0.7)
  const budget = Math.max(16000, opts.contextWindowTokens > 0 ? opts.contextWindowTokens : 120000);
  const tokens = estimateTokens(messages);
  const tooManyMessages = messages.length > 60;
  const tooManyTokens = tokens > budget * 0.7;
  if (!tooManyMessages && !tooManyTokens) return false;

  log(
    `compaction start conversation=${conversationId} messages=${messages.length} ~tokens=${tokens} budget=${budget}`,
  );

  // Keep last 8 messages safe; summarize everything before
  const keepTail = safeTail(messages, 8);
  const toSummarize = messages.slice(0, messages.length - keepTail.length);
  const transcript = toSummarize
    .map((m) => `${m.role}: ${String(m.content || "").slice(0, 2000)}`)
    .join("\n")
    .slice(0, 60000);

  let summary = "[Earlier conversation compacted — key decisions, file paths, and unfinished tasks preserved below.]";
  try {
    const result = await chatOnce({
      model: opts.routerModel || "default",
      messages: [
        {
          role: "system",
          content: "Summarize this agent conversation for continuity. Include: key decisions, file paths modified, completed tasks, unfinished work, and any important variables/values. Max 600 words. Be precise.",
        },
        { role: "user", content: transcript },
      ],
      maxCompletionTokens: 1000,
      openAIEndpoint: opts.openAIEndpoint,
      reasoningEffort: "low",
    });
    if (result?.content) summary = result.content;
  } catch (e) {
    err(`compaction summarize failed: ${e.message}`);
  }

  ctx.messages = [
    {
      role: "system",
      content: `<compacted_history>\n${summary}\n</compacted_history>`,
      at: new Date().toISOString(),
    },
    ...keepTail,
  ];
  ctx.status = "idle";
  saveContext(conversationId, ctx);
  log(`compaction done conversation=${conversationId} kept=${ctx.messages.length} summarized=${toSummarize.length}`);
  return true;
}

module.exports = { maybeCompact, estimateTokens };
