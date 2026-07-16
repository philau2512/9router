import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.js";

// Convert Antigravity request to OpenAI format
// Antigravity body: { project, model, userAgent, requestType, requestId, request: { contents, systemInstruction, tools, toolConfig, generationConfig, sessionId } }
export function antigravityToOpenAIRequest(model, body, stream) {
  const req = body.request || body;
  const result = {
    model: model,
    messages: [],
    stream: stream,
  };

  // Generation config
  if (req.generationConfig) {
    const config = req.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: req.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
    if (config.topK !== undefined) {
      result.top_k = config.topK;
    }

    // Thinking config → reasoning_effort
    if (config.thinkingConfig) {
      const budget = config.thinkingConfig.thinkingBudget || 0;
      if (budget > 0) {
        if (budget <= 2048) {
          result.reasoning_effort = "low";
        } else if (budget <= 16384) {
          result.reasoning_effort = "medium";
        } else {
          result.reasoning_effort = "high";
        }
      }
    }
  }

  // System instruction
  if (req.systemInstruction) {
    const systemText = extractText(req.systemInstruction);
    if (systemText) {
      result.messages.push({ role: "system", content: systemText });
    }
  }

  // Pair ID-less tool responses with earlier same-name calls in this request only.
  const unmatchedToolCallIds = new Map();

  // Convert contents to messages
  if (req.contents && Array.isArray(req.contents)) {
    for (const [contentIndex, content] of req.contents.entries()) {
      const converted = convertContent(
        content,
        contentIndex,
        unmatchedToolCallIds,
      );
      if (converted) {
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  // Tools
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description || "",
              parameters: normalizeSchemaTypes(func.parameters) || {
                type: "object",
                properties: {},
              },
            },
          });
        }
      }
    }
  }

  return result;
}

// Recursively convert Antigravity schema types (OBJECT, STRING, etc.) to lowercase
// and strip unsupported fields like enumDescriptions
function normalizeSchemaTypes(schema) {
  if (!schema || typeof schema !== "object") return schema;

  const result = Array.isArray(schema) ? [...schema] : { ...schema };

  if (typeof result.type === "string") {
    result.type = result.type.toLowerCase();
  }

  // Strip enumDescriptions — not supported by upstream APIs
  delete result.enumDescriptions;

  if (result.properties) {
    const normalized = {};
    for (const [key, val] of Object.entries(result.properties)) {
      normalized[key] = normalizeSchemaTypes(val);
    }
    result.properties = normalized;
  }

  if (result.items) {
    result.items = normalizeSchemaTypes(result.items);
  }

  return result;
}

function fallbackToolCallId(contentIndex, partIndex, name) {
  const normalizedName = String(name || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ag_call_${contentIndex}_${partIndex}_${normalizedName}`;
}

function dequeueMatchingToolCallId(unmatchedToolCallIds, name) {
  const ids = unmatchedToolCallIds.get(name);
  if (!ids?.length) return null;
  const id = ids.shift();
  if (ids.length === 0) unmatchedToolCallIds.delete(name);
  return id;
}

function removeMatchingToolCallId(unmatchedToolCallIds, name, id) {
  const ids = unmatchedToolCallIds.get(name);
  if (!ids?.length) return;
  const index = ids.indexOf(id);
  if (index === -1) return;
  ids.splice(index, 1);
  if (ids.length === 0) unmatchedToolCallIds.delete(name);
}

// Convert Antigravity content to OpenAI message
// Handles: text, thought, thoughtSignature, functionCall, functionResponse, inlineData
function convertContent(content, contentIndex, unmatchedToolCallIds) {
  const role =
    content.role === "model"
      ? "assistant"
      : content.role === "user"
        ? "user"
        : content.role;

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const textParts = [];
  const toolCalls = [];
  const toolResults = [];
  let reasoningContent = "";

  for (const [partIndex, part] of content.parts.entries()) {
    // Thinking content (thought: true)
    if (part.thought === true && part.text) {
      reasoningContent += part.text;
      continue;
    }

    // Text with thoughtSignature = regular text after thinking (skip empty)
    if (part.thoughtSignature && part.text !== undefined) {
      if (part.text) textParts.push({ type: "text", text: part.text });
      continue;
    }

    // Regular text (skip empty strings)
    if (part.text !== undefined && part.text !== "") {
      textParts.push({ type: "text", text: part.text });
    }

    // Inline data (images)
    if (part.inlineData) {
      textParts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      });
    }

    // Function call
    if (part.functionCall) {
      const name = part.functionCall.name;
      const id =
        part.functionCall.id || fallbackToolCallId(contentIndex, partIndex, name);
      const ids = unmatchedToolCallIds.get(name) || [];
      ids.push(id);
      unmatchedToolCallIds.set(name, ids);
      toolCalls.push({
        id,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }

    // Function response → collect all, each becomes a separate tool message
    if (part.functionResponse) {
      const name = part.functionResponse.name;
      const nativeId = part.functionResponse.id;
      if (nativeId) {
        removeMatchingToolCallId(unmatchedToolCallIds, name, nativeId);
      }
      const id =
        nativeId || dequeueMatchingToolCallId(unmatchedToolCallIds, name) || name;
      toolResults.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify(
          part.functionResponse.response?.result ||
            part.functionResponse.response ||
            {},
        ),
      });
    }
  }

  // Content with functionResponses — return array of tool result messages,
  // plus an assistant message for any co-located tool calls / text.
  // Preserves tool_calls when functionResponse and functionCall coexist in
  // the same content part, and skips empty text parts before they reach Claude.
  if (toolResults.length > 0) {
    if (toolCalls.length > 0 || textParts.length > 0 || reasoningContent) {
      const assistantMsg = { role: "assistant" };
      if (textParts.length > 0) {
        assistantMsg.content =
          textParts.length === 1 && textParts[0].type === "text"
            ? textParts[0].text
            : textParts;
      }
      if (reasoningContent) {
        assistantMsg.reasoning_content = reasoningContent;
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      return [...toolResults, assistantMsg];
    }
    return toolResults;
  }

  // Assistant with tool calls
  if (toolCalls.length > 0) {
    const msg = { role: "assistant" };
    if (textParts.length > 0) {
      msg.content =
        textParts.length === 1 && textParts[0].type === "text"
          ? textParts[0].text
          : textParts;
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    msg.tool_calls = toolCalls;
    return msg;
  }

  // Regular message
  if (textParts.length > 0 || reasoningContent) {
    const msg = { role };
    if (textParts.length > 0) {
      msg.content =
        textParts.length === 1 && textParts[0].type === "text"
          ? textParts[0].text
          : textParts;
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    return msg;
  }

  return null;
}

// Extract text from systemInstruction
function extractText(instruction) {
  if (typeof instruction === "string") return instruction;
  if (instruction.parts && Array.isArray(instruction.parts)) {
    return instruction.parts.map((p) => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, antigravityToOpenAIRequest, null);
