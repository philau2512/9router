import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { resolveRealIP } from "./dns-resolver.js";
import { dbg } from "./debugLog.js";

// Reuse TCP+TLS connections across requests to the same upstream origin,
// avoiding repeated handshakes that add 200-800ms per cold request.
export const directAgents = new Map();

/**
 * Get or create a pooled undici Agent for direct (non-proxy) upstream requests.
 * Keyed by origin (scheme + hostname + port) to match HTTP connection semantics.
 */
export async function getDirectAgent(targetUrl) {
  let origin;
  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin; // e.g. "https://api.opencode.ai"
  } catch {
    return null;
  }

  if (!directAgents.has(origin)) {
    // Pre-warm DNS cache via Google DNS for this origin (non-blocking)
    try { const h = new URL("https://" + origin.replace(/^https?:\/\//, "")).hostname; resolveRealIP(h).catch(() => {}); } catch { /* ignore */ }
    // Evict oldest entry if max size reached
    if (directAgents.size >= MEMORY_CONFIG.directAgentsMaxSize) {
      const oldestKey = directAgents.keys().next().value;
      const oldestAgent = directAgents.get(oldestKey);
      if (oldestAgent) {
        try {
          oldestAgent.close();
        } catch (e) {
          dbg(
            "POOL",
            `Failed to close evicted agent for ${oldestKey}: ${e.message}`,
          );
        }
      }
      directAgents.delete(oldestKey);
    }
    const { Agent } = await import("undici");
    directAgents.set(
      origin,
      new Agent({
        keepAliveTimeout: 60_000,
        keepAliveMaxTimeout: 300_000,
        connections: 50,
        pipelining: 0,  // H2 multiplexing (was 1 for H1 pipeline)
        allowH2: true,
        connect: {
          timeout: 30_000,
          keepAlive: true,
          keepAliveInitialDelay: 1000,
        },
      }),
    );
    dbg(
      "POOL",
      `Created pooled agent for ${origin} (total: ${directAgents.size})`,
    );
  }

  return directAgents.get(origin);
}


/**
 * Pre-create undici agents for all provider origins on server start.
 * Fire-and-forget — does not block startup.
 * @param {object} providers — PROVIDERS config object
 */
export async function warmupProviderAgents(providers) {
  if (!providers || typeof providers !== "object") return;
  const origins = new Set();
  for (const cfg of Object.values(providers)) {
    const urls = cfg.baseUrls || (cfg.baseUrl ? [cfg.baseUrl] : []);
    for (const url of urls) {
      try { origins.add(new URL(url).origin); } catch { /* skip invalid */ }
    }
  }
  const results = await Promise.allSettled(
    [...origins].map(origin => getDirectAgent(origin))
  );
  const ok = results.filter(r => r.status === "fulfilled" && r.value).length;
  console.log(`[WARMUP] Pre-connected ${ok}/${origins.size} provider agents`);
}