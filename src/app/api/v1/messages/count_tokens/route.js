const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /v1/messages/count_tokens - Estimate token count for a request
 *
 * Extends the basic estimator to cover structured Anthropic block types:
 * tool_use.input, tool_result.content, thinking blocks, system prompt, tools defs.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Count chars in a content block (recursive for nested content)
  function countBlockChars(block) {
    if (!block || typeof block !== "object") return 0;
    let chars = 0;
    switch (block.type) {
      case "text":
        chars += (block.text || "").length;
        break;
      case "thinking":
        chars += (block.thinking || "").length;
        break;
      case "tool_use":
        chars += (block.name || "").length;
        // Serialize input object to estimate token cost
        chars += block.input ? JSON.stringify(block.input).length : 0;
        break;
      case "tool_result":
        if (typeof block.content === "string") {
          chars += block.content.length;
        } else if (Array.isArray(block.content)) {
          for (const inner of block.content) chars += countBlockChars(inner);
        }
        break;
      default:
        // Fallback: stringify unknown block types
        chars += JSON.stringify(block).length;
    }
    return chars;
  }

  let totalChars = 0;

  // Count system prompt
  if (body.system) {
    if (typeof body.system === "string") {
      totalChars += body.system.length;
    } else if (Array.isArray(body.system)) {
      for (const block of body.system) totalChars += countBlockChars(block);
    }
  }

  // Count tools definitions
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      totalChars += (tool.name || "").length;
      totalChars += (tool.description || "").length;
      totalChars += tool.input_schema ? JSON.stringify(tool.input_schema).length : 0;
    }
  }

  // Count messages
  const messages = body.messages || [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) totalChars += countBlockChars(block);
    }
  }

  // Rough estimate: ~4 chars per token
  const inputTokens = Math.ceil(totalChars / 4);

  return new Response(
    JSON.stringify({ input_tokens: inputTokens }),
    { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
  );
}
