/**
 * Stream OpenAI-compatible chat from 9router /v1.
 * Uses persistent HTTP/1.1 keep-alive agent to avoid TCP setup overhead on localhost.
 */
const http = require("http");
const { loadConfig } = require("../../config/loadConfig");
const { log, err } = require("../../logger");

// Persistent keep-alive agent — reuses TCP connection to localhost 9router.
// byok makes a single process-local call; our fetch() would create a new connection each turn
// without this, adding ~5–20ms per request on Windows loopback.
const _keepAliveAgents = new Map();
function getKeepAliveAgent(url) {
  try {
    const { protocol, hostname } = new URL(url);
    const key = `${protocol}//${hostname}`;
    if (!_keepAliveAgents.has(key)) {
      // Only plain HTTP (localhost) needs this; https would need https.Agent
      if (protocol === "http:") {
        _keepAliveAgents.set(
          key,
          new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30000 }),
        );
      }
    }
    return _keepAliveAgents.get(key) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array} opts.messages
 * @param {Array} [opts.tools]
 * @param {number} [opts.maxCompletionTokens]
 * @param {string} [opts.reasoningEffort]
 * @param {string} [opts.openAIEndpoint] /v1/chat/completions | /v1/responses
 * @param {AbortSignal} [opts.signal]
 */
async function* streamChatCompletions(opts) {
  const cfg = loadConfig();
  const base = (cfg.routerBaseUrl || "http://127.0.0.1:20128").replace(/\/+$/, "");
  const endpoint =
    opts.openAIEndpoint === "/v1/responses" ? "/v1/responses" : "/v1/chat/completions";
  const url = `${base}${endpoint}`;

  let body;
  if (endpoint === "/v1/responses") {
    body = {
      model: opts.model || "default",
      input: opts.messages || [],
      stream: true,
    };
    if (opts.maxCompletionTokens > 0) body.max_output_tokens = opts.maxCompletionTokens;
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    if (opts.tools?.length) {
      body.tools = opts.tools;
    }
  } else {
    body = {
      model: opts.model || "default",
      messages: opts.messages || [],
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice || "auto";
    }
    if (opts.maxCompletionTokens > 0) body.max_tokens = opts.maxCompletionTokens;
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  }

  const headers = { "Content-Type": "application/json" };
  if (cfg.routerApiKey) headers.Authorization = `Bearer ${cfg.routerApiKey}`;

  log(`openaiChat POST ${url} model=${body.model} effort=${opts.reasoningEffort || "-"} tools=${opts.tools?.length || 0}`);

  let res;
  try {
    const fetchOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    };
    // Attach keep-alive agent for HTTP (Node built-in fetch ignores Agent but undici respects it
    // via dispatcher; fall back to default if unavailable).
    const agent = getKeepAliveAgent(url);
    if (agent) {
      // undici/node fetch: pass via dispatcher if available
      try {
        const { Agent: UndiciAgent } = await import("undici");
        if (!fetchOpts.__undiciAgent) {
          // Prefer undici dispatcher for real connection reuse
          fetchOpts.dispatcher = new UndiciAgent({
            connect: { keepAlive: true, keepAliveMaxTimeout: 30000 },
            pipelining: 1,
          });
        }
      } catch {
        // undici not available or no dispatcher support — plain fetch is fine
      }
    }
    res = await fetch(url, fetchOpts);
  } catch (e) {
    yield { type: "error", error: e.message };
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    yield { type: "error", error: `router ${res.status}: ${text.slice(0, 500)}` };
    return;
  }

  if (!res.body) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const msg = json.choices?.[0]?.message;
      if (msg?.content) yield { type: "text_delta", text: msg.content };
      if (msg?.tool_calls) yield { type: "tool_calls", tool_calls: msg.tool_calls };
      yield { type: "done", finish_reason: json.choices?.[0]?.finish_reason || "stop", usage: json.usage };
    } catch {
      yield { type: "error", error: "empty response body" };
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallAcc = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        if (toolCallAcc.size) {
          yield {
            type: "tool_calls",
            tool_calls: [...toolCallAcc.values()].map((t) => ({
              id: t.id, type: "function",
              function: { name: t.name, arguments: t.arguments },
            })),
          };
          toolCallAcc.clear();
        }
        yield { type: "done", finish_reason: "stop" };
        return;
      }
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const choice = json.choices?.[0];
      const delta = choice?.delta || {};
      if (delta.content) yield { type: "text_delta", text: delta.content };
      if (delta.reasoning_content || delta.reasoning) {
        yield { type: "thinking_delta", text: delta.reasoning_content || delta.reasoning };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let acc = toolCallAcc.get(idx);
          if (!acc) { acc = { id: tc.id || `call_${idx}`, name: "", arguments: "" }; toolCallAcc.set(idx, acc); }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
      if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "stop") {
        if (toolCallAcc.size) {
          yield {
            type: "tool_calls",
            tool_calls: [...toolCallAcc.values()].map((t) => ({
              id: t.id, type: "function",
              function: { name: t.name, arguments: t.arguments },
            })),
          };
          toolCallAcc.clear();
        }
        yield { type: "done", finish_reason: choice.finish_reason, usage: json.usage };
      }
    }
  }
  if (toolCallAcc.size) {
    yield {
      type: "tool_calls",
      tool_calls: [...toolCallAcc.values()].map((t) => ({
        id: t.id, type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    };
  }
  yield { type: "done", finish_reason: "stop" };
}

async function chatOnce(opts) {
  const chunks = []; let tool_calls = null, usage = null, finish_reason = "stop";
  for await (const ev of streamChatCompletions(opts)) {
    if (ev.type === "text_delta") chunks.push(ev.text);
    if (ev.type === "tool_calls") tool_calls = ev.tool_calls;
    if (ev.type === "done") { finish_reason = ev.finish_reason; usage = ev.usage; }
    if (ev.type === "error") throw new Error(ev.error);
  }
  return { content: chunks.join(""), tool_calls, finish_reason, usage };
}

module.exports = { streamChatCompletions, chatOnce };
