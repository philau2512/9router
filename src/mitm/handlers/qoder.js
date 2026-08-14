const fs = require("fs");
const os = require("os");
const path = require("path");
const { err, dumpRequest, createResponseDumper } = require("../logger");
const { IS_DEV } = require("../config");
const { qoderDecodeBody } = require("../../lib/qoder/encoding.js");
const { fetchRouter } = require("./base");

function qoderDecodeCandidates(bodyBuffer) {
  const rawBody = bodyBuffer.toString("latin1");
  const candidates = [rawBody];
  try {
    const decoded = qoderDecodeBody(rawBody);
    if (decoded && decoded !== rawBody) candidates.push(decoded);
  } catch {
    /* ignore malformed encoded payload */
  }
  return candidates;
}

function parseQoderBody(bodyBuffer) {
  for (const candidate of qoderDecodeCandidates(bodyBuffer)) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next representation */
    }
  }
  throw new Error("Unable to parse Qoder request body");
}

function findQoderModel(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  const priorityContainers = [
    value.chat_context,
    value.chatContext,
    value.modelConfig,
    value.model_config,
    value.request,
    value.data,
  ];
  for (const container of priorityContainers) {
    const model = findQoderModel(container, seen);
    if (model) return model;
  }

  if (typeof value.model === "string" && value.model) return value.model;
  if (typeof value.modelId === "string" && value.modelId) return value.modelId;
  if (typeof value.modelName === "string" && value.modelName)
    return value.modelName;

  for (const child of Object.values(value)) {
    const model = findQoderModel(child, seen);
    if (model) return model;
  }
  return null;
}

function extractQoderModel(bodyBuffer) {
  for (const candidate of qoderDecodeCandidates(bodyBuffer)) {
    try {
      const model = findQoderModel(JSON.parse(candidate));
      if (model) return model;
    } catch {
      /* try the next representation */
    }
  }
  return null;
}

const qoderSessions = new Map();

function findQoderSessionId(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const key of [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "chat_record_id",
    "chatRecordId",
  ]) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }

  for (const child of Object.values(value)) {
    const sessionId = findQoderSessionId(child, seen);
    if (sessionId) return sessionId;
  }
  return null;
}

function getQoderSession(body) {
  if (getQoderBusinessType(body) !== "agent") return null;
  const sessionId = findQoderSessionId(body);
  if (!sessionId) return null;
  let session = qoderSessions.get(sessionId);
  if (!session) {
    session = { messages: [] };
    qoderSessions.set(sessionId, session);
  }
  return session;
}

function isChatMessage(message) {
  return (
    message &&
    typeof message === "object" &&
    typeof message.role === "string" &&
    ["system", "user", "assistant", "tool"].includes(message.role)
  );
}

function firstNonEmptyString(values) {
  return values.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function extractQoderMessageContent(message) {
  if (typeof message?.content === "string" && message.content) {
    return message.content;
  }
  if (!Array.isArray(message?.contents)) return message?.content;
  return message.contents
    .filter((part) => part && typeof part === "object")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractQoderRuleContent(message) {
  if (message?.role !== "user" || typeof message.content !== "string") {
    return "";
  }
  const rulesMatch = message.content.match(/<rules>\s*([\s\S]*?)\s*<\/rules>/i);
  return rulesMatch?.[1]?.trim() || "";
}

function splitQoderRulesMessage(message) {
  const ruleContent = extractQoderRuleContent(message);
  if (!ruleContent) return [message];

  const queryMatch = message.content.match(
    /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i,
  );
  const messages = [{ role: "system", content: ruleContent }];
  const userContent = queryMatch
    ? queryMatch[1]
    : message.content.replace(/<rules>\s*[\s\S]*?\s*<\/rules>/i, "").trim();
  if (userContent) messages.push({ ...message, content: userContent });
  return messages;
}

function normalizeQoderRuleText(content) {
  return String(content || "")
    .replace(/^---\s*[\s\S]*?^-{3,}\s*/m, "")
    .trim();
}

function getQoderLocalRules() {
  const rulesDir = path.join(os.homedir(), ".qoder", "rules");
  try {
    return fs
      .readdirSync(rulesDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
      .sort()
      .map((file) => ({
        file,
        content: normalizeQoderRuleText(fs.readFileSync(file, "utf8")),
      }))
      .filter((rule) => rule.content)
      .map(({ file, content }) => ({
        role: "system",
        content: [
          `Global Qoder rule loaded from ${file}.`,
          "Treat the following as active instructions for this request.",
          "Do not claim that this rule file is unavailable or unread.",
          content,
        ].join("\n\n"),
      }));
  } catch {
    return [];
  }
}

function prependQoderRules(messages, rules) {
  const uniqueRules = rules.filter(
    (rule) =>
      !messages.some(
        (message) =>
          message.role === "system" && message.content.includes(rule.content),
      ),
  );
  if (!uniqueRules.length) return messages;

  const firstSystemIndex = messages.findIndex(
    (message) => message.role === "system",
  );
  if (firstSystemIndex === -1) return [...uniqueRules, ...messages];

  const mergedSystem = {
    ...messages[firstSystemIndex],
    content: [
      messages[firstSystemIndex].content,
      ...uniqueRules.map((rule) => rule.content),
    ].join("\n\n"),
  };
  return messages.map((message, index) =>
    index === firstSystemIndex ? mergedSystem : message,
  );
}

function getQoderBusinessType(body) {
  return body?.business?.type || body?.request?.business?.type || "agent";
}

function extractQoderRules(messages) {
  return messages
    .map(extractQoderRuleContent)
    .filter(Boolean)
    .map((content) => ({ role: "system", content }));
}

function normalizeQoderMessage(message) {
  const content = extractQoderMessageContent(message);
  const { contents, ...openAIMessage } = message;
  const normalized = {
    ...openAIMessage,
    ...(typeof content === "string" ? { content } : {}),
  };
  return splitQoderRulesMessage(normalized);
}

function extractQoderMessages(body) {
  const request = body?.request && typeof body.request === "object"
    ? body.request
    : {};
  const messageSources = [
    body?.messages,
    request.messages,
    body?.chat_context?.messages,
    body?.chatContext?.messages,
    request.chat_context?.messages,
    request.chatContext?.messages,
  ];
  for (const source of messageSources) {
    if (Array.isArray(source)) {
      const messages = source
        .filter(isChatMessage)
        .flatMap(normalizeQoderMessage);
      if (messages.length) return messages;
    }
  }

  const prompt = firstNonEmptyString([
    body?.chat_context?.extra?.originalContent,
    body?.chatContext?.extra?.originalContent,
    request.chat_context?.extra?.originalContent,
    request.chatContext?.extra?.originalContent,
    body?.chat_context?.text,
    body?.chatContext?.text,
    request.chat_context?.text,
    request.chatContext?.text,
    body?.chat_prompt,
    request.chat_prompt,
    body?.chat_context?.chatPrompt,
    body?.chatContext?.chatPrompt,
    request.chat_context?.chatPrompt,
    request.chatContext?.chatPrompt,
  ]);
  return prompt ? [{ role: "user", content: prompt }] : [];
}

function mergeQoderHistory(previous, incoming) {
  const currentMessages = incoming.filter(isChatMessage);
  if (!previous.length) return currentMessages;

  const hasAssistantHistory = currentMessages.some(
    (message) => message.role === "assistant",
  );
  if (hasAssistantHistory && currentMessages.length >= previous.length) {
    return currentMessages;
  }

  const currentWithoutRepeatedSystem = currentMessages.filter(
    (message) =>
      message.role !== "system" ||
      !previous.some(
        (previousMessage) =>
          previousMessage.role === "system" &&
          previousMessage.content === message.content,
      ),
  );
  return [...previous, ...currentWithoutRepeatedSystem];
}

function collectAssistantDelta(data, assistant) {
  try {
    const chunk = JSON.parse(data);
    for (const choice of chunk.choices || []) {
      const delta = choice?.delta || choice?.message;
      if (!delta || typeof delta !== "object") continue;
      if (typeof delta.content === "string") assistant.content += delta.content;
      for (const toolCall of delta.tool_calls || []) {
        const index = Number.isInteger(toolCall.index)
          ? toolCall.index
          : assistant.toolCalls.length;
        const current =
          assistant.toolCalls[index] ||
          (assistant.toolCalls[index] = {
            id: toolCall.id || "",
            type: toolCall.type || "function",
            function: { name: "", arguments: "" },
          });
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.type) current.type = toolCall.type;
        if (toolCall.function?.name) current.function.name += toolCall.function.name;
        if (toolCall.function?.arguments)
          current.function.arguments += toolCall.function.arguments;
      }
    }
  } catch {
    /* ignore malformed OpenAI SSE chunk */
  }
}

function saveQoderAssistantReply(session, messages, assistant) {
  if (!session) return;
  const nextMessages = [...messages];
  const toolCalls = assistant.toolCalls.filter(
    (toolCall) => toolCall.id && toolCall.function.name,
  );
  if (assistant.content.trim() || toolCalls.length) {
    nextMessages.push({
      role: "assistant",
      content: assistant.content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }
  session.messages = nextMessages;
}

async function pipeQoderSSE(routerRes, res, dumper, onComplete) {
  const contentType = routerRes.headers.get("content-type") || "application/json";
  const status = routerRes.status || 200;
  const isSSE = contentType.includes("text/event-stream");
  const responseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (isSSE) responseHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(status, responseHeaders);
  if (dumper)
    dumper.writeHeader(routerRes.status, Object.fromEntries(routerRes.headers));

  if (!routerRes.body || !isSSE) {
    const text = await routerRes.text().catch(() => "");
    if (dumper) {
      dumper.writeChunk(text);
      dumper.end();
    }
    res.end(text);
    onComplete?.({ content: "", toolCalls: [] });
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  const assistant = { content: "", toolCalls: [] };
  let buffer = "";
  let eventData = [];
  let doneEmitted = false;

  const writeEnvelope = (body, statusCodeValue = status) => {
    if (doneEmitted) return;
    collectAssistantDelta(body, assistant);
    const frame = `data: ${JSON.stringify({ statusCodeValue, body })}\n\n`;
    if (dumper) dumper.writeChunk(frame);
    res.write(frame);
    if (body === "[DONE]") doneEmitted = true;
  };
  const flushEvent = () => {
    if (!eventData.length || doneEmitted) {
      eventData = [];
      return;
    }
    const body = eventData.join("\n");
    eventData = [];
    let statusCodeValue = status;
    try {
      if (JSON.parse(body)?.error) statusCodeValue = status >= 400 ? status : 500;
    } catch {
      /* forward opaque SSE data without changing its status */
    }
    writeEnvelope(body, statusCodeValue);
  };
  const processLine = (line) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalized) {
      flushEvent();
      return;
    }
    if (normalized.startsWith("data:")) {
      const value = normalized.slice(5);
      eventData.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  };

  try {
    while (!doneEmitted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (doneEmitted) break;
      }
    }
    buffer += decoder.decode();
    if (!doneEmitted && buffer) processLine(buffer);
    if (!doneEmitted) flushEvent();
  } finally {
    if (doneEmitted) await reader.cancel().catch(() => {});
    if (dumper) dumper.end();
    if (!res.writableEnded) res.end();
    onComplete?.(assistant);
  }
}

/**
 * Intercept Qoder IDE request — forward request payload to /v1/chat/completions.
 * Router auto-detects format or handles mapped model transformation.
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-qoder") : null;
  try {
    const body = parseQoderBody(bodyBuffer);
    const incomingMessages = extractQoderMessages(body);
    const session = getQoderSession(body);
    const messages = mergeQoderHistory(
      session?.messages || [],
      incomingMessages,
    );
    if (!session && getQoderBusinessType(body) !== "agent") {
      res.writeHead(204);
      res.end();
      if (dumper) dumper.end();
      return;
    }
    const localRules = session ? getQoderLocalRules() : [];
    const sessionRules = session ? extractQoderRules(incomingMessages) : [];
    body.messages = prependQoderRules(messages, [...localRules, ...sessionRules]);
    if (mappedModel) {
      body.model = mappedModel;
      if (body.chat_context?.modelConfig) {
        body.chat_context.modelConfig.model = mappedModel;
      }
      if (body.chatContext?.modelConfig) {
        body.chatContext.modelConfig.model = mappedModel;
      }
    }
    if (IS_DEV) {
      dumpRequest(
        {
          method: "POST",
          url: "/v1/chat/completions",
          headers: { host: "9router.local" },
        },
        Buffer.from(JSON.stringify(body)),
        "forwarded-qoder",
      );
    }

    const routerRes = await fetchRouter(
      body,
      "/v1/chat/completions",
      req.headers,
    );
    await pipeQoderSSE(routerRes, res, dumper, (assistant) =>
      saveQoderAssistantReply(session, messages, assistant),
    );
  } catch (error) {
    err(`[qoder] ${error.message}`);
    if (dumper) {
      dumper.writeChunk(`\n[ERROR] ${error.message}\n`);
      dumper.end();
    }
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: error.message, type: "mitm_error" },
        }),
      );
      return;
    }
    res.end();
  }
}

module.exports = {
  intercept,
  extractQoderModel,
  pipeQoderSSE,
  __test__: {
    findQoderSessionId,
    extractQoderMessages,
    extractQoderMessageContent,
    getQoderLocalRules,
    getQoderBusinessType,
    normalizeQoderRuleText,
    prependQoderRules,
    extractQoderRules,
    mergeQoderHistory,
    collectAssistantDelta,
    saveQoderAssistantReply,
    qoderSessions,
  },
};
