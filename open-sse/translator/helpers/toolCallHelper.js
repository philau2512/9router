// Tool call helper functions for translator

// Anthropic tool_use.id must match: ^[a-zA-Z0-9_-]+$
const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Generate deterministic tool call ID from position + tool name (cache-friendly)
export function generateToolCallId(msgIndex = 0, tcIndex = 0, toolName = "") {
  const name = toolName ? `_${toolName.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  return `call_msg${msgIndex}_tc${tcIndex}${name}`;
}

// Sanitize ID to match Anthropic pattern: keep only alphanumeric, underscore, hyphen
function sanitizeToolId(id) {
  if (!id || typeof id !== "string") return null;
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

// ---------------------------------------------------------------------------
// Kiro tool-NAME sanitize + restore
//
// Kiro upstream can reject a tool name that carries chars outside
// [a-zA-Z0-9_-], is longer than 64 chars, or arrives as an MCP triple
// (`mcp__server__tool`). We rewrite ONLY those genuinely-invalid names; an
// already-valid name (e.g. `read_file`, `Bash`) is returned byte-identical so
// the common path is never disturbed and needs no restore. This narrows the
// blast radius vs Kiro-Go, which camelCases every name.
// ---------------------------------------------------------------------------

const KIRO_TOOL_NAME_MAX = 64;
const KIRO_TOOL_NAME_VALID = /^[a-zA-Z0-9_-]{1,64}$/;

/** True when a tool name can be sent to Kiro unchanged. */
function isValidKiroToolName(name) {
  return typeof name === "string" && KIRO_TOOL_NAME_VALID.test(name);
}

/**
 * Collapse an MCP triple (`mcp__server__tool`) to `mcp__<tool>`, keeping the
 * `mcp__` marker so the model still recognises it as an MCP call. Non-MCP names
 * are returned unchanged. The result is NOT guaranteed valid on its own — the
 * caller still runs the generic sanitize/truncate pass afterwards.
 */
function shortenMcpToolName(name) {
  if (typeof name !== "string" || !name.startsWith("mcp__")) return name;
  const parts = name.split("__").filter(Boolean);
  // parts[0] === "mcp"; last segment is the actual tool name.
  if (parts.length < 3) return name;
  return `mcp__${parts[parts.length - 1]}`;
}

/**
 * Sanitize a single tool name for Kiro upstream. Valid names pass through
 * byte-identical; invalid ones are shortened (MCP), stripped to the allowed
 * charset, and truncated to 64 chars. Idempotent.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeKiroToolName(name) {
  if (typeof name !== "string" || name.length === 0) return name;
  // MCP triples (`mcp__server__tool`) are shortened even when charset-valid —
  // the long two-segment form is what Kiro rejects, not just bad characters.
  const isMcpTriple =
    name.startsWith("mcp__") && name.split("__").filter(Boolean).length >= 3;
  if (!isMcpTriple && isValidKiroToolName(name)) return name;
  let out = shortenMcpToolName(name);
  out = out.replace(/[^a-zA-Z0-9_-]/g, "");
  if (out.length > KIRO_TOOL_NAME_MAX) out = out.slice(0, KIRO_TOOL_NAME_MAX);
  // If sanitizing wiped everything (e.g. all-unicode name), fall back to a
  // stable placeholder so we never emit an empty name.
  if (out.length === 0) out = "tool";
  return out;
}

/**
 * Build a `sanitized → original` Map for a list of tool names, containing ONLY
 * the names that actually changed. Disambiguates two originals that collapse to
 * the same sanitized value by appending a numeric suffix (kept within 64 chars
 * and the valid charset).
 *
 * @param {string[]} names
 * @returns {Map<string,string>}
 */
export function buildKiroToolNameMap(names) {
  const map = new Map();
  if (!Array.isArray(names)) return map;
  const used = new Set();
  // Seed with names that stay valid (pass through unchanged). A sanitized
  // output must not collide with a DISTINCT already-valid tool name, or the
  // restore map would misroute that valid tool. Seeding `used` forces the
  // disambiguation suffix in that case.
  for (const original of names) {
    if (typeof original !== "string" || original.length === 0) continue;
    if (sanitizeKiroToolName(original) === original) used.add(original);
  }
  for (const original of names) {
    if (typeof original !== "string" || original.length === 0) continue;
    let sanitized = sanitizeKiroToolName(original);
    if (sanitized === original) continue; // unchanged → not in map
    if (used.has(sanitized)) {
      // Collision: append a numeric suffix, trimming the base to stay <= 64.
      let n = 2;
      let candidate;
      do {
        const suffix = `_${n}`;
        const base = sanitized.slice(0, KIRO_TOOL_NAME_MAX - suffix.length);
        candidate = `${base}${suffix}`;
        n += 1;
      } while (used.has(candidate));
      sanitized = candidate;
    }
    used.add(sanitized);
    map.set(sanitized, original);
  }
  return map;
}

/**
 * Sanitize every tool name inside a built Kiro payload IN PLACE and return the
 * `sanitized → original` restore map (empty when nothing changed).
 *
 * Walks both places a name can appear in the `conversationState` shape produced
 * by the Claude and OpenAI request translators:
 *   - `userInputMessageContext.tools[].toolSpecification.name` (the tool defs)
 *   - `assistantResponseMessage.toolUses[].name` (prior tool calls in history)
 *
 * Only invalid names are rewritten (see sanitizeKiroToolName); valid names stay
 * byte-identical so the common path is untouched and the map stays empty.
 *
 * @param {object} payload Kiro payload with a `conversationState`.
 * @returns {Map<string,string>} restore map (may be empty).
 */
export function sanitizeKiroPayloadToolNames(payload) {
  const cs = payload?.conversationState;
  if (!cs) return new Map();

  // Collect every distinct original name first so collision disambiguation in
  // buildKiroToolNameMap is stable across the whole payload.
  const names = new Set();
  const turns = [cs.currentMessage, ...(Array.isArray(cs.history) ? cs.history : [])];
  for (const turn of turns) {
    const tools = turn?.userInputMessage?.userInputMessageContext?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        const n = t?.toolSpecification?.name;
        if (typeof n === "string") names.add(n);
      }
    }
    const toolUses = turn?.assistantResponseMessage?.toolUses;
    if (Array.isArray(toolUses)) {
      for (const tu of toolUses) {
        if (typeof tu?.name === "string") names.add(tu.name);
      }
    }
  }

  const map = buildKiroToolNameMap([...names]);
  if (map.size === 0) return map;

  // original → sanitized lookup for the in-place rewrite.
  const forward = new Map();
  for (const [sanitized, original] of map) forward.set(original, sanitized);

  for (const turn of turns) {
    const tools = turn?.userInputMessage?.userInputMessageContext?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        const spec = t?.toolSpecification;
        if (spec && forward.has(spec.name)) spec.name = forward.get(spec.name);
      }
    }
    const toolUses = turn?.assistantResponseMessage?.toolUses;
    if (Array.isArray(toolUses)) {
      for (const tu of toolUses) {
        if (tu && forward.has(tu.name)) tu.name = forward.get(tu.name);
      }
    }
  }
  return map;
}

/**
 * Restore original tool names on a NON-STREAMING, OpenAI-shaped response body
 * (`choices[].message.tool_calls[].function.name`) IN PLACE, using the same
 * `sanitized → original` map produced at request time. The streaming path
 * restores names inside the per-chunk translators; the non-streaming path
 * (client sent `stream:false`) never reaches those, so a sanitized name would
 * otherwise leak to the client. Fail-open: a name not in the map is left as-is.
 *
 * @param {object} body OpenAI-shaped completion response.
 * @param {Map<string,string>} toolNameMap sanitized → original.
 * @returns {object} the same body (mutated when the map has hits).
 */
export function restoreToolNamesInOpenAIResponse(body, toolNameMap) {
  if (!toolNameMap?.size || !Array.isArray(body?.choices)) return body;
  for (const choice of body.choices) {
    const toolCalls = choice?.message?.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const tc of toolCalls) {
      const name = tc?.function?.name;
      if (typeof name === "string" && toolNameMap.has(name)) {
        tc.function.name = toolNameMap.get(name);
      }
    }
  }
  return body;
}

// Ensure all tool_calls have valid id field and arguments is string (some providers require it)
export function ensureToolCallIds(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      Array.isArray(msg.tool_calls)
    ) {
      for (let j = 0; j < msg.tool_calls.length; j++) {
        const tc = msg.tool_calls[j];
        // Validate or regenerate ID for Anthropic compatibility
        if (!tc.id || !TOOL_ID_PATTERN.test(tc.id)) {
          const sanitized = sanitizeToolId(tc.id);
          tc.id = sanitized || generateToolCallId(i, j, tc.function?.name);
        }
        if (!tc.type) {
          tc.type = "function";
        }
        // Ensure arguments is JSON string, not object
        if (
          tc.function?.arguments &&
          typeof tc.function.arguments !== "string"
        ) {
          tc.function.arguments = JSON.stringify(tc.function.arguments);
        }
      }
    }

    // Validate tool_call_id in tool messages (role: "tool")
    if (
      msg.role === "tool" &&
      msg.tool_call_id &&
      !TOOL_ID_PATTERN.test(msg.tool_call_id)
    ) {
      const sanitized = sanitizeToolId(msg.tool_call_id);
      msg.tool_call_id = sanitized || generateToolCallId(i, 0);
    }

    // Also validate tool_use blocks in content (Claude format)
    if (Array.isArray(msg.content)) {
      for (let k = 0; k < msg.content.length; k++) {
        const block = msg.content[k];
        if (
          block.type === "tool_use" &&
          block.id &&
          !TOOL_ID_PATTERN.test(block.id)
        ) {
          const sanitized = sanitizeToolId(block.id);
          block.id = sanitized || generateToolCallId(i, k, block.name);
        }
        // Validate tool_use_id in tool_result blocks
        if (
          block.type === "tool_result" &&
          block.tool_use_id &&
          !TOOL_ID_PATTERN.test(block.tool_use_id)
        ) {
          const sanitized = sanitizeToolId(block.tool_use_id);
          block.tool_use_id = sanitized || generateToolCallId(i, k);
        }
      }
    }
  }

  return body;
}

// Get tool_call ids from assistant message (OpenAI format: tool_calls, Claude format: tool_use in content)
export function getToolCallIds(msg) {
  if (msg.role !== "assistant") return [];

  const ids = [];

  // OpenAI format: tool_calls array
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.id) ids.push(tc.id);
    }
  }

  // Claude format: tool_use blocks in content
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        ids.push(block.id);
      }
    }
  }

  return ids;
}

// Check if user message has tool_result for given ids (OpenAI format: role=tool, Claude format: tool_result in content)
export function hasToolResults(msg, toolCallIds) {
  if (!msg || !toolCallIds.length) return false;

  // OpenAI format: role = "tool" with tool_call_id
  if (msg.role === "tool" && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id);
  }

  // Claude format: tool_result blocks in user message content
  if (msg.role === "user" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (
        block.type === "tool_result" &&
        toolCallIds.includes(block.tool_use_id)
      ) {
        return true;
      }
    }
  }

  return false;
}

// Fix missing tool responses - insert empty tool_result if assistant has tool_use but next message has no tool_result
export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    const nextMsg = body.messages[i + 1];

    newMessages.push(msg);

    // Check if this is assistant with tool_calls/tool_use
    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length === 0) continue;

    // Check if next message has tool_result
    if (nextMsg && !hasToolResults(nextMsg, toolCallIds)) {
      // Insert tool responses for each tool_call
      for (const id of toolCallIds) {
        // OpenAI format: role = "tool"
        newMessages.push({
          role: "tool",
          tool_call_id: id,
          content: "",
        });
      }
    }
  }

  body.messages = newMessages;
  return body;
}
