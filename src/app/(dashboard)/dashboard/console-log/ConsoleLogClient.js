"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

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
    /^(\[\d{2}:\d{2}:\d{2}\]\s+)?\[([a-z0-9]{6})(?::([a-z0-9]{6}))?\](.*)$/i,
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
        {rest}
      </span>
    );
  }

  return <span style={{ color }}>{line}</span>;
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
