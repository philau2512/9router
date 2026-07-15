const http = require("http");
const { parseListenAddr } = require("../config/defaults");
const { createRouter } = require("./router");
const { log, err } = require("../logger");

function createBackendServer({ backendListenAddr }) {
  const addr = parseListenAddr(backendListenAddr);
  const handle = createRouter();
  let server = null;
  let running = false;

  function start() {
    return new Promise((resolve, reject) => {
      if (running) return resolve(getStatus());
      server = http.createServer((req, res) => {
        Promise.resolve(handle(req, res)).catch((e) => {
          err(`backend handler: ${e.message}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(JSON.stringify({ error: e.message }));
        });
      });
      server.on("error", (e) => reject(e));
      server.listen(addr.port, addr.host, () => {
        running = true;
        log(`Backend listening ${addr.addr}`);
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
        log("Backend stopped");
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
    return { running, backendListenAddr: addr.addr };
  }

  return { start, stop, getStatus };
}

module.exports = { createBackendServer };
