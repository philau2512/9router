/**
 * Antigravity reasoning replay cache (Phase 5)
 * Session-keyed in-memory cache for thinking content cross-request carry-over.
 * Ported from CLIProxyAPI internal/runtime/executor/antigravity_reasoning_replay.go
 */

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Simple LRU via Map insertion order
const _cache = new Map(); // key -> { thinking, updatedAt }

function _evictExpired() {
  const now = Date.now();
  for (const [key, entry] of _cache.entries()) {
    if (now - entry.updatedAt > SESSION_TTL_MS) _cache.delete(key);
  }
}

function _evictOldest() {
  if (_cache.size >= MAX_SESSIONS) {
    _cache.delete(_cache.keys().next().value);
  }
}

// djb2 hash for stable session ID from content
function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/**
 * Derive a session key from model + body.
 * Priority: explicit sessionId/session_id fields → stable hash of first user message.
 * Returns null if no stable key can be derived.
 */
export function getAntigravitySessionKey(model, body) {
  if (!model || !body) return null;
  // Explicit session ID paths (CLIProxyAPI: antigravityReplaySessionIDFromPayload)
  const sid =
    body?.sessionId ||
    body?.session_id ||
    body?.request?.sessionId ||
    body?.request?.session_id;
  if (sid && typeof sid === "string" && sid.trim()) {
    return `${model}:session:${sid.trim()}`;
  }
  // Stable hash from first user message
  const firstUser =
    body?.contents?.find?.((c) => c.role === "user") ||
    body?.request?.contents?.find?.((c) => c.role === "user") ||
    body?.messages?.find?.((m) => m.role === "user");
  if (firstUser) {
    const text = JSON.stringify(firstUser).slice(0, 256);
    return `${model}:hash:${_djb2(text)}`;
  }
  return null;
}

/**
 * Get cached thinking for a session key.
 */
export function getCachedThinking(sessionKey) {
  if (!sessionKey) return null;
  const entry = _cache.get(sessionKey);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > SESSION_TTL_MS) {
    _cache.delete(sessionKey);
    return null;
  }
  return entry.thinking;
}

/**
 * Store thinking content for a session key.
 */
export function setCachedThinking(sessionKey, thinking) {
  if (!sessionKey || !thinking || typeof thinking !== "string" || !thinking.trim()) return;
  _evictExpired();
  _evictOldest();
  _cache.set(sessionKey, { thinking, updatedAt: Date.now() });
}

/**
 * Inject cached thinking into the last assistant turn of an antigravity contents array.
 * Only injects when the last assistant turn has no existing thought parts.
 */
export function injectThinkingReplay(body, cachedThinking) {
  if (!cachedThinking || !body) return body;
  const contents = body.request?.contents || body.contents;
  if (!Array.isArray(contents) || contents.length === 0) return body;

  const lastAssistantIdx = [...contents].map((c) => c.role).lastIndexOf("model");
  if (lastAssistantIdx < 0) return body;

  const lastAsst = contents[lastAssistantIdx];
  // Skip if already has thought parts
  if (lastAsst.parts?.some?.((p) => p.thought === true)) return body;

  const thinkingPart = { thought: true, text: cachedThinking };
  const newContents = [...contents];
  newContents[lastAssistantIdx] = {
    ...lastAsst,
    parts: [thinkingPart, ...(lastAsst.parts || [])],
  };

  if (body.request?.contents) {
    return { ...body, request: { ...body.request, contents: newContents } };
  }
  return { ...body, contents: newContents };
}
