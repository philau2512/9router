const http = require("http");
const https = require("https");
const { URL } = require("url");
const { log, err } = require("../logger");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
]);

/**
 * Forward decrypted Cursor request to local backend, preserving path/query.
 */
function forwardToBackend(incoming, backendBase) {
  return new Promise((resolve, reject) => {
    let base;
    try {
      base = new URL(backendBase.endsWith("/") ? backendBase : `${backendBase}/`);
    } catch (e) {
      return reject(new Error(`Invalid backend base: ${backendBase}`));
    }

    const pathQuery =
      (incoming.url || "/").startsWith("http")
        ? new URL(incoming.url).pathname + new URL(incoming.url).search
        : incoming.url || "/";

    const target = new URL(pathQuery, base);
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers = { ...incoming.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    headers.host = target.host;
    // Original absolute URL for policy (byok X-Server-Upstream-URL)
    try {
      const rawHost = incoming.headers.host || "";
      const rawUrl = `https://${rawHost}${pathQuery}`;
      headers["x-server-upstream-url"] = rawUrl;
    } catch {
      /* ignore */
    }

    const opts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: incoming.method || "GET",
      headers,
      timeout: 600000,
    };

    const req = lib.request(opts, (res) => {
      resolve(res);
    });
    req.on("error", (e) => {
      err(`forward error: ${e.message}`);
      reject(e);
    });
    req.on("timeout", () => {
      req.destroy(new Error("backend forward timeout"));
    });

    if (incoming.pipe) {
      incoming.pipe(req);
    } else {
      req.end();
    }
  });
}

module.exports = { forwardToBackend };
