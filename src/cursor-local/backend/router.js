/**
 * Backend router: health, mocks, tab, BidiAppend, RunSSE.
 */
const { healthHandler } = require("./health");
const { tryHandleMock } = require("./mocks");
const { handleBidiAppend } = require("./agent/bidiAppend");
const { handleRunSSE } = require("./agent/runSse");
const { log } = require("../logger");

function createRouter() {
  return async function handle(req, res) {
    const url = req.url || "/";
    const pathOnly = url.split("?")[0];

    if (
      req.method === "GET" &&
      (pathOnly === "/healthz" || pathOnly === "/_cursor_local_health")
    ) {
      return healthHandler(req, res);
    }

    // Agent dual-RPC
    if (pathOnly.includes("BidiAppend") || pathOnly.endsWith("/BidiAppend")) {
      return handleBidiAppend(req, res);
    }
    if (
      pathOnly.includes("RunSSE") ||
      pathOnly.endsWith("/RunSSE") ||
      pathOnly.endsWith("/Run") ||
      pathOnly.includes("AgentService/Run")
    ) {
      return handleRunSSE(req, res);
    }

    // Mocks + tab + telemetry
    const mocked = await tryHandleMock(req, res, pathOnly);
    if (mocked) return;

    // Log agent-ish paths loudly — missing StreamUnifiedChat etc. would show here
    if (
      pathOnly.includes("Chat") ||
      pathOnly.includes("Agent") ||
      pathOnly.includes("Bidi") ||
      pathOnly.includes("Stream") ||
      pathOnly.includes("Run")
    ) {
      log(`backend AGENT-UNHANDLED ${req.method} ${pathOnly}`);
    } else {
      log(`backend unhandled ${req.method} ${pathOnly}`);
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "x-cursor-local": "unhandled",
    });
    res.end(
      JSON.stringify({
        ok: true,
        unhandled: true,
        path: pathOnly,
        phase: "C+",
      }),
    );
  };
}

module.exports = { createRouter };
