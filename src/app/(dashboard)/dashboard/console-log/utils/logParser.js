/**
 * Parse and group console log lines into structured request transactions.
 */

export function parseLogLine(rawLine) {
  if (!rawLine || typeof rawLine !== "string") {
    return { raw: rawLine, text: "", timestamp: "", level: "info" };
  }

  // 1. Extract Timestamp: [HH:MM:SS]
  let timestamp = "";
  let text = rawLine;
  const timeMatch = rawLine.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/);
  if (timeMatch) {
    timestamp = timeMatch[1];
    text = timeMatch[2];
  }

  // 2. Extract Request ID & Connection ID: reqId:connId or [reqId:connId] or [reqId]
  let reqId = null;
  let connId = null;
  const idMatch = text.match(/^(?:\[([a-z0-9]{6})(?::([a-z0-9]{6}))?\]|([a-z0-9]{6})(?::([a-z0-9]{6}))?)\s*(.*)$/i);
  if (idMatch) {
    reqId = idMatch[1] || idMatch[3];
    connId = idMatch[2] || idMatch[4] || null;
    text = idMatch[5];
  }

  // 3. Detect Level & Category
  let level = "info";
  if (text.includes("❌") || text.includes("💥") || text.includes("[ERROR]") || text.includes("ERROR")) {
    level = "error";
  } else if (text.includes("⚠️") || text.includes("[WARN]") || text.includes("WARN")) {
    level = "warn";
  } else if (text.includes("🌊") || text.includes("[STREAM]")) {
    level = "stream";
  } else if (text.includes("📊") || text.includes("📈") || text.includes("[USAGE]")) {
    level = "usage";
  } else if (text.includes("📥") || text.includes("POST ") || text.includes("GET ")) {
    level = "request";
  } else if (text.includes("🤯") || text.includes("[TTFT]")) {
    level = "ttft";
  }

  // 4. Extract Key Metadata
  const metadata = {};

  // Endpoint & Messages: POST /v1/chat/completions | codex-free | 28 msgs
  const epMatch = text.match(/(POST|GET)\s+(\/[^\s|]+)(?:\s+\|\s+([^\s|]+))?(?:\s+\|\s+(\d+)\s+msgs)?/i);
  if (epMatch) {
    metadata.method = epMatch[1];
    metadata.endpoint = epMatch[2];
    metadata.combo = epMatch[3] || null;
    metadata.msgs = epMatch[4] ? Number(epMatch[4]) : null;
  }

  // Model Routing: cx/gpt-5.6-luna → codex/gpt-5.6-luna or model=gpt-5.6-luna
  const routeMatch = text.match(/→\s+([a-z0-9._-]+\/[a-z0-9._-]+)/i);
  if (routeMatch) {
    metadata.targetModel = routeMatch[1];
  }
  const modelParamMatch = text.match(/model=([a-z0-9._/-]+)/i);
  if (modelParamMatch) {
    metadata.model = modelParamMatch[1];
  }

  // Account: account=fabb9953... or Using codex account: name@email.com or ACC:name@email.com
  const accMatch = text.match(/(?:Using\s+\S+\s+account:\s*|ACC:|account=)([a-z0-9._%+-]+(?:@[a-z0-9.-]+\.[a-z]{2,})?|[a-z0-9]{8,})/i);
  if (accMatch) {
    metadata.account = accMatch[1];
  }

  // Tokens Usage: in=43858 | out=157 | cache_read=42496 (96.89%)
  const usageMatch = text.match(/in=(\d+)(?:\s+\|\s+out=(\d+))?(?:.*?cache_read=(\d+)\s*\(([\d.]+)%\))?/i);
  if (usageMatch) {
    metadata.tokensIn = Number(usageMatch[1]);
    if (usageMatch[2]) metadata.tokensOut = Number(usageMatch[2]);
    if (usageMatch[3]) metadata.cacheRead = Number(usageMatch[3]);
    if (usageMatch[4]) metadata.cachePct = Number(usageMatch[4]);
  }

  // TTFT & Duration: total=4432 | ttft=1431 | 4429ms | complete
  const ttftMatch = text.match(/total=(\d+)\s+\|\s+ttft=(\d+)/i);
  if (ttftMatch) {
    metadata.duration = Number(ttftMatch[1]);
    metadata.ttft = Number(ttftMatch[2]);
  }
  const streamDurMatch = text.match(/\|\s*(\d+)ms\s*\|\s*complete/i);
  if (streamDurMatch) {
    metadata.duration = Number(streamDurMatch[1]);
    metadata.completed = true;
  }

  return {
    raw: rawLine,
    timestamp,
    reqId,
    connId,
    level,
    text,
    metadata,
  };
}

/**
 * Group raw log lines into structured Request Groups.
 */
export function groupLogLines(rawLines) {
  const groups = new Map();
  const systemLines = [];
  let lastReqId = null;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const parsed = parseLogLine(rawLine);

    // If line has no reqId, check if it belongs to the previous active request (e.g. stream chunk or usage log immediately after)
    let targetReqId = parsed.reqId;
    if (!targetReqId) {
      if (lastReqId && (parsed.level === "stream" || parsed.level === "usage" || parsed.text.includes("▶ POST") || parsed.text.includes("DBG:"))) {
        targetReqId = lastReqId;
      }
    }

    if (targetReqId) {
      lastReqId = targetReqId;
      let group = groups.get(targetReqId);
      if (!group) {
        group = {
          id: targetReqId,
          connId: parsed.connId || null,
          startTime: parsed.timestamp || "",
          endTime: parsed.timestamp || "",
          endpoint: "/v1/chat/completions",
          method: "POST",
          combo: null,
          model: null,
          provider: null,
          account: null,
          status: "pending",
          statusCode: 200,
          duration: null,
          ttft: null,
          tokensIn: null,
          tokensOut: null,
          cacheRead: null,
          cachePct: null,
          hasError: false,
          errorMessage: null,
          lines: [],
        };
        groups.set(targetReqId, group);
      }

      group.lines.push(parsed);
      group.endTime = parsed.timestamp || group.endTime;
      if (parsed.connId && !group.connId) group.connId = parsed.connId;

      // Merge metadata
      const m = parsed.metadata;
      if (m.endpoint) group.endpoint = m.endpoint;
      if (m.method) group.method = m.method;
      if (m.combo) group.combo = m.combo;
      if (m.targetModel) group.model = m.targetModel;
      else if (m.model && !group.model) group.model = m.model;
      if (m.account) group.account = m.account;
      if (m.tokensIn != null) group.tokensIn = m.tokensIn;
      if (m.tokensOut != null) group.tokensOut = m.tokensOut;
      if (m.cacheRead != null) group.cacheRead = m.cacheRead;
      if (m.cachePct != null) group.cachePct = m.cachePct;
      if (m.duration != null) group.duration = m.duration;
      if (m.ttft != null) group.ttft = m.ttft;

      if (parsed.level === "error") {
        group.hasError = true;
        group.status = "error";
        group.statusCode = 500;
        group.errorMessage = parsed.text;
      } else if (parsed.level === "stream" && parsed.text.includes("complete")) {
        if (!group.hasError) group.status = "success";
      } else if (parsed.level === "ttft" || parsed.level === "usage") {
        if (!group.hasError && group.status !== "error") group.status = "success";
      }
    } else {
      systemLines.push(parsed);
    }
  }

  // Convert map to array sorted by latest activity
  const groupList = Array.from(groups.values()).reverse();
  return {
    groups: groupList,
    systemLines,
    totalRequests: groupList.length,
  };
}
