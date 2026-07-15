const {
  readBody,
  unwrapRequestBody,
  decompressBody,
  writeUnaryProto,
} = require("../proto/connect");
const {
  decodeBidiAppendRequest,
  encodeBidiAppendResponse,
  decodeAgentClientMessageFromHex,
  decodeConversationStateBuf,
} = require("../proto/agentMessages");
const { globalBroker } = require("./broker");
const { driveProvider } = require("./driveProvider");
const { globalSeqTracker } = require("./appendSeq");
const { log, err } = require("../../logger");

function enqueueDrive(stream, intent) {
  if (!stream._driveQueue) stream._driveQueue = [];
  stream._driveQueue.push(intent);
  pumpDriveQueue(stream);
}

function pumpDriveQueue(stream) {
  if (stream._driving) return;
  const next = stream._driveQueue?.shift();
  if (!next) return;
  stream._driving = true;
  stream.resetForNewRun();
  driveProvider(stream, next)
    .catch((e) => err(`driveProvider: ${e.message}`))
    .finally(() => {
      stream._driving = false;
      pumpDriveQueue(stream);
    });
}

function writeBidiError(res, message) {
  // Prefer non-200 so IDE surfaces decode bugs (byok uses Connect InvalidArgument)
  res.writeHead(400, {
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
  });
  res.end(JSON.stringify({ error: { code: "invalid_argument", message } }));
}

async function handleBidiAppend(req, res) {
  const rawWire = await readBody(req);
  const ct = String(req.headers["content-type"] || "");
  // Cursor gzips large unary bodies (run_request) at HTTP layer; gunzip before decode.
  const raw = decompressBody(rawWire, req.headers["content-encoding"]);
  const body = unwrapRequestBody(raw, ct);
  let parsed;
  try {
    parsed = decodeBidiAppendRequest(body);
  } catch (e) {
    err(`BidiAppend decode request: ${e.message}`);
    err(
      `BidiAppend rawLen=${raw.length} bodyLen=${body.length} ct=${ct} head=${raw.subarray(0, 32).toString("hex")}`,
    );
    writeBidiError(res, e.message);
    return;
  }

  const requestId = parsed.requestId || "unknown";
  const dataLen = (parsed.data || "").length;

  // append_seqno dedup (byok AppendSeqTracker)
  if (parsed.appendSeqno > 0) {
    const seqCheck = globalSeqTracker.check(requestId, parsed.appendSeqno);
    if (seqCheck.stale) {
      log(`BidiAppend stale seq=${parsed.appendSeqno} request_id=${requestId}`);
      writeUnaryProto(res, encodeBidiAppendResponse());
      return;
    }
  }

  const stream = globalBroker.getOrCreate(requestId);

  log(
    `BidiAppend request_id=${requestId} seq=${parsed.appendSeqno} dataLen=${dataLen} rawLen=${raw.length} bodyLen=${body.length} fields=${parsed.rawFieldCount || 0} ct=${ct.split(";")[0]}`,
  );

  // Fail-closed: non-empty data must be valid even-length hex (byok hex.DecodeString)
  if (dataLen > 0) {
    const d = String(parsed.data || "").trim();
    if (!/^[0-9a-fA-F]+$/.test(d) || d.length % 2 !== 0) {
      err(
        `BidiAppend invalid hex dataLen=${dataLen} head=${d.slice(0, 48)} bodyHead=${body.subarray(0, 48).toString("hex")}`,
      );
      writeBidiError(res, "bidi append data is not valid hex");
      return;
    }
  }

  if (dataLen < 8 && body.length > 40) {
    log(
      `BidiAppend decode thin payload head=${body.subarray(0, 64).toString("hex")}`,
    );
  }

  const clientMsg = decodeAgentClientMessageFromHex(parsed.data);
  log(
    `BidiAppend kind=${clientMsg.kind}${clientMsg.kind === "run_request" ? ` textLen=${(clientMsg.run?.userText || "").length} model=${clientMsg.run?.modelId || ""}` : ""}`,
  );

  // Non-empty payload that did not classify as a known kind → error (not silent 200)
  if (
    dataLen > 8 &&
    (clientMsg.kind === "empty" ||
      clientMsg.kind === "invalid" ||
      clientMsg.kind === "unknown")
  ) {
    const fieldNums = (clientMsg.fields || [])
      .map((f) => f.fieldNumber)
      .join(",");
    err(
      `BidiAppend unclassifiable kind=${clientMsg.kind} dataLen=${dataLen} fields=${fieldNums} dataHead=${String(parsed.data).slice(0, 64)}`,
    );
    writeBidiError(
      res,
      `unsupported or unclassifiable client message kind: ${clientMsg.kind}`,
    );
    return;
  }

  if (clientMsg.kind === "cancel") {
    stream.abort();
    stream._driveQueue = [];
    writeUnaryProto(res, encodeBidiAppendResponse());
    return;
  }

  if (clientMsg.kind === "exec_client_message") {
    const exec = clientMsg.exec || {};
    const key = exec.execId || String(exec.id || "");
    const result = {
      execId: exec.execId,
      id: exec.id,
      resultText: exec.resultText || "",
    };
    // Resolve by exec_id and also any pending callId match
    const resolved =
      stream.resolveToolResult(key, result) ||
      stream.resolveToolResult(String(exec.id), result);
    if (!resolved && key) {
      // try matching any pending that contains key
      for (const [pendingKey] of stream.pendingTools || []) {
        if (String(pendingKey).includes(key) || key.includes(String(pendingKey))) {
          stream.resolveToolResult(pendingKey, result);
          break;
        }
      }
    }
    writeUnaryProto(res, encodeBidiAppendResponse());
    return;
  }

  if (clientMsg.kind === "interaction_response") {
    // Surface interaction answers as tool results when call id present
    const text =
      clientMsg.run?.userText ||
      clientMsg.exec?.resultText ||
      "(interaction response)";
    // Resolve any single pending interaction wait
    if (stream.pendingTools?.size === 1) {
      const onlyKey = [...stream.pendingTools.keys()][0];
      stream.resolveToolResult(onlyKey, { resultText: text });
    }
    writeUnaryProto(res, encodeBidiAppendResponse());
    return;
  }

  if (
    clientMsg.kind === "client_heartbeat" ||
    clientMsg.kind === "kv_client_message"
  ) {
    writeUnaryProto(res, encodeBidiAppendResponse());
    return;
  }

  if (clientMsg.kind === "run_request" || clientMsg.kind === "prewarm_request") {
    const run = clientMsg.run || {};
    // Extract workspace context from ConversationStateStructure blob (field 1 of run_request)
    let conversationStateBuf = null;
    try {
      const rawHex = parsed.data || "";
      if (rawHex.length > 8) {
        const msgBuf = Buffer.from(rawHex, "hex");
        const { decodeFields: df, fieldBytes: fb } = require("../proto/wire");
        const outerFields = df(msgBuf);
        const runRaw = fb(outerFields, 1);
        if (runRaw) conversationStateBuf = decodeConversationStateBuf(runRaw);
      }
    } catch {
      /* ignore */
    }
    const intent = {
      conversationId: run.conversationId || requestId,
      userText: run.userText || "",
      modelId: run.modelId || "default",
      mode: run.mode || "agent",
      thinkingEffort: run.thinkingEffort || "",
      prewarm: clientMsg.kind === "prewarm_request" || !!clientMsg.prewarm,
      cancel: !!run.cancel,
      conversationStateBuf,
    };
    stream.meta = { ...stream.meta, ...intent };

    if (intent.cancel) {
      stream.abort();
      stream._driveQueue = [];
      writeUnaryProto(res, encodeBidiAppendResponse());
      return;
    }

    enqueueDrive(stream, intent);
    writeUnaryProto(res, encodeBidiAppendResponse());
    return;
  }

  if (clientMsg.kind === "unknown" && clientMsg.fields) {
    log(
      `BidiAppend unknown fields=${clientMsg.fields.map((f) => f.fieldNumber).join(",")}`,
    );
  }
  writeUnaryProto(res, encodeBidiAppendResponse());
}

module.exports = { handleBidiAppend };
