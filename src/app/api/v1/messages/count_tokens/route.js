const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function countValueChars(value) {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countValueChars(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (sum, [key, item]) => sum + key.length + countValueChars(item),
      0,
    );
  }
  return 0;
}

function countContentBlockChars(block) {
  if (!block || typeof block !== "object") return 0;

  switch (block.type) {
    case "text":
      return countValueChars(block.text);
    case "thinking":
      return countValueChars(block.thinking);
    case "tool_use":
      return countValueChars(block.name) + countValueChars(block.input);
    case "tool_result":
      return countValueChars(block.content);
    default:
      return countValueChars(block);
  }
}

function countMessageChars(message) {
  if (typeof message?.content === "string") return message.content.length;
  if (Array.isArray(message?.content)) {
    return message.content.reduce(
      (sum, block) => sum + countContentBlockChars(block),
      0,
    );
  }
  return 0;
}

export function estimateAnthropicInputTokens(body) {
  let totalChars = 0;

  if (typeof body?.system === "string") {
    totalChars += body.system.length;
  } else if (Array.isArray(body?.system)) {
    totalChars += body.system.reduce(
      (sum, block) => sum + countContentBlockChars(block),
      0,
    );
  }

  if (Array.isArray(body?.tools)) {
    totalChars += body.tools.reduce(
      (sum, tool) =>
        sum +
        countValueChars(tool.name) +
        countValueChars(tool.description) +
        countValueChars(tool.input_schema),
      0,
    );
  }

  if (Array.isArray(body?.messages)) {
    totalChars += body.messages.reduce(
      (sum, message) => sum + countMessageChars(message),
      0,
    );
  }

  return Math.ceil(totalChars / 4);
}

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

  const inputTokens = estimateAnthropicInputTokens(body);

  return new Response(JSON.stringify({ input_tokens: inputTokens }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
