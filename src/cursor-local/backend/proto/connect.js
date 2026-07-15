/**
 * Connect-RPC framing helpers for Cursor unary + server-stream.
 * Unary proto body is often raw protobuf (content-type application/proto).
 * Stream uses Connect envelope: [flags:1][length:4 BE][payload]
 */

function isConnectStreamContentType(ct) {
  const c = String(ct || "").toLowerCase();
  return (
    c.includes("connect+proto") ||
    c.includes("application/connect") ||
    c.includes("proto")
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Decompress an HTTP body when it is gzip-encoded.
 * Cursor gzips large unary bodies (e.g. run_request) and sends
 * `Content-Encoding: gzip`; the whole body carries the gzip magic 1f 8b.
 * connect-go (byok) auto-decompresses — we must mirror that before proto decode.
 * @param {Buffer} buf
 * @param {string} [contentEncoding]
 */
function decompressBody(buf, contentEncoding) {
  if (!buf || !buf.length) return buf || Buffer.alloc(0);
  const enc = String(contentEncoding || "").toLowerCase();
  const isGzipMagic = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const isDeflate = enc.includes("deflate");
  if (!enc.includes("gzip") && !isGzipMagic && !isDeflate) return buf;
  try {
    const zlib = require("zlib");
    if (isDeflate && !isGzipMagic) return zlib.inflateSync(buf);
    return zlib.gunzipSync(buf);
  } catch {
    return buf;
  }
}

/**
 * Parse request body as protobuf message bytes.
 * Supports raw proto and Connect envelope (flag 0 / gzip 0x01).
 */
/**
 * @param {Buffer} buf
 * @param {string} [contentType]
 */
function unwrapRequestBody(buf, contentType) {
  if (!buf || !buf.length) return Buffer.alloc(0);
  const ct = String(contentType || "").toLowerCase();
  // Only peel Connect envelope when CT says Connect (byok codec is protocol-aware)
  const isConnect =
    ct.includes("connect+proto") ||
    ct.includes("application/connect") ||
    ct.includes("connect+json");
  if (!isConnect) return buf;

  // Connect envelope: [flags:1][len:4 BE][payload]
  if (buf.length >= 5) {
    const flags = buf[0];
    const len = buf.readUInt32BE(1);
    if (len > 0 && len <= buf.length - 5 && (flags === 0 || flags === 1)) {
      let payload = buf.subarray(5, 5 + len);
      if (flags === 1) {
        try {
          const zlib = require("zlib");
          payload = zlib.gunzipSync(payload);
        } catch {
          /* leave as-is */
        }
      }
      return payload;
    }
  }
  return buf;
}

function writeUnaryProto(res, messageBuf, status = 200) {
  const body = Buffer.isBuffer(messageBuf) ? messageBuf : Buffer.from(messageBuf || []);
  res.writeHead(status, {
    "Content-Type": "application/proto",
    "Content-Length": String(body.length),
    "Connect-Protocol-Version": "1",
  });
  res.end(body);
}

function writeUnaryJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

/**
 * Connect server-stream writer for AgentServerMessage frames.
 */
function createConnectStreamWriter(res) {
  // byok NewLegacyRunSSEHandler forces text/event-stream while body is still
  // Connect binary frames — Cursor client expects this CT for Agent RunSSE.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Connect-Protocol-Version": "1",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "X-Accel-Buffering": "no",
  });

  let closed = false;

  function writeMessage(messageBuf) {
    if (closed) return;
    const payload = Buffer.isBuffer(messageBuf)
      ? messageBuf
      : Buffer.from(messageBuf || []);
    const header = Buffer.alloc(5);
    header[0] = 0; // uncompressed message
    header.writeUInt32BE(payload.length, 1);
    res.write(Buffer.concat([header, payload]));
  }

  function writeEnd(error) {
    if (closed) return;
    closed = true;
    // Connect always ends with end-stream trailer (flag 0x02)
    const json = Buffer.from(
      error
        ? JSON.stringify({
            error: {
              code: "internal",
              message: String(error.message || error),
            },
          })
        : "{}",
    );
    const header = Buffer.alloc(5);
    header[0] = 0x02;
    header.writeUInt32BE(json.length, 1);
    try {
      res.write(Buffer.concat([header, json]));
    } catch {
      /* ignore */
    }
    res.end();
  }

  return {
    writeMessage,
    writeEnd,
    get closed() {
      return closed;
    },
  };
}

module.exports = {
  isConnectStreamContentType,
  readBody,
  decompressBody,
  unwrapRequestBody,
  writeUnaryProto,
  writeUnaryJson,
  createConnectStreamWriter,
};
