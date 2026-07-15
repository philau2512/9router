const {
  readBody,
  unwrapRequestBody,
  decompressBody,
  createConnectStreamWriter,
} = require("../proto/connect");
const {
  decodeBidiRequestId,
  encodeHeartbeat,
} = require("../proto/agentMessages");
const { globalBroker } = require("./broker");
const { log, err } = require("../../logger");

async function handleRunSSE(req, res) {
  const rawWire = await readBody(req);
  const raw = decompressBody(rawWire, req.headers["content-encoding"]);
  const body = unwrapRequestBody(raw, req.headers["content-type"]);
  let requestId = "";
  try {
    requestId = decodeBidiRequestId(body);
  } catch (e) {
    err(`RunSSE decode: ${e.message}`);
  }
  if (!requestId) {
    // try JSON fallback
    try {
      const j = JSON.parse(raw.toString("utf8"));
      requestId = j.request_id || j.requestId || "";
    } catch {
      /* ignore */
    }
  }
  if (!requestId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "request_id required" }));
    return;
  }

  log(`RunSSE subscribe request_id=${requestId}`);
  const stream = globalBroker.getOrCreate(requestId);
  const writer = createConnectStreamWriter(res);

  // Replay backlog
  for (const msg of stream.backlog) {
    writer.writeMessage(msg);
  }

  const onMessage = (msg) => {
    try {
      writer.writeMessage(msg);
    } catch (e) {
      err(`RunSSE write: ${e.message}`);
    }
  };
  stream.on("message", onMessage);

  const heartbeat = setInterval(() => {
    if (writer.closed || stream.closed) return;
    try {
      writer.writeMessage(encodeHeartbeat());
    } catch {
      /* ignore */
    }
  }, 5000);
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    stream.off("message", onMessage);
    // do not remove stream immediately — tool results may still arrive
    setTimeout(() => {
      if (!stream._driving && stream.pendingTools.size === 0) {
        globalBroker.remove(requestId);
      }
    }, 60000).unref?.();
  };

  req.on("close", () => {
    cleanup();
    if (!writer.closed) writer.writeEnd();
  });

  stream.on("close", () => {
    cleanup();
    if (!writer.closed) writer.writeEnd();
  });

  // If stream already finished and backlog was empty, keep open for new messages
}

module.exports = { handleRunSSE };
