"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

// Amber-orange highlight for model/combo names (matches terminal hlModel).
const MODEL_NAME_STYLE = {
  color: "#fb923c",
  fontWeight: 700,
};

/**
 * Highlight model / combo tokens in common log patterns.
 * Patterns stay narrow so unrelated words are not recolored.
 */
function highlightModelNames(text, baseColor) {
  if (!text) return null;

  // Ordered alternatives; each match paints one model/combo span amber.
  // Also match: "POST /v1/responses | combo-name | 80 msgs"
  const re =
    /Combo\s+"([^"]+)"|Trying model\s+\d+\/\d+:\s+(\S+)|Model\s+(\S+)(\s+(?:succeeded|failed|transient|threw))|→\s+([a-z0-9._-]+\/[a-z0-9._-]+)|Model:\s+(\S+)|model=(\S+)|POST\s+(\S+)\s+→\s+(\S+)|(?:\/v1\/\S+\s+\|\s+)([^\s|]+)(\s+\|\s+\d+\s+msgs)|\|\s+([a-z0-9._/-]+)\s+\|\s+(\d+ms)/gi;

  const nodes = [];
  let last = 0;
  let m;
  let key = 0;

  const pushBase = (s) => {
    if (!s) return;
    nodes.push(
      <span key={key++} style={{ color: baseColor }}>
        {s}
      </span>,
    );
  };
  const pushModel = (s) => {
    if (!s) return;
    nodes.push(
      <span key={key++} style={MODEL_NAME_STYLE}>
        {s}
      </span>,
    );
  };

  while ((m = re.exec(text)) !== null) {
    pushBase(text.slice(last, m.index));
    const full = m[0];

    if (m[1] != null) {
      // Combo "name"
      pushBase('Combo "');
      pushModel(m[1]);
      pushBase('"');
    } else if (m[2] != null) {
      // Trying model n/n: name
      pushBase(full.slice(0, full.length - m[2].length));
      pushModel(m[2]);
    } else if (m[3] != null) {
      // Model name succeeded/failed...
      pushBase("Model ");
      pushModel(m[3]);
      pushBase(m[4] || "");
    } else if (m[5] != null) {
      // → provider/model
      pushBase("→ ");
      pushModel(m[5]);
    } else if (m[6] != null) {
      pushBase("Model: ");
      pushModel(m[6]);
    } else if (m[7] != null) {
      pushBase("model=");
      pushModel(m[7]);
    } else if (m[8] != null) {
      // POST client → provider/model
      pushBase("POST ");
      pushModel(m[8]);
      pushBase(" → ");
      pushModel(m[9]);
    } else if (m[10] != null) {
      // /v1/... | combo-or-model | N msgs
      const head = full.slice(0, full.indexOf(m[10]));
      pushBase(head);
      pushModel(m[10]);
      pushBase(m[11] || "");
    } else if (m[12] != null) {
      // STREAM: | model | 123ms
      pushBase("| ");
      pushModel(m[12]);
      pushBase(` | ${m[13]}`);
    } else {
      pushBase(full);
    }

    last = m.index + full.length;
  }

  pushBase(text.slice(last));
  return nodes.length ? nodes : text;
}

function renderLine(line, onIdClick) {
  let color = "#cbd5e1"; // default fallback (slate-300 / light gray)

  if (
    line.includes("❌") ||
    line.includes("💥") ||
    line.includes("[ERROR]") ||
    line.includes("ERROR")
  ) {
    color = "#f87171"; // red
  } else if (
    line.includes("⚠️") ||
    line.includes("[WARN]") ||
    line.includes("WARN")
  ) {
    color = "#fbbf24"; // yellow
  } else if (
    line.includes("📥") ||
    line.includes("[REQUEST]") ||
    line.includes("[ProxyFetch]")
  ) {
    color = "#22d3ee"; // cyan
  } else if (
    line.includes("📤") ||
    line.includes("ℹ️") ||
    line.includes("[INFO]") ||
    line.includes("[COMBO]")
  ) {
    color = "#4ade80"; // green
  } else if (
    line.includes("🔍") ||
    line.includes("[AUTH]") ||
    line.includes("[ROUTING]")
  ) {
    color = "#38bdf8"; // sky blue
  } else if (line.includes("🌊") || line.includes("[STREAM]")) {
    color = "#e879f9"; // fuchsia
  } else if (
    line.includes("📊") ||
    line.includes("📈") ||
    line.includes("[USAGE]") ||
    line.includes("[STREAM USAGE]")
  ) {
    color = "#f472b6"; // pink
  } else if (line.includes("[PENDING]")) {
    color = "#818cf8"; // indigo
  } else if (line.includes("[DB]") || line.includes("[InitApp]")) {
    color = "#94a3b8"; // slate
  }

  // Parse ID pattern: [reqId] or [reqId:connId]
  const match = line.match(
    /^(\[\d{2}:\d{2}:\d{2}\]\s+)?\[([a-z0-9]{6})(?::([a-z0-9]{6}))?](.*)$/i,
  );
  if (match) {
    const timeStr = match[1] || "";
    const reqId = match[2];
    const connId = match[3];
    const rest = match[4];

    return (
      <span style={{ color }}>
        {timeStr}
        <span
          onClick={() => onIdClick(reqId)}
          style={{
            cursor: "pointer",
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "3px",
            padding: "0px 4px",
            color: "#60a5fa", // bright blue
            marginRight: "4px",
            fontWeight: "bold",
            display: "inline-block",
          }}
          title={`Click to filter by ${reqId}`}
          className="hover:bg-blue-900 hover:text-white transition-colors"
        >
          {reqId}
          {connId ? `:${connId}` : ""}
        </span>
        {highlightModelNames(rest, color)}
      </span>
    );
  }

  return <span style={{ color }}>{highlightModelNames(line, color)}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines
            ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
            : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines
            ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
            : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleIdClick = (reqId) => {
    setFilterText(reqId);
  };

  const filteredLogs = filterText
    ? logs.filter((line) =>
        line.toLowerCase().includes(filterText.toLowerCase()),
      )
    : logs;

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-4">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Filter logs by ID or text..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-white rounded px-3 py-1 text-xs w-full focus:outline-none focus:border-blue-500"
            />
            {filterText && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFilterText("")}
              >
                Reset
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            icon="delete"
            onClick={handleClear}
          >
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {filteredLogs.length === 0 ? (
            <span className="text-text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {filteredLogs.map((line, i) => (
                <div key={i}>{renderLine(line, handleIdClick)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}