"use client";

import { useEffect, useRef, useState } from "react";

// Amber-orange highlight for model/combo names (matches terminal hlModel).
const MODEL_NAME_STYLE = {
  color: "#fb923c",
  fontWeight: 700,
};

function highlightModelNames(text, baseColor) {
  if (!text) return null;

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
      pushBase('Combo "');
      pushModel(m[1]);
      pushBase('"');
    } else if (m[2] != null) {
      pushBase(full.slice(0, full.length - m[2].length));
      pushModel(m[2]);
    } else if (m[3] != null) {
      pushBase("Model ");
      pushModel(m[3]);
      pushBase(m[4] || "");
    } else if (m[5] != null) {
      pushBase("→ ");
      pushModel(m[5]);
    } else if (m[6] != null) {
      pushBase("Model: ");
      pushModel(m[6]);
    } else if (m[7] != null) {
      pushBase("model=");
      pushModel(m[7]);
    } else if (m[8] != null) {
      pushBase("POST ");
      pushModel(m[8]);
      pushBase(" → ");
      pushModel(m[9]);
    } else if (m[10] != null) {
      const head = full.slice(0, full.indexOf(m[10]));
      pushBase(head);
      pushModel(m[10]);
      pushBase(m[11] || "");
    } else if (m[12] != null) {
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
  let color = "#cbd5e1"; // slate-300

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
  } else if (line.includes("🔥") || line.includes("[WARMUP]")) {
    color = "#fb923c"; // orange
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
  } else if (
    line.includes("[DB]") ||
    line.includes("[InitApp]") ||
    line.includes("[AutoPing]")
  ) {
    color = "#94a3b8"; // slate
  }

  // Parse ID pattern: [reqId] or [reqId:connId]
  const match = line.match(
    /^(\[\d{2}:\d{2}:\d{2}\]\s+)?(?:\[([a-z0-9]{6})(?::([a-z0-9]{6}))?\]|([a-z0-9]{6})(?::([a-z0-9]{6}))?)(.*)$/i,
  );
  if (match) {
    const timeStr = match[1] || "";
    const reqId = match[2] || match[4];
    const connId = match[3] || match[5];
    const rest = match[6];

    return (
      <span style={{ color }}>
        {timeStr}
        <span
          onClick={() => onIdClick?.(reqId)}
          style={{
            cursor: "pointer",
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "3px",
            padding: "0px 4px",
            color: "#60a5fa",
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

export default function RawTerminalView({ logs, onIdClick }) {
  const logRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!autoScroll || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex flex-col h-full min-h-0 rounded-xl border border-border bg-black overflow-hidden">
      {/* Terminal Mini-Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/80 border-b border-slate-800 text-[11px] text-slate-400 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          Terminal Stream ({logs.length} dòng)
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
              autoScroll ? "bg-primary/20 text-primary" : "bg-slate-800 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-[13px]">
              {autoScroll ? "arrow_downward" : "pause"}
            </span>
            {autoScroll ? "Auto-scroll ON" : "Auto-scroll PAUSED"}
          </button>
          <button
            onClick={handleCopyAll}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            title="Copy tất cả dòng log"
          >
            <span className="material-symbols-outlined text-[13px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "Đã copy" : "Copy"}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={logRef}
        className="p-3.5 text-xs font-mono flex-1 min-h-0 overflow-y-auto space-y-0.5 select-text"
      >
        {logs.length === 0 ? (
          <span className="text-slate-500">Chưa có log console nào.</span>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="leading-relaxed hover:bg-white/[0.03] px-1 rounded">
              {renderLine(line, onIdClick)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
