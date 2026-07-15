/**
 * Core agent loop: history → /v1 chat → project AgentServerMessage frames.
 * Tools via execBridge; compaction when context large.
 */
const { streamChatCompletions } = require("../stream/openaiChat");
const { compilePrompt } = require("../prompt/compile");
const {
  appendMessage,
  projectOpenAIMessages,
  loadContext,
  saveContext,
} = require("../history/store");
const { maybeCompact } = require("../history/compaction");
const {
  resolveRouterModel,
  findModelEntry,
} = require("../../config/modelMap");
const { loadConfig } = require("../../config/loadConfig");
const {
  encodeTextDelta,
  encodeThinkingDelta,
  encodeHeartbeat,
  encodeTurnEnded,
  encodeAskQuestionInteractionQuery,
} = require("../proto/agentMessages");
const {
  publishToolStart,
  publishToolComplete,
} = require("../tools/execBridge");
const {
  extractConversationStateContext,
  formatWorkspaceContext,
} = require("./workspaceContext");
const { loadUserRules } = require("./userRules");
const { log, err } = require("../../logger");

/**
 * @param {object} stream ActiveStream
 * @param {object} intent { conversationId, userText, modelId, mode, prewarm }
 */
async function driveProvider(stream, intent) {
  if (intent.prewarm) {
    stream.publish(encodeHeartbeat());
    stream.publish(encodeTurnEnded({}));
    return;
  }

  const cfg = loadConfig();
  const conversationId =
    intent.conversationId || stream.requestId || "default";
  const mode = intent.mode || "agent";
  const modelEntry = findModelEntry(intent.modelId, cfg);
  const routerModel =
    modelEntry?.routerModel || resolveRouterModel(intent.modelId, cfg);
  let reasoningEffort =
    modelEntry?.reasoningEffort || intent.thinkingEffort || "";
  if (!reasoningEffort && String(intent.modelId || "").includes(":")) {
    reasoningEffort = String(intent.modelId).split(":")[1] || "";
  }
  if (!reasoningEffort) reasoningEffort = "medium";
  const maxCompletionTokens = modelEntry?.maxCompletionTokens || 0;
  const openAIEndpoint =
    modelEntry?.openAIEndpoint || "/v1/chat/completions";
  const contextWindowTokens = modelEntry?.contextWindowTokens || 0;
  const compiled = compilePrompt(mode, routerModel);

  // Workspace context + user rules injection (byok reminders.go + user_rules.go)
  let workspaceCtx = { workspacePaths: [], activeBranch: "" };
  if (intent.conversationStateBuf) {
    try {
      workspaceCtx = extractConversationStateContext(intent.conversationStateBuf);
    } catch {
      /* ignore */
    }
  }
  const workspacePath = workspaceCtx.workspacePaths[0] || "";
  const workspaceSnippet = formatWorkspaceContext(workspaceCtx);

  // Load user rules from workspace (byok user_rules.go)
  let userRulesText = "";
  if (workspacePath) {
    try {
      userRulesText = loadUserRules(workspacePath);
    } catch {
      /* ignore */
    }
  }

  // Build final system prompt = compiled + workspace context + user rules
  let systemPrompt = compiled.system;
  if (workspaceSnippet) systemPrompt += `\n\n${workspaceSnippet}`;
  if (userRulesText) {
    systemPrompt += `\n\n<user_rules>\n${userRulesText}\n</user_rules>`;
  }
  // Mode reminder (byok reminders.go pattern)
  if (mode === "ask") {
    systemPrompt += "\n\n<system_reminder>You are in ask mode. Prefer direct answers and only use tools when they are necessary to answer accurately. Lead with the conclusion, keep the response concise.</system_reminder>";
  } else if (mode === "plan") {
    systemPrompt += "\n\n<system_reminder>You are in plan mode. Prioritize investigation, decomposition, tradeoff analysis, and producing or refining a concrete plan.</system_reminder>";
  } else if (mode === "debug") {
    systemPrompt += "\n\n<system_reminder>You are in debug mode. Use systematic hypothesis-test cycles. Prefer reading code and logs over random edits. Identify root cause before proposing fixes.</system_reminder>";
  }

  if (intent.userText) {
    appendMessage(conversationId, {
      role: "user",
      content: intent.userText,
    });
  }

  try {
    await maybeCompact(conversationId, {
      contextWindowTokens,
      routerModel,
      openAIEndpoint,
      reasoningEffort: "low",
    });
  } catch (e) {
    err(`compaction: ${e.message}`);
  }

  const ctx = loadContext(conversationId);
  ctx.mode = mode;
  ctx.status = "running";
  saveContext(conversationId, ctx);

  let round = 0;
  const maxRounds = mode === "ask" ? 4 : 16;

  while (round < maxRounds) {
    round++;
    if (stream.aborted) {
      stream.publish(encodeTurnEnded({}));
      break;
    }

    const messages = projectOpenAIMessages(conversationId, systemPrompt);
    // Final round: no tools (force text conclusion)
    const tools = round > maxRounds - 1 ? [] : compiled.tools;

    let assistantText = "";
    let toolCalls = null;
    let usage = null;

    try {
      for await (const ev of streamChatCompletions({
        model: routerModel,
        messages,
        tools: tools.length ? tools : undefined,
        maxCompletionTokens,
        reasoningEffort,
        openAIEndpoint,
        signal: stream.abortController.signal,
      })) {
        if (stream.aborted) break;
        if (ev.type === "text_delta" && ev.text) {
          assistantText += ev.text;
          stream.publish(encodeTextDelta(ev.text));
        } else if (ev.type === "thinking_delta" && ev.text) {
          stream.publish(encodeThinkingDelta(ev.text));
        } else if (ev.type === "tool_calls") {
          toolCalls = ev.tool_calls;
        } else if (ev.type === "done") {
          usage = ev.usage;
        } else if (ev.type === "error") {
          stream.publish(
            encodeTextDelta(`\n[cursor-local error] ${ev.error}\n`),
          );
          stream.publish(encodeTurnEnded({}));
          ctx.status = "provider_error";
          saveContext(conversationId, ctx);
          return;
        }
      }
    } catch (e) {
      if (stream.aborted || e.name === "AbortError") {
        stream.publish(encodeTurnEnded({}));
        ctx.status = "canceled";
        saveContext(conversationId, ctx);
        return;
      }
      err(`driveProvider: ${e.message}`);
      stream.publish(encodeTextDelta(`\n[cursor-local error] ${e.message}\n`));
      stream.publish(encodeTurnEnded({}));
      ctx.status = "failed";
      saveContext(conversationId, ctx);
      return;
    }

    if (toolCalls?.length) {
      appendMessage(conversationId, {
        role: "assistant",
        content: assistantText || "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const mapped = publishToolStart(stream, tc);
        let resultText = "";

        // AskQuestion tool: emit InteractionQuery → wait for interaction_response (byok)
        if (mapped.canonicalName === "AskQuestion" || mapped.name === "AskQuestion") {
          const question = mapped.args.question || mapped.args.prompt || "How should I proceed?";
          const options = Array.isArray(mapped.args.options)
            ? mapped.args.options.map((o, i) => ({
                key: String(o.key || i),
                label: String(o.label || o.description || o),
              }))
            : [];
          const queryId = stream.execSeq++;
          stream.publish(
            encodeAskQuestionInteractionQuery(queryId, question, options),
          );
          try {
            const result = await stream.waitToolResult(
              mapped.callId,
              120000,
            );
            resultText =
              result?.resultText ||
              result?.content ||
              "(no answer)";
          } catch (e) {
            resultText = `[cursor-local] AskQuestion timeout: ${e.message}`;
          }
        } else {
          try {
            const result = await stream.waitToolResult(mapped.callId, 180000);
            resultText =
              result?.resultText ||
              result?.content ||
              JSON.stringify(result || {});
          } catch (e) {
            resultText = `[cursor-local] tool result not received: ${e.message}`;
            log(`tool wait fail ${mapped.callId}: ${e.message}`);
          }
        }

        publishToolComplete(stream, mapped);
        appendMessage(conversationId, {
          role: "tool",
          tool_call_id: mapped.callId,
          content: resultText,
          name: mapped.name,
        });
      }
      continue;
    }

    if (assistantText) {
      appendMessage(conversationId, {
        role: "assistant",
        content: assistantText,
      });
    }
    stream.publish(encodeTurnEnded(usage || {}));
    ctx.status = "completed";
    saveContext(conversationId, ctx);
    return;
  }

  stream.publish(encodeTurnEnded({}));
  ctx.status = "completed";
  saveContext(conversationId, ctx);
}

module.exports = { driveProvider };
