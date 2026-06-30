import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import {
  MAX_IMAGE_BYTES,
  FETCH_TIMEOUT_MS,
  IMAGE_SIGNATURES,
  BLOCKED_HOSTS,
} from "../../config/mediaConfig.js";

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 *
 * SSRF hardening (GHSA-cmhj-wh2f-9cgx):
 * - Resolves DNS once, rejects private/reserved IPs.
 * - Pins TCP connect to validated IP so a second DNS resolution cannot rebind.
 * - Hard byte cap to prevent memory DoS.
 * - redirect:"manual" prevents public→private redirect SSRF bypass.
 *
 * Returns null if fetch fails or SSRF guard triggers.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */

// True if an IPv4/IPv6 address is private/reserved (SSRF target).
function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv4 private ranges
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true; // link-local / IMDS
  if (/^0\./.test(ip)) return true;
  // IPv6 loopback/link-local
  if (ip === "::1") return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

// Resolve host once and return only public IPs (SSRF guard).
// Rejects if any resolved record is private/reserved (defeats multi-A tricks).
async function resolvePinnedIps(hostname) {
  if (!hostname || BLOCKED_HOSTS.has(hostname.toLowerCase())) return null;
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length || records.some((r) => isPrivateIp(r.address)))
      return null;
    return records;
  } catch {
    return null;
  }
}

export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS } = options;
  if (
    !imageUrl ||
    (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))
  ) {
    return null;
  }

  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  const pinnedIps = await resolvePinnedIps(url.hostname);
  if (!pinnedIps) return null;

  const controller = new AbortController();
  const timeout = signal
    ? null
    : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;

  // Pin connect to the validated IP so no second DNS resolution can rebind (TOCTOU fix).
  const dispatcher = new Agent({
    connect: {
      lookup: (_h, _o, cb) =>
        cb(null, [
          { address: pinnedIps[0].address, family: pinnedIps[0].family },
        ]),
    },
  });

  try {
    // redirect:"manual" prevents a public URL redirecting to a private one (SSRF bypass).
    const response = await fetch(imageUrl, {
      signal: fetchSignal,
      redirect: "manual",
      dispatcher,
    });
    if (!response.ok || !response.body) return null;

    // Stream-read with a hard byte cap to avoid loading huge payloads into memory.
    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) return null;
      chunks.push(value);
    }

    const mimeType =
      response.headers.get("Content-Type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    const arrayBuffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const base64 = arrayBuffer.toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    dispatcher.close().catch(() => {});
  }
}
