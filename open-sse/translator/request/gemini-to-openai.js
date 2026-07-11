import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.js";

// Convert Gemini request to OpenAI format
export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream,
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = {
        max_tokens: config.maxOutputTokens,
        tools: body.tools,
      };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: "system",
        content: systemText,
      });
    }
  }

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents) {
      const converted = convertGeminiContent(content);
      if (converted) {
        result.messages.push(converted);
      }
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} },
            },
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content) {
  const role = content.role === "user" ? "user" : "assistant";

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  let reasoningContent = ""; // Accumulate thought parts → reasoning_content

  for (const part of content.parts) {
    if (part.text !== undefined) {
      if (part.thought) {
        // Thought parts → reasoning_content, not visible text
        reasoningContent += part.text;
      } else {
        parts.push({ type: "text", text: part.text });
      }
    }

    if (part.inlineData) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      });
    }

    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }

    if (part.functionResponse) {
      return {
        role: "tool",
        tool_call_id: part.functionResponse.id || part.functionResponse.name,
        content: JSON.stringify(
          part.functionResponse.response?.result ||
            part.functionResponse.response ||
            {},
        ),
      };
    }
  }

  if (toolCalls.length > 0) {
    const result = { role: "assistant" };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? parts[0].text : parts;
    }
    result.tool_calls = toolCalls;
    if (reasoningContent) result.reasoning_content = reasoningContent;
    return result;
  }

  if (parts.length > 0) {
    const result = {
      role,
      content:
        parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts,
    };
    if (role === "assistant" && reasoningContent)
      result.reasoning_content = reasoningContent;
    return result;
  }

  // Only reasoning content (no visible text/tool calls)
  if (reasoningContent) {
    return {
      role: "assistant",
      content: "",
      reasoning_content: reasoningContent,
    };
  }

  return null;
}

// Extract text from Gemini content
function extractGeminiText(content) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map((p) => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);

/**
 * Fixed wrapper for geminiToOpenAIRequest that handles contents where
 * functionResponse parts are co-located with functionCall or text parts.
 *
 * Problem: convertGeminiContent() returns early on the first functionResponse,
 * discarding any co-located functionCall/text parts in the same content.
 *
 * Fix: Pre-split mixed contents into separate sub-contents before delegating
 * to the original translator. Tool results are emitted before remaining parts
 * to match expected message ordering.
 */
function geminiToOpenAIRequestFixed(model, body, stream) {
  if (!body.contents || !Array.isArray(body.contents)) {
    return geminiToOpenAIRequest(model, body, stream);
  }

  const fixedContents = [];
  for (const content of body.contents) {
    if (!content.parts || !Array.isArray(content.parts)) {
      fixedContents.push(content);
      continue;
    }

    const functionResponseParts = content.parts.filter(
      (p) => p.functionResponse,
    );
    const otherParts = content.parts.filter((p) => !p.functionResponse);

    // No mixing — pass through unchanged
    if (functionResponseParts.length === 0 || otherParts.length === 0) {
      fixedContents.push(content);
      continue;
    }

    // Emit one sub-content per functionResponse (tool results first)
    for (const frPart of functionResponseParts) {
      fixedContents.push({ ...content, parts: [frPart] });
    }
    // Emit remaining parts (functionCall/text) under original role
    fixedContents.push({ ...content, parts: otherParts });
  }

  return geminiToOpenAIRequest(
    model,
    { ...body, contents: fixedContents },
    stream,
  );
}

// Override: last registration wins — route through fixed wrapper
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequestFixed, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequestFixed, null);
