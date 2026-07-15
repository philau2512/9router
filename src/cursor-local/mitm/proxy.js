/**
 * HTTP CONNECT MITM proxy for *.cursor.sh → local backend.
 * Phase A: decrypt + forward; Phase B+ mocks/agent live on backend.
 */
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");
const { isWhitelistedRelayHost, normalizeHost } = require("./whitelist");
const { forwardToBackend } = require("./forward");
const { getCertForDomain, generateRootCA, loadRootCA } = require("../cert/generate");
const { parseListenAddr } = require("../config/defaults");
const { log, err } = require("../logger");

function createMitmProxy({ proxyListenAddr, backendListenAddr }) {
  const proxyAddr = parseListenAddr(proxyListenAddr);
  const backendAddr = parseListenAddr(backendListenAddr);
  const backendBase = `http://${backendAddr.addr}`;

  generateRootCA();
  loadRootCA();

  let server = null;
  let running = false;

  function handleConnect(req, clientSocket, head) {
    const hostPort = req.url || "";
    const host = normalizeHost(hostPort);

    if (!isWhitelistedRelayHost(host)) {
      // Transparent tunnel for non-Cursor hosts
      const [h, p] = hostPort.split(":");
      const port = Number(p) || 443;
      const upstream = net.connect(port, h, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
      return;
    }

    // MITM: present forged cert, then handle HTTPS as local server
    const certData = getCertForDomain(host);
    if (!certData) {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: certData.key,
      cert: certData.cert,
    });

    // After TLS handshake, parse HTTP request(s) from client
    const httpsServer = new http.Server(async (incReq, incRes) => {
      try {
        if (incReq.method === "OPTIONS") {
          incRes.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "*",
          });
          incRes.end();
          return;
        }
        // Ensure Host header for whitelist path
        if (!incReq.headers.host) incReq.headers.host = host;

        const backendRes = await forwardToBackend(incReq, backendBase);
        // Preserve streaming semantics for Connect RunSSE (chunked / no content-length)
        const headers = { ...backendRes.headers };
        // Hop-by-hop only — keep transfer-encoding for long-lived streams
        delete headers.connection;
        delete headers["keep-alive"];
        delete headers["proxy-connection"];
        // If content-length present, Node will handle; otherwise chunked pipe
        incRes.writeHead(backendRes.statusCode || 502, headers);
        backendRes.pipe(incRes);
      } catch (e) {
        err(`MITM handle ${host}${incReq.url}: ${e.message}`);
        if (!incRes.headersSent) {
          incRes.writeHead(502, { "Content-Type": "text/plain" });
        }
        incRes.end(`cursor-local bad gateway: ${e.message}`);
      }
    });

    httpsServer.on("clientError", () => {
      try {
        tlsSocket.destroy();
      } catch {
        /* ignore */
      }
    });

    httpsServer.emit("connection", tlsSocket);
    if (head && head.length) tlsSocket.emit("data", head);
  }

  function start() {
    return new Promise((resolve, reject) => {
      if (running) return resolve(getStatus());
      server = http.createServer((req, res) => {
        // plain HTTP (rare) — health for proxy itself
        if (req.url === "/_cursor_local_proxy_health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, role: "mitm-proxy" }));
          return;
        }
        res.writeHead(404);
        res.end("cursor-local mitm: use CONNECT");
      });
      server.on("connect", handleConnect);
      server.on("error", (e) => {
        err(`MITM listen error: ${e.message}`);
        reject(e);
      });
      server.listen(proxyAddr.port, proxyAddr.host, () => {
        running = true;
        log(`MITM proxy listening ${proxyAddr.addr} → backend ${backendBase}`);
        resolve(getStatus());
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) {
        running = false;
        return resolve();
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        running = false;
        server = null;
        log("MITM proxy stopped");
        resolve();
      };
      try {
        server.close(finish);
      } catch {
        finish();
      }
      setTimeout(finish, 3000).unref?.();
    });
  }

  function getStatus() {
    return {
      running,
      proxyListenAddr: proxyAddr.addr,
      backendBase,
    };
  }

  return { start, stop, getStatus };
}

module.exports = { createMitmProxy };
