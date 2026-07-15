/**
 * Tab/CPP path proxy — byok uses https://tab.leokun.cn
 * Set CURSOR_LOCAL_TAB_BASE=https://tab.leokun.cn to enable real tab completions.
 * Fail-open: empty 200 if unset / upstream fails.
 */
const https = require("https");
const http = require("http");
const { URL } = require("url");
const { readBody, writeUnaryProto } = require("../proto/connect");
const { log, err } = require("../../logger");

const TAB_PATHS = [
  "StreamCpp",
  "StreamNextCursorPrediction",
  "GetCppEditClassification",
  "RefreshTabContext",
  "CppConfig",
  "CppEditHistory",
  "CppEditHistoryStatus",
  "CppAppend",
  "ReportAiCodeChangeMetrics",
  "WriteGitCommitMessage",
  "WriteGitBranchName",
  "CppService/",
  "FileSyncService/",
  "FSSyncFile",
  "FSIsEnabledForUser",
  "FSConfig",
  "FSUploadFile",
];

function isTabPath(pathOnly) {
  const p = pathOnly || "";
  return TAB_PATHS.some((t) => p.includes(t));
}

function getTabBase() {
  return (
    process.env.CURSOR_LOCAL_TAB_BASE ||
    process.env.TAB_SERVER_BASE_URL ||
    ""
  ).replace(/\/+$/, "");
}

/** Full bidirectional proxy: forwards request body + streams response back */
async function proxyTabRequest(req, res, pathOnly) {
  const base = getTabBase();
  if (!base) {
    // Stub: empty 200 (tab completions degrade gracefully)
    log(`tab stub (no TAB base) ${pathOnly}`);
    writeUnaryProto(res, Buffer.alloc(0));
    return true;
  }

  try {
    const target = new URL(pathOnly, base.endsWith("/") ? base : `${base}/`);
    const lib = target.protocol === "https:" ? https : http;
    const bodyBuf = await readBody(req);

    const proxyHeaders = { ...req.headers };
    delete proxyHeaders["host"];
    delete proxyHeaders["content-length"];
    proxyHeaders["host"] = target.host;
    if (bodyBuf.length) proxyHeaders["content-length"] = String(bodyBuf.length);

    log(`tab proxy ${req.method} ${target.href}`);

    await new Promise((resolve, reject) => {
      const proxyReq = lib.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: target.pathname + target.search,
          method: req.method || "POST",
          headers: proxyHeaders,
          timeout: 30000,
        },
        (proxyRes) => {
          const headers = { ...proxyRes.headers };
          delete headers["transfer-encoding"];
          res.writeHead(proxyRes.statusCode || 200, headers);
          proxyRes.pipe(res);
          proxyRes.on("end", resolve);
          proxyRes.on("error", reject);
        },
      );
      proxyReq.on("error", (e) => {
        err(`tab proxy error ${pathOnly}: ${e.message}`);
        if (!res.headersSent) {
          writeUnaryProto(res, Buffer.alloc(0));
        }
        resolve();
      });
      proxyReq.on("timeout", () => {
        proxyReq.destroy(new Error("tab proxy timeout"));
      });
      if (bodyBuf.length) proxyReq.write(bodyBuf);
      proxyReq.end();
    });
    return true;
  } catch (e) {
    err(`tab proxy fail ${pathOnly}: ${e.message}`);
    if (!res.headersSent) writeUnaryProto(res, Buffer.alloc(0));
    return true;
  }
}

module.exports = { isTabPath, proxyTabRequest, getTabBase, TAB_PATHS };
