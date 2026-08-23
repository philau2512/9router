"use client";

import { useState } from "react";
import { Badge } from "@/shared/components";

export default function GroupedFeedView({ groups, onIdClick, onCopyText }) {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(groups.map((g) => g.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const handleCopyGroup = (e, group) => {
    e.stopPropagation();
    const raw = group.lines.map((l) => l.raw).join("\n");
    navigator.clipboard.writeText(raw);
    setCopiedId(group.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!groups || groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted border border-dashed border-border rounded-xl">
        <span className="material-symbols-outlined text-[36px] mb-2 opacity-50">
          inbox
        </span>
        <p className="text-sm font-medium">Chưa có request nào được ghi nhận</p>
        <p className="text-xs opacity-70">Các request API gửi đến 9router sẽ xuất hiện tại đây</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 gap-2.5">
      {/* Quick Action Toolbar */}
      <div className="flex items-center justify-between px-1 text-xs text-text-muted shrink-0">
        <span>Hiển thị <strong>{groups.length}</strong> request gần nhất</span>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">unfold_more</span>
            Mở rộng tất cả
          </button>
          <span>•</span>
          <button
            onClick={collapseAll}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">unfold_less</span>
            Thu gọn tất cả
          </button>
        </div>
      </div>

      {/* List of Request Cards */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4 flex flex-col gap-2.5">
        {groups.map((group) => {
          const isExpanded = expandedIds.has(group.id);
          const isSuccess =
            group.status === "success" && !group.hasError && !group.isAborted;
          const isError = group.hasError || group.status === "error";
          const isAborted = group.status === "aborted" || group.isAborted;

          return (
            <div
              key={group.id}
              className={`shrink-0 rounded-xl border transition-all duration-200 bg-surface/50 hover:bg-surface overflow-hidden ${
                isError
                  ? "border-red-500/40 bg-red-500/5"
                  : isAborted
                    ? "border-amber-500/40 bg-amber-500/5"
                    : isExpanded
                      ? "border-primary/40 shadow-sm"
                      : "border-border"
              }`}
            >
              {/* Header Summary Row */}
              <div
                onClick={() => toggleExpand(group.id)}
                className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between cursor-pointer select-none"
              >
                {/* Left details: Status, ID, Endpoint, Model */}
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {/* Status Indicator */}
                  <span
                    className={`size-2.5 rounded-full shrink-0 ${
                      isError
                        ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                        : isAborted
                          ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                          : isSuccess
                            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                            : "bg-blue-500 animate-pulse"
                    }`}
                  />

                  {/* Timestamp */}
                  <span className="font-mono text-xs text-text-muted">
                    {group.startTime}
                  </span>

                  {/* Request ID Pill */}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onIdClick?.(group.id);
                    }}
                    className="font-mono font-bold text-xs bg-sidebar px-2 py-0.5 rounded border border-border text-primary hover:border-primary transition-colors cursor-pointer"
                    title="Click để lọc theo Request ID này"
                  >
                    {group.id}
                    {group.connId ? `:${group.connId}` : ""}
                  </span>

                  {/* Endpoint & Combo */}
                  <span className="font-mono text-xs font-semibold text-text-main">
                    {group.method} {group.endpoint}
                  </span>

                  {group.combo && (
                    <Badge variant="primary" size="sm">
                      {group.combo}
                    </Badge>
                  )}

                  {isAborted && (
                    <Badge
                      variant="warning"
                      size="sm"
                      title={
                        group.disconnectReason
                          ? `Aborted: ${group.disconnectReason}`
                          : "Aborted"
                      }
                    >
                      Aborted
                    </Badge>
                  )}

                  {/* Target Model Highlight */}
                  {group.model && (
                    <span className="font-mono text-xs font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded border border-orange-400/20">
                      → {group.model}
                    </span>
                  )}
                </div>

                {/* Right details: Badges for Latency, Tokens, Cache, Account */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Account Badge */}
                  {group.account && (
                    <span
                      className="text-[11px] text-text-muted truncate max-w-[140px] font-mono hidden md:inline"
                      title={`Account: ${group.account}`}
                    >
                      👤 {group.account}
                    </span>
                  )}

                  {/* Latency / TTFT Badge */}
                  {group.duration != null && (
                    <span className="text-xs font-mono bg-sidebar px-2 py-0.5 rounded border border-border text-text-main">
                      ⏱️ {(group.duration / 1000).toFixed(2)}s
                      {group.ttft != null && (
                        <span className="text-text-muted text-[10px] ml-1">
                          (TTFT {(group.ttft / 1000).toFixed(2)}s)
                        </span>
                      )}
                    </span>
                  )}

                  {/* Tokens Badge */}
                  {group.tokensIn != null && (
                    <span className="text-xs font-mono bg-sidebar px-2 py-0.5 rounded border border-border text-text-muted">
                      in: <strong>{group.tokensIn >= 1000 ? `${(group.tokensIn / 1000).toFixed(1)}k` : group.tokensIn}</strong>
                      {group.tokensOut != null && (
                        <> · out: <strong>{group.tokensOut}</strong></>
                      )}
                    </span>
                  )}

                  {/* Prompt Cache Hit Pill */}
                  {group.cachePct != null && group.cachePct > 0 && (
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-500">
                      ⚡ {group.cachePct.toFixed(1)}% Cache
                    </span>
                  )}

                  {/* Copy Button */}
                  <button
                    onClick={(e) => handleCopyGroup(e, group)}
                    className="p-1 rounded hover:bg-sidebar text-text-muted hover:text-text-main transition-colors"
                    title="Copy toàn bộ log của request này"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {copiedId === group.id ? "check" : "content_copy"}
                    </span>
                  </button>

                  {/* Expand Chevron */}
                  <span
                    className={`material-symbols-outlined text-[18px] text-text-muted transition-transform duration-200 ${
                      isExpanded ? "rotate-180 text-primary" : ""
                    }`}
                  >
                    expand_more
                  </span>
                </div>
              </div>

              {/* Expanded Timeline Body with Internal Scroll */}
              {isExpanded && (
                <div className="border-t border-border/60 bg-black/40 p-3.5 text-xs font-mono max-h-[380px] overflow-y-auto overflow-x-auto select-text">
                  <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-primary/30">
                    {group.lines.map((line, idx) => {
                      let textColor = "#cbd5e1"; // slate-300
                      if (line.level === "error") textColor = "#f87171";
                      else if (line.level === "warn") textColor = "#fbbf24";
                      else if (line.level === "stream") textColor = "#e879f9";
                      else if (line.level === "usage") textColor = "#f472b6";
                      else if (line.level === "request") textColor = "#22d3ee";
                      else if (line.level === "ttft") textColor = "#38bdf8";

                      return (
                        <div
                          key={idx}
                          className="flex items-start gap-2 leading-relaxed whitespace-pre hover:bg-white/[0.02] px-1.5 py-0.5 rounded transition-colors"
                        >
                          <span className="text-text-muted/60 shrink-0 select-none">
                            {line.timestamp}
                          </span>
                          <span style={{ color: textColor }}>
                            {line.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
