import { handleSearch } from "@/sse/handlers/search.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import {
  getProviderConnections,
  getModelAliases,
  getCustomModels,
  getCombos,
} from "@/lib/localDb";

const sessions = new Map();

export function registerNativeSession(sendFn) {
  const sid = crypto.randomUUID();
  sessions.set(sid, sendFn);
  return sid;
}

export function unregisterNativeSession(sid) {
  sessions.delete(sid);
}

export function sendNativeMessage(sid, data) {
  const send = sessions.get(sid);
  if (send) {
    send(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search Google in real-time with Google Search Grounding via 9Router (zero cost). Returns concise answers and verified citations.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on Google",
        },
        provider: {
          type: "string",
          description: "Search provider (default: 'antigravity')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_provider_status",
    description:
      "Check connected AI provider accounts on 9Router (Antigravity, Claude, Grok, OpenAI, etc.), showing active state, error status, and priority.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Optional filter by provider name (e.g. 'antigravity', 'claude', 'grok-cli')",
        },
      },
    },
  },
  {
    name: "list_available_models",
    description:
      "List all configured models, combos, and aliases available on this 9Router instance.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "generate_image",
    description:
      "Generate images from text prompts using AI image models via 9Router (Gemini, Imagen, GPT Image).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A text description of the desired image(s)",
        },
        model: {
          type: "string",
          description: "Image model to use (e.g. 'gemini-3.1-flash-image', 'imagen-3.0-generate-002', 'gpt-image-1')",
        },
        size: {
          type: "string",
          description: "Image resolution, e.g. '1024x1024' (default: '1024x1024')",
        },
      },
      required: ["prompt"],
    },
  },
];

async function executeTool(name, args) {
  if (name === "web_search") {
    const query = args?.query;
    if (!query) {
      return {
        isError: true,
        content: [{ type: "text", text: "Missing required argument: query" }],
      };
    }
    const provider = args?.provider || "antigravity";
    try {
      const searchReq = new Request("http://localhost/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          provider,
          model: "gemini-2.5-flash",
        }),
      });

      const res = await handleSearch(searchReq);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Search error (${res.status}): ${JSON.stringify(data)}`,
            },
          ],
        };
      }

      let text = "";
      if (data.answer?.text) {
        text += `### Summary\n${data.answer.text}\n\n`;
      }
      if (Array.isArray(data.results) && data.results.length > 0) {
        text += `### Sources & Citations\n`;
        data.results.forEach((item, index) => {
          text += `[${index + 1}] [${item.title || "Link"}](${item.url})\n${item.snippet || item.content || ""}\n\n`;
        });
      }
      if (!text) {
        text = JSON.stringify(data, null, 2);
      }

      return {
        content: [{ type: "text", text: text.trim() }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Failed to execute search: ${err.message}` },
        ],
      };
    }
  }

  if (name === "check_provider_status") {
    try {
      const filter = args?.provider ? { provider: args.provider } : {};
      const connections = await getProviderConnections(filter);
      const summary = connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name || "Default Account",
        isActive: Boolean(c.isActive),
        status: c.status || "ready",
        lastError: c.lastError || null,
        priority: c.priority ?? 999,
      }));

      const activeCount = summary.filter((c) => c.isActive).length;
      const text = [
        `### Provider Connections (${activeCount}/${summary.length} active)`,
        "```json",
        JSON.stringify(summary, null, 2),
        "```",
      ].join("\n");

      return {
        content: [{ type: "text", text }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Failed to fetch provider status: ${err.message}` },
        ],
      };
    }
  }

  if (name === "list_available_models") {
    try {
      const [aliases, customModels, combos] = await Promise.all([
        getModelAliases().catch(() => ({})),
        getCustomModels().catch(() => []),
        getCombos().catch(() => []),
      ]);

      const result = {
        aliases: aliases || {},
        customModels: customModels || [],
        combos: (combos || []).map((c) => ({
          name: c.name,
          strategy: c.strategy,
          models: c.models,
        })),
      };

      return {
        content: [
          {
            type: "text",
            text: `### 9Router Configured Models & Combos\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Failed to list models: ${err.message}` },
        ],
      };
    }
  }

  if (name === "generate_image") {
    const prompt = args?.prompt;
    if (!prompt) {
      return {
        isError: true,
        content: [{ type: "text", text: "Missing required argument: prompt" }],
      };
    }

    try {
      const imgReq = new Request("http://localhost/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: args.model || "gemini-3.1-flash-image",
          size: args.size || "1024x1024",
          n: 1,
        }),
      });

      const res = await handleImageGeneration(imgReq);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Image generation error (${res.status}): ${JSON.stringify(data)}`,
            },
          ],
        };
      }

      const images = (data.data || []).map((item) => item.url || item.b64_json);
      return {
        content: [
          {
            type: "text",
            text: `Generated Image(s):\n${images.join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Failed to generate image: ${err.message}` },
        ],
      };
    }
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

export async function handleNativeJsonRpc(sid, msg) {
  if (!msg || typeof msg !== "object") return;
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    sendNativeMessage(sid, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "9router-mcp",
          version: "1.0.0",
        },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    sendNativeMessage(sid, {
      jsonrpc: "2.0",
      id,
      result: {},
    });
    return;
  }

  if (method === "tools/list") {
    sendNativeMessage(sid, {
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS,
      },
    });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args } = msg.params || {};
    const toolResult = await executeTool(name, args);
    sendNativeMessage(sid, {
      jsonrpc: "2.0",
      id,
      result: toolResult,
    });
    return;
  }

  if (id !== undefined) {
    sendNativeMessage(sid, {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  }
}
