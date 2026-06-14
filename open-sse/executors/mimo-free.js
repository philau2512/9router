import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash, randomUUID } from "crypto";
import os from "os";
import { makeKv } from "../../src/lib/db/helpers/kvStore.js";
import { getProxyPools } from "../../src/lib/db/repos/proxyPoolsRepo.js";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = "https://api.xiaomimimo.com/api/free-ai/openai/chat";
const SESSION_AFFINITY_PREFIX = "ses_";
const SESSION_ID_LENGTH = 24;
const JWT_FALLBACK_TTL_SEC = 3000;
const JWT_EXPIRY_BUFFER_MS = 300000;
const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Anti-abuse gate marker: the free chat endpoint returns 403 "Illegal access"
// unless a system message contains this exact MiMoCode signature substring.
export const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

// Persistent key-value store for Mimo Free
const kv = makeKv("mimo-free");

// Device fingerprint reused as the bootstrap "client" — stable per machine
function generateFingerprint() {
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {
    // ignore
  }
  const cpu = (os.cpus()[0]?.model || "unknown-cpu").trim();
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}|${username}`;
  return createHash("sha256").update(seed).digest("hex");
}

function generateSessionId() {
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return id;
}

// Derive expiry from the JWT exp claim; fall back to a fixed TTL when unparseable
function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64").toString(),
    );
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // ignore
  }
  return Date.now() + JWT_FALLBACK_TTL_SEC * 1000;
}

// Ensure the body carries the anti-abuse marker in a system message (idempotent)
function injectSystemMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (m) =>
      m?.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes(MIMO_SYSTEM_MARKER),
  );
  if (hasMarker) return body;
  return {
    ...body,
    messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages],
  };
}

async function resetJwtCache() {
  await kv.remove("jwt");
  await kv.remove("jwtExpiresAt");
}

async function bootstrapJwt(proxyOptions = null, forceNewFingerprint = false, log = null) {
  let fingerprint = await kv.get("fingerprint");
  if (!fingerprint || forceNewFingerprint) {
    if (forceNewFingerprint) {
      fingerprint = createHash("sha256").update(randomUUID()).digest("hex");
      log?.warn?.("AUTH", `MiMo: Rotating fingerprint to: ${fingerprint}`);
    } else {
      fingerprint = generateFingerprint();
    }
    await kv.set("fingerprint", fingerprint);
  }

  const cachedJwt = await kv.get("jwt");
  const jwtExpiresAt = await kv.get("jwtExpiresAt", 0);

  if (!forceNewFingerprint && cachedJwt && Date.now() < jwtExpiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cachedJwt;
  }

  // 1. Gather all proxy candidates
  let candidateProxyUrls = [];

  // Parse connection-specific proxy pool if available
  if (proxyOptions?.proxyPool?.proxyUrl) {
    const urls = proxyOptions.proxyPool.proxyUrl
      .split(/[\n,;]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    candidateProxyUrls.push(...urls);
  }

  // Check all active proxy pools in the system as candidates/fallbacks
  try {
    const activePools = await getProxyPools({ isActive: true });
    for (const pool of activePools) {
      if (pool?.proxyUrl && (pool.type === "http" || pool.type === "socks" || !pool.type)) {
        const urls = pool.proxyUrl
          .split(/[\n,;]+/)
          .map((u) => u.trim())
          .filter(Boolean);
        candidateProxyUrls.push(...urls);
      }
    }
  } catch (err) {
    log?.warn?.("AUTH", `MiMo: Failed to read active proxy pools: ${err.message}`);
  }

  // Deduplicate candidate URLs
  candidateProxyUrls = Array.from(new Set(candidateProxyUrls));

  let attempt = 0;
  const maxAttempts = 3;
  while (attempt < maxAttempts) {
    // Select proxy for this attempt
    let activeProxyOptions = proxyOptions;
    if (candidateProxyUrls.length > 0) {
      const chosenProxyUrl = candidateProxyUrls[attempt % candidateProxyUrls.length];
      activeProxyOptions = {
        ...(proxyOptions || {}),
        connectionProxyEnabled: true,
        connectionProxyUrl: chosenProxyUrl,
        url: chosenProxyUrl,
      };
      log?.debug?.("AUTH", `MiMo bootstrap attempt ${attempt + 1}: Using proxy ${chosenProxyUrl}`);
    }

    try {
      const response = await proxyAwareFetch(
        BOOTSTRAP_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: fingerprint }),
        },
        activeProxyOptions,
      );

      if (response.status === 429) {
        attempt++;
        if (attempt < maxAttempts) {
          fingerprint = createHash("sha256").update(randomUUID()).digest("hex");
          await kv.set("fingerprint", fingerprint);
          log?.warn?.("AUTH", `MiMo bootstrap got 429, rotating fingerprint (attempt ${attempt}/${maxAttempts}): ${fingerprint}`);
          continue;
        }
        throw new Error("MiMo bootstrap failed: 429");
      }

      if (!response.ok) {
        throw new Error(`MiMo bootstrap failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.jwt) {
        throw new Error("MiMo bootstrap returned no JWT");
      }

      await kv.set("jwt", data.jwt);
      const exp = parseJwtExp(data.jwt);
      await kv.set("jwtExpiresAt", exp);
      return data.jwt;
    } catch (error) {
      if (error.message.includes("429") && attempt < maxAttempts) {
        continue;
      }
      throw error;
    }
  }
}

export class MimoFreeExecutor extends BaseExecutor {
  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl() {
    return CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "x-session-affinity": this.sessionId,
      Accept: stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model, body) {
    return injectSystemMarker(body);
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }) {
    let jwt;
    try {
      jwt = await bootstrapJwt(proxyOptions, false, log);
    } catch (error) {
      log?.error?.("AUTH", `MiMo bootstrap failed: ${error.message}`);
      throw error;
    }

    const url = this.buildUrl();
    const transformedBody = this.transformRequest(model, body);
    const headers = {
      ...this.buildHeaders(credentials, stream),
      Authorization: `Bearer ${jwt}`,
    };
    const bodyStr = JSON.stringify(transformedBody);
    log?.debug?.("FETCH", `MIMO-FREE → ${url} | body=${bodyStr.length}B`);

    let response = await proxyAwareFetch(
      url,
      { method: "POST", headers, body: bodyStr, signal },
      proxyOptions,
    );

    // On auth failure, invalidate cache, rotate fingerprint, and retry once with a fresh JWT
    if (response.status === 401 || response.status === 403) {
      log?.debug?.(
        "AUTH",
        `MiMo auth failed (${response.status}), rotating fingerprint and re-bootstrapping...`,
      );
      await resetJwtCache();
      jwt = await bootstrapJwt(proxyOptions, true, log);
      headers["Authorization"] = `Bearer ${jwt}`;
      response = await proxyAwareFetch(
        url,
        { method: "POST", headers, body: bodyStr, signal },
        proxyOptions,
      );
    }

    return { response, url, headers, transformedBody };
  }
}

export const __test__ = {
  generateFingerprint,
  generateSessionId,
  bootstrapJwt,
  resetJwtCache,
  parseJwtExp,
  injectSystemMarker,
  MIMO_SYSTEM_MARKER,
  BOOTSTRAP_URL,
  CHAT_URL,
  SESSION_AFFINITY_PREFIX,
  kv,
};

export default MimoFreeExecutor;
