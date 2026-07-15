const fs = require("fs");
const path = require("path");
const { PATHS, ensureDirs } = require("../../paths");

function convDir(conversationId) {
  const id = String(conversationId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PATHS.history, id);
}

function loadContext(conversationId) {
  ensureDirs();
  const dir = convDir(conversationId);
  const file = path.join(dir, "context.json");
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return { messages: [], mode: "agent" };
}

function saveContext(conversationId, ctx) {
  ensureDirs();
  const dir = convDir(conversationId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "context.json"),
    `${JSON.stringify(ctx, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "state.json"),
    `${JSON.stringify(
      {
        status: ctx.status || "idle",
        updatedAt: new Date().toISOString(),
        mode: ctx.mode || "agent",
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Truncate history without breaking tool_call / tool_result pairs.
 */
function truncateKeepingToolPairs(messages, maxKeep) {
  if (!messages || messages.length <= maxKeep) return messages || [];
  // Prefer dropping from the front at a safe boundary (user or unpaired-safe)
  let start = messages.length - maxKeep;
  // Walk forward until we are not mid tool chain
  while (start < messages.length) {
    const m = messages[start];
    if (m.role === "tool") {
      start++;
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      // ensure all tool results exist after this message within window
      const ids = new Set(m.tool_calls.map((t) => t.id).filter(Boolean));
      let ok = true;
      for (let i = start + 1; i < messages.length && ids.size; i++) {
        if (messages[i].role === "tool" && ids.has(messages[i].tool_call_id)) {
          ids.delete(messages[i].tool_call_id);
        }
      }
      if (ids.size) {
        start++;
        continue;
      }
    }
    break;
  }
  return messages.slice(start);
}

function appendMessage(conversationId, message) {
  const ctx = loadContext(conversationId);
  ctx.messages = ctx.messages || [];
  ctx.messages.push({
    ...message,
    at: new Date().toISOString(),
  });
  if (ctx.messages.length > 80) {
    ctx.messages = truncateKeepingToolPairs(ctx.messages, 60);
  }
  saveContext(conversationId, ctx);
  return ctx;
}

function projectOpenAIMessages(conversationId, systemPrompt) {
  const ctx = loadContext(conversationId);
  const out = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  for (const m of ctx.messages || []) {
    if (m.role === "user" || m.role === "assistant" || m.role === "tool" || m.role === "system") {
      const msg = { role: m.role, content: m.content || "" };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.name) msg.name = m.name;
      out.push(msg);
    }
  }
  return out;
}

module.exports = {
  loadContext,
  saveContext,
  appendMessage,
  projectOpenAIMessages,
  convDir,
};
