/**
 * Translator: OpenAI Responses API → OpenAI Chat Completions
 *
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { normalizeResponsesInput } from "../helpers/responsesApiHelper.js";

// Responses API enforces max 64 chars on call_id (#393)
const MAX_CALL_ID_LEN = 64;
const clampCallId = (id) =>
  typeof id === "string" && id.length > MAX_CALL_ID_LEN
    ? id.substring(0, MAX_CALL_ID_LEN)
    : id;

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format
 */
export function openaiResponsesToOpenAIRequest(
  model,
  body,
  stream,
  credentials,
) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];
  const customTools = [];

  const promoteCustomTool = (tool) => {
    const name = tool?.name;
    if (!name || typeof name !== "string" || name.trim() === "") return;
    customTools.push({ name, description: String(tool.description || "") });
  };

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: "system", content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolResults = [];
  let pendingReasoning = "";
  let pendingEncryptedContent = null;

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  // Extract reasoning text from summary[].text or encrypted_content fallback
  const extractReasoningText = (item) => {
    if (Array.isArray(item.summary)) {
      const txt = item.summary
        .map((s) => s?.text || "")
        .filter(Boolean)
        .join("\n");
      if (txt) return txt;
    }
    if (Array.isArray(item.content)) {
      const txt = item.content
        .map((c) => c?.text || "")
        .filter(Boolean)
        .join("\n");
      if (txt) return txt;
    }
    return "";
  };

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? "message" : null);

    if (itemType === "additional_tools") {
      for (const tool of item.tools || []) {
        if (tool?.type === "custom") promoteCustomTool(tool);
      }
    } else if (itemType === "message") {
      // Flush any pending assistant message with tool calls
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      // Convert content: input_text → text, output_text → text, input_image → image_url
      const content = Array.isArray(item.content)
        ? item.content.map((c) => {
            if (c.type === "input_text") return { type: "text", text: c.text };
            if (c.type === "output_text") return { type: "text", text: c.text };
            if (c.type === "input_image") {
              const url = c.image_url || c.file_id || "";
              return {
                type: "image_url",
                image_url: { url, detail: c.detail || "auto" },
              };
            }
            return c;
          })
        : item.content;
      const msg = { role: item.role, content };
      // Attach buffered reasoning to assistant turn (required by xiaomi-mimo thinking mode)
      if (item.role === "assistant" && pendingReasoning) {
        msg.reasoning_content = pendingReasoning;
      }
      if (item.role === "assistant" && pendingEncryptedContent) {
        msg.encrypted_content = pendingEncryptedContent;
      }
      pendingEncryptedContent = null;
      pendingReasoning = "";
      result.messages.push(msg);
    } else if (itemType === "function_call" || itemType === "custom_tool_call") {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: "assistant",
          content: null,
          tool_calls: [],
        };
        if (pendingReasoning) {
          currentAssistantMsg.reasoning_content = pendingReasoning;
          pendingReasoning = "";
        }
        if (pendingEncryptedContent) {
          currentAssistantMsg.encrypted_content = pendingEncryptedContent;
          pendingEncryptedContent = null;
        }
      }
      // Skip items with empty/missing name — Codex/OpenAI reject nameless tool calls (#444)
      if (
        !item.name ||
        typeof item.name !== "string" ||
        item.name.trim() === ""
      )
        continue;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : itemType === "custom_tool_call"
                ? JSON.stringify({ input: item.input || "" })
                : JSON.stringify(item.arguments ?? {}),
        },
        ...(typeof item.thought_signature === "string" &&
        item.thought_signature.length > 0
          ? { thought_signature: item.thought_signature }
          : typeof item.thoughtSignature === "string" &&
              item.thoughtSignature.length > 0
            ? { thought_signature: item.thoughtSignature }
            : {}),
      });
    } else if (
      itemType === "function_call_output" ||
      itemType === "custom_tool_call_output"
    ) {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush any pending tool results first
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      // Add tool result immediately
      result.messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content:
          typeof item.output === "string"
            ? item.output
            : JSON.stringify(item.output),
      });
    } else if (itemType === "reasoning") {
      // Buffer reasoning text and encrypted continuity data for the next assistant turn.
      const txt = extractReasoningText(item);
      if (txt)
        pendingReasoning = pendingReasoning
          ? `${pendingReasoning}\n${txt}`
          : txt;
      pendingEncryptedContent =
        item.encrypted_content || item.reasoning_encrypted_content || null;
      continue;
    }
  }

  // Flush remaining
  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // Convert tools format.
  // Responses API supports "hosted" tools (e.g. { type: "request_user_input" }) that carry no
  // explicit `name` field and cannot be represented as Chat Completions function declarations.
  // Filter them out to avoid sending nameless functionDeclarations to downstream providers
  // such as Gemini, which strictly validates function names.
  const promotedCustomTools = customTools.map(({ name, description }) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        required: ["input"],
        properties: { input: { type: "string" } },
      },
    },
  }));
  if (body.tools && Array.isArray(body.tools)) {
    const standardTools = body.tools
      .map((tool) => {
        // Already in Chat Completions format: { type: "function", function: { name, ... } }
        if (tool.function) return tool;
        // Responses API function tool: { type: "function", name, description, parameters }
        // Only convert when a non-empty name is present; skip hosted tools without one.
        const name = tool.name;
        if (!name || typeof name !== "string" || name.trim() === "")
          return null;
        return {
          type: "function",
          function: {
            name,
            description: String(tool.description || ""),
            parameters: normalizeToolParameters(tool.parameters),
            strict: tool.strict,
          },
        };
      })
      .filter(Boolean);
    result.tools = [
      ...standardTools,
      ...promotedCustomTools,
    ];
  } else if (promotedCustomTools.length > 0) {
    result.tools = promotedCustomTools;
  }
  if (customTools.length > 0) {
    result._customToolNames = [...new Set(customTools.map(({ name }) => name))];
  }
  // Map Responses-only max_output_tokens to Chat max_tokens (avoid leaking unknown field upstream)
  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined)
      result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  if (typeof result.reasoning?.effort === "string") {
    result.reasoning_effort = result.reasoning.effort;
  }
  delete result.reasoning;
  delete result.client_metadata;

  return result;
}

/**
 * Ensure object schema always has properties field (required by Codex Responses API)
 */
function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties)
    return { ...params, properties: {} };
  return params;
}

/**
 * Convert OpenAI Chat Completions to OpenAI Responses API format
 */
export function openaiToOpenAIResponsesRequest(
  model,
  body,
  stream,
  credentials,
) {
  // Body already in Responses API format (e.g. Cursor CLI calling /chat/completions with input[])
  if (body.input) return { ...body, model, stream: true };

  const result = {
    model,
    input: [],
    stream: true,
    store: false,
  };

  // Extract instruction-bearing messages as instructions
  let hasSystemMessage = false;
  const messages = body.messages || [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      // Use the first instruction-bearing message as instructions (role=system or role=developer for GPT-5/Codex)
      if (!hasSystemMessage) {
        result.instructions =
          typeof msg.content === "string" ? msg.content : "";
        hasSystemMessage = true;
      }
      continue; // Skip instruction messages in input
    }

    // Convert user/assistant messages to input items
    if (msg.role === "user" || msg.role === "assistant") {
      // reasoning_content → emit reasoning item before output_text (Responses API format)
      if (msg.role === "assistant" && msg.reasoning_content) {
        result.input.push({
          type: "reasoning",
          summary: [{ type: "summary_text", text: msg.reasoning_content }],
          ...(msg.encrypted_content || msg.reasoning_encrypted_content
            ? {
                encrypted_content:
                  msg.encrypted_content || msg.reasoning_encrypted_content,
              }
            : {}),
        });
      } else if (
        msg.role === "assistant" &&
        (msg.encrypted_content || msg.reasoning_encrypted_content)
      ) {
        result.input.push({
          type: "reasoning",
          encrypted_content:
            msg.encrypted_content || msg.reasoning_encrypted_content,
        });
      }
      const contentType = msg.role === "user" ? "input_text" : "output_text";
      const content =
        typeof msg.content === "string"
          ? [{ type: contentType, text: msg.content }]
          : Array.isArray(msg.content)
            ? msg.content.map((c) => {
                if (c.type === "text")
                  return { type: contentType, text: c.text };
                // Convert Chat Completions image_url → Responses API input_image
                // Responses API expects: { type: "input_image", image_url: "<url string>" }
                // Chat Completions sends: { type: "image_url", image_url: { url: "...", detail: "..." } }
                if (c.type === "image_url") {
                  const url =
                    typeof c.image_url === "string"
                      ? c.image_url
                      : c.image_url?.url;
                  return {
                    type: "input_image",
                    image_url: url,
                    detail: c.image_url?.detail || "auto",
                  };
                }
                if (c.type === "input_image") return c;
                // Serialize any unknown type (tool_use, tool_result, thinking, etc.) as text
                const text = c.text || c.content || JSON.stringify(c);
                return {
                  type: contentType,
                  text: typeof text === "string" ? text : JSON.stringify(text),
                };
              })
            : [];

      // Only push a message block if content is non-empty.
      // Assistant messages with only tool_calls have content: null — skip the
      // message block in that case; the tool_calls are pushed separately below.
      if (content.length > 0) {
        result.input.push({
          type: "message",
          role: msg.role,
          content,
        });
      }
    }

    // Convert tool calls
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const thoughtSig =
          tc.thought_signature ||
          tc.thoughtSignature ||
          tc.function?.thought_signature ||
          tc.function?.thoughtSignature;
        const item = {
          type: "function_call",
          call_id: clampCallId(tc.id),
          name: tc.function?.name || "_unknown",
          arguments: tc.function?.arguments || "{}",
        };
        if (typeof thoughtSig === "string" && thoughtSig.length > 0) {
          item.thought_signature = thoughtSig;
        }
        result.input.push(item);
      }
    }

    // Convert tool results - output must be a string for Responses API
    if (msg.role === "tool") {
      const output =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c) => c.text || JSON.stringify(c)).join("")
            : JSON.stringify(msg.content);
      result.input.push({
        type: "function_call_output",
        call_id: clampCallId(msg.tool_call_id),
        output,
      });
    }
  }

  // If no system message, leave instructions empty (will be filled by executor)
  if (!hasSystemMessage) {
    result.instructions = "";
  }

  // Convert tools format
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map((tool) => {
      if (tool.type === "function") {
        return {
          type: "function",
          name: tool.function.name,
          description: String(tool.function.description || ""),
          parameters: normalizeToolParameters(tool.function.parameters),
          strict: tool.function.strict,
        };
      }
      return tool;
    });
  }

  // Pass through other relevant fields
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  if (body.reasoning_effort !== undefined) {
    result.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  }
  if (body.service_tier !== undefined) result.service_tier = body.service_tier;
  if (body.prompt_cache_key !== undefined) {
    result.prompt_cache_key = body.prompt_cache_key;
  }

  return result;
}

// Register both directions
register(
  FORMATS.OPENAI_RESPONSES,
  FORMATS.OPENAI,
  openaiResponsesToOpenAIRequest,
  null,
);
register(
  FORMATS.OPENAI,
  FORMATS.OPENAI_RESPONSES,
  openaiToOpenAIResponsesRequest,
  null,
);
