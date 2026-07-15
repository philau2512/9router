/**
 * Mode prompts: common_prefix + mode prompt from byok assets when present.
 * Tools: prefer assets/{mode}/tools.json OpenAI-shaped conversion; fallback static.
 */
const fs = require("fs");
const path = require("path");

const ASSETS = path.join(__dirname, "assets");

const FALLBACK_TOOLS = {
  agent: [
    tool("Shell", "Run a shell command", {
      command: { type: "string" },
      working_directory: { type: "string" },
      description: { type: "string" },
    }, ["command"]),
    tool("Read", "Read a file", { path: { type: "string" } }, ["path"]),
    tool("Edit", "Replace text in a file", {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    }, ["path", "old_string", "new_string"]),
    tool("Write", "Write a file", {
      path: { type: "string" },
      contents: { type: "string" },
    }, ["path", "contents"]),
    tool("Grep", "Search file contents", {
      pattern: { type: "string" },
      path: { type: "string" },
    }, ["pattern"]),
    tool("Delete", "Delete a file", { path: { type: "string" } }, ["path"]),
    tool("LS", "List directory", { path: { type: "string" } }, ["path"]),
    tool("ReadLints", "Read linter errors for files", {
      paths: { type: "array", items: { type: "string" } },
    }, []),
  ],
  ask: [],
  plan: [
    tool("Read", "Read a file for planning", { path: { type: "string" } }, ["path"]),
    tool("Grep", "Search codebase", {
      pattern: { type: "string" },
      path: { type: "string" },
    }, ["pattern"]),
    tool("LS", "List directory", { path: { type: "string" } }, ["path"]),
  ],
};

function tool(name, description, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: properties || {},
        required: required || [],
      },
    },
  };
}

function normalizeMode(mode) {
  const m = String(mode || "agent").toLowerCase();
  if (["ask", "plan", "debug", "multitask", "subagent", "agent"].includes(m))
    return m;
  return "agent";
}

// ── In-process cache so disk reads only happen once per process lifetime ─────
const _assetCache = new Map();
const _compiledCache = new Map();

function readAsset(...parts) {
  const key = parts.join("/");
  if (_assetCache.has(key)) return _assetCache.get(key);
  try {
    const p = path.join(ASSETS, ...parts);
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, "utf8");
      _assetCache.set(key, v);
      return v;
    }
  } catch {
    /* ignore */
  }
  _assetCache.set(key, null);
  return null;
}

/** Convert byok tools.json (if array of {name,description,parameters}) to OpenAI tools */
function loadToolsFromAsset(mode) {
  const raw = readAsset(mode, "tools.json");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tools)
        ? parsed.tools
        : null;
    if (!arr?.length) return null;
    return arr
      .map((t) => {
        const name = t.name || t.function?.name;
        if (!name) return null;
        if (t.type === "function" && t.function) return t;
        return {
          type: "function",
          function: {
            name,
            description: t.description || t.function?.description || name,
            parameters:
              t.parameters ||
              t.function?.parameters ||
              { type: "object", properties: {} },
          },
        };
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

function compilePrompt(mode, displayModel) {
  const m = normalizeMode(mode);
  // Cache key: mode + displayModel (model label only affects template replacement)
  const cacheKey = `${m}:${String(displayModel || "")}`;
  if (_compiledCache.has(cacheKey)) return _compiledCache.get(cacheKey);

  const prefix = readAsset("common_prefix.md") || "";
  let body = readAsset(m, "prompt.md") || "";
  if (!body) {
    body =
      m === "ask"
        ? "You are in Ask mode. Answer questions; do not edit files."
        : m === "plan"
          ? "You are in Plan mode. Explore and produce an implementation plan."
          : "You are a coding agent in Cursor routed through 9Router.";
  }
  let system = [prefix, body].filter(Boolean).join("\n\n");
  const modelLabel = displayModel || "9router-model";
  system = system.replace(/\{\{FAKE_MODEL_ID\}\}/g, modelLabel);

  let tools = loadToolsFromAsset(m);
  if (!tools) {
    if (m === "ask") tools = FALLBACK_TOOLS.ask;
    else if (m === "plan") tools = FALLBACK_TOOLS.plan;
    else tools = FALLBACK_TOOLS.agent; // agent, debug, multitask, subagent
  }
  // Ask mode: strip destructive write tools
  if (m === "ask") {
    tools = (tools || []).filter((t) => {
      const n = String(t.function?.name || "");
      return !["Write", "PatchEdit", "Delete", "Edit"].includes(n);
    });
  }

  const result = { mode: m, system, tools: tools || [] };
  _compiledCache.set(cacheKey, result);
  return result;
}

module.exports = {
  compilePrompt,
  normalizeMode,
  loadToolsFromAsset,
  FALLBACK_TOOLS,
};
