/**
 * Codex WebSocket executor (Phase 6)
 * Persistent WS connection pool per credential — reduces per-request TCP+auth overhead.
 * Ported from CLIProxyAPI internal/runtime/executor/codex_websockets_executor.go
 *
 * Feature-flagged: set CODEX_WS_ENABLED=true to activate.
 * Default: false — existing HTTP SSE path unchanged.
 */

const CODEX_WS_ENABLED = process.env.CODEX_WS_ENABLED === "true";
const IDLE_TTL_MS = 5 * 60 * 1000; // close idle connections after 5 min
const MAX_POOL_SIZE = 10; // max connections per credential
const MAX_RECONNECT_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Single persistent WebSocket connection to Codex Responses API.
 * Multiplexes requests by response ID.
 */
class CodexWSConnection {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.ws = null;
    this.pending = new Map(); // responseId → { resolve, reject, chunks }
    this.reconnectAttempts = 0;
    this.lastUsed = Date.now();
    this._healthy = false;
    this._connectPromise = null;
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async _doConnect() {
    const wsUrl =
      this.baseUrl
        .replace(/^https:/, "wss:")
        .replace(/^http:/, "ws:")
        .replace(/\/v1\/?$/, "") + "/v1/realtime";

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        ws.onopen = () => {
          this._healthy = true;
          this.reconnectAttempts = 0;
          this.ws = ws;
          resolve();
        };
        ws.onerror = (err) => {
          this._healthy = false;
          reject(err);
        };
        ws.onclose = () => {
          this._healthy = false;
          // Reject all pending requests
          for (const [, p] of this.pending) {
            p.reject(new Error("WebSocket closed unexpectedly"));
          }
          this.pending.clear();
        };
        ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(data) {
    try {
      const msg = JSON.parse(data);
      const responseId =
        msg?.response?.id || msg?.item?.response_id || msg?.response_id;
      if (!responseId) return;
      const pending = this.pending.get(responseId);
      if (!pending) return;

      if (msg.type === "response.completed" || msg.type === "response.failed") {
        pending.chunks.push(data);
        this.pending.delete(responseId);
        pending.resolve(pending.chunks);
        return;
      }
      if (msg.type === "error") {
        this.pending.delete(responseId);
        pending.reject(new Error(msg.error?.message || "Codex WS error"));
        return;
      }
      pending.chunks.push(data);
    } catch {
      // ignore parse errors
    }
  }

  isHealthy() {
    return this._healthy && this.ws?.readyState === 1;
  }

  async sendRequest(payload, signal) {
    if (!this.isHealthy()) throw new Error("Connection not healthy");
    this.lastUsed = Date.now();

    return new Promise((resolve, reject) => {
      let timeoutId;
      const responseId =
        payload?.response_id || `wr_${Date.now().toString(36)}`;
      const body = { ...payload, response_id: responseId };

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.pending.delete(responseId);
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Codex WS request timeout"));
      }, REQUEST_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            cleanup();
            reject(new Error("AbortError"));
          },
          { once: true },
        );
      }

      this.pending.set(responseId, {
        resolve: (chunks) => {
          cleanup();
          resolve(chunks);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        chunks: [],
      });

      try {
        this.ws.send(JSON.stringify(body));
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  close() {
    this._healthy = false;
    try {
      this.ws?.close();
    } catch {}
  }
}

/**
 * Connection pool keyed by credential hash.
 */
class CodexWSPool {
  constructor() {
    this.pools = new Map(); // credKey → CodexWSConnection[]
    this._cleanupInterval = setInterval(() => this._cleanup(), IDLE_TTL_MS);
    if (this._cleanupInterval?.unref) this._cleanupInterval.unref();
  }

  _key(baseUrl, apiKey) {
    return `${baseUrl}::${apiKey.slice(-12)}`;
  }

  async acquire(baseUrl, apiKey) {
    const key = this._key(baseUrl, apiKey);
    if (!this.pools.has(key)) this.pools.set(key, []);
    const pool = this.pools.get(key);

    // Find healthy idle connection
    for (const conn of pool) {
      if (conn.isHealthy() && conn.pending.size === 0) {
        conn.lastUsed = Date.now();
        return conn;
      }
    }

    // Create new if under limit
    if (pool.length < MAX_POOL_SIZE) {
      const conn = new CodexWSConnection(baseUrl, apiKey);
      pool.push(conn);
      let attempts = 0;
      while (attempts < MAX_RECONNECT_ATTEMPTS) {
        try {
          await conn.connect();
          return conn;
        } catch {
          attempts++;
          if (attempts >= MAX_RECONNECT_ATTEMPTS)
            throw new Error("Codex WS: failed to connect after 3 attempts");
          await new Promise((r) => setTimeout(r, 500 * attempts));
        }
      }
    }

    throw new Error("Codex WS pool exhausted");
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, pool] of this.pools.entries()) {
      const active = pool.filter((conn) => {
        if (now - conn.lastUsed > IDLE_TTL_MS && conn.pending.size === 0) {
          conn.close();
          return false;
        }
        return true;
      });
      if (active.length === 0) this.pools.delete(key);
      else this.pools.set(key, active);
    }
  }
}

const _globalPool = CODEX_WS_ENABLED ? new CodexWSPool() : null;

/**
 * Try to execute a Codex request over WebSocket.
 * Returns a Response-like object compatible with existing SSE pipeline, or null on failure.
 *
 * @param {{ baseUrl: string, apiKey: string }} auth
 * @param {object} payload - Codex Responses API request body
 * @param {AbortSignal} signal
 * @returns {Promise<Response|null>}
 */
export async function tryCodexWSRequest(auth, payload, signal) {
  if (!CODEX_WS_ENABLED || !_globalPool) return null;
  try {
    const conn = await _globalPool.acquire(auth.baseUrl, auth.apiKey);
    const chunks = await conn.sendRequest(payload, signal);
    // Convert chunk array into SSE-formatted ReadableStream
    const sseBody = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(enc.encode(`data: ${chunk}\n\n`));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(sseBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  } catch (err) {
    console.warn(
      "[CODEX-WS] WS attempt failed, falling back to HTTP SSE:",
      err.message,
    );
    return null;
  }
}

export { CODEX_WS_ENABLED };
