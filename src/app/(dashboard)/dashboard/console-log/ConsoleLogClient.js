"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { groupLogLines } from "./utils/logParser";
import GroupedFeedView from "./components/GroupedFeedView";
import TableView from "./components/TableView";
import RawTerminalView from "./components/RawTerminalView";

const VIEW_OPTIONS = [
  { value: "feed", label: "Grouped Feed", icon: "view_agenda" },
  { value: "table", label: "Table View", icon: "table_chart" },
  { value: "terminal", label: "Raw Terminal", icon: "terminal" },
];

const LEVEL_FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "request", label: "📥 Requests" },
  { id: "stream", label: "🌊 Streams" },
  { id: "usage", label: "📊 Token Usage" },
  { id: "error", label: "❌ Lỗi" },
];

const STORAGE_KEY = "9router_console_view_mode";

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (
          saved &&
          (saved === "feed" || saved === "table" || saved === "terminal")
        ) {
          return saved;
        }
      } catch (_) {}
    }
    return "feed";
  });
  const [filterText, setFilterText] = useState("");
  const [activeLevel, setActiveLevel] = useState("all");
  const [connected, setConnected] = useState(false);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (_) {}
  };

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setLogs([]);
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

  const handleIdClick = (reqId) => {
    setFilterText(reqId);
  };

  // Filter logs by text & Level
  const filteredRawLogs = useMemo(() => {
    let result = logs;

    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter((l) => l.toLowerCase().includes(lower));
    }

    if (activeLevel !== "all") {
      if (activeLevel === "request") {
        result = result.filter((l) => l.includes("📥") || l.includes("POST ") || l.includes("GET "));
      } else if (activeLevel === "stream") {
        result = result.filter((l) => l.includes("🌊") || l.includes("[STREAM]"));
      } else if (activeLevel === "usage") {
        result = result.filter((l) => l.includes("📊") || l.includes("[USAGE]"));
      } else if (activeLevel === "error") {
        result = result.filter(
          (l) =>
            l.includes("❌") ||
            l.includes("💥") ||
            l.includes("[ERROR]") ||
            l.includes("ERROR"),
        );
      }
    }

    return result;
  }, [logs, filterText, activeLevel]);

  // Group into structured Request records
  const { groups, systemLines, totalRequests } = useMemo(() => {
    return groupLogLines(filteredRawLogs);
  }, [filteredRawLogs]);

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-135px)] lg:h-[calc(100vh-165px)] min-h-0 overflow-hidden">
      {/* Top Header Card with Controls */}
      <Card padding="sm" className="shrink-0">
        <div className="flex flex-col gap-3">
          {/* Row 1: View Switcher & Main Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* View Switcher */}
            <div className="flex items-center gap-3">
              <SegmentedControl
                options={VIEW_OPTIONS}
                value={viewMode}
                onChange={handleViewModeChange}
                size="sm"
              />
              <span className="flex items-center gap-1.5 text-xs text-text-muted">
                <span
                  className={`size-2 rounded-full ${
                    connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                  }`}
                />
                {connected ? "Live" : "Connecting..."}
              </span>
            </div>

            {/* Clear & Stats */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted font-mono hidden sm:inline">
                {totalRequests} requests · {logs.length} dòng
              </span>
              <Button
                size="sm"
                variant="outline"
                icon="delete"
                onClick={handleClear}
                title="Xóa toàn bộ log console"
              >
                Clear Log
              </Button>
            </div>
          </div>

          {/* Row 2: Search Input & Quick Level Filter Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Lọc theo Request ID, model, text..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="bg-sidebar border border-border text-text-main rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:border-primary pl-8 transition-colors"
              />
              <span className="material-symbols-outlined text-[16px] text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2">
                search
              </span>
              {filterText && (
                <button
                  onClick={() => setFilterText("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>

            {/* Quick Level Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto py-0.5">
              {LEVEL_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveLevel(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    activeLevel === f.id
                      ? "bg-primary text-white"
                      : "bg-surface-2 hover:bg-sidebar text-text-muted hover:text-text-main border border-border/50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Main Content Area based on View Mode */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === "feed" && (
          <GroupedFeedView
            groups={groups}
            onIdClick={handleIdClick}
          />
        )}

        {viewMode === "table" && (
          <TableView
            groups={groups}
            onIdClick={handleIdClick}
          />
        )}

        {viewMode === "terminal" && (
          <RawTerminalView
            logs={filteredRawLogs}
            onIdClick={handleIdClick}
          />
        )}
      </div>
    </div>
  );
}